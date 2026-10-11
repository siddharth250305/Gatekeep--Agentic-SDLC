GateKeep: Autonomous Agent Governance and Execution OS

About the Project

GateKeep is a control and execution layer for autonomous coding agents such as Claude and Cursor. When development teams connect autonomous agents to their repositories, those agents typically run with unrestricted shell access, expose sensitive environment variables, and apply code changes without human oversight. GateKeep replaces uncontrolled agent execution with a structured governance system.

External language models connect to GateKeep through the Model Context Protocol (MCP). The platform isolates agents from the host operating system, enforces policy rules on every tool call, routes all modifications through a three-stage approval process, runs test suites inside air-gapped Docker containers, and records every action in a cryptographic ledger.


System Architecture

The platform operates across four coordinated layers: the External Agent Layer, the Governance and Policy Layer, the Execution and Sandbox Layer, and the Dashboard Review Layer.

Architecture Flow Diagram

+-------------------------------------------------------------+
|                     External Agent Layer                    |
|                Claude Desktop  /  Cursor IDE                |
+-------------------------------------------------------------+
                               |
                               | Model Context Protocol (stdio / SSE :8078)
                               v
+-------------------------------------------------------------+
|                 Governance and Policy Layer                 |
|  MCP Server (20 Governed Tools)                             |
|  Policy Engine: Phase Gate Enforcement                      |
|  Security Guard: Path Traversal and Secret Redaction        |
+-------------------------------------------------------------+
                               |
                               | Governed Tool Calls
                               v
+-------------------------------------------------------------+
|                Backend Orchestration Layer                  |
|  Node.js and Express API (:4000)                            |
|  Pipeline State Machine (Requirements -> Design -> Code)    |
|  WebSocket Broadcast Engine                                 |
+-------------------------------------------------------------+
            |                                     |
            | Live Event Broadcast                | Persistence and Ledger
            v                                     v
+---------------------------+       +-------------------------+
|     Reviewer Cockpit      |       |   PostgreSQL Database   |
|  React 18 Dashboard       |       |  Active Runs            |
|  Git Diff Code Review     |       |  External Sessions      |
|  Live Agent Telemetry     |       |  SHA-256 HMAC Audit Log |
+---------------------------+       +-------------------------+
            ^
            | Container Status and Output
            |
+-------------------------------------------------------------+
|                Execution and Sandbox Layer                  |
|  Python FastAPI Engine (:8077)                              |
|  Git Worktree Isolation                                     |
|  Air-Gapped Docker Sandbox (--network none, memory capped)  |
+-------------------------------------------------------------+


Architectural Components

1. External Agent Layer
External coding models interact with the repository exclusively through the Model Context Protocol. Local agents such as Claude Desktop communicate over standard input/output (stdio JSON-RPC), while remote or web-based agents interact via Server-Sent Events (SSE) on port 8078. Agents never receive direct shell access or access to host environment variables.

2. Governance and Policy Engine
Every tool call is intercepted by the Policy Engine before reaching repository files. The policy engine enforces two primary security boundaries:
Sequential Phase Gating: Tools are strictly locked to their corresponding phase. Specification tools cannot be called during coding, and patch or write tools are rejected during requirements or architecture phases.
Sensitive Path Protection: Access to environment files (.env), private keys, certificates, and parent directories via path traversal is blocked automatically.

3. Backend State Machine and WebSocket Hub
The Node.js backend governs workflow state. It manages transitions between phases, tracks human reviewer signatures, and broadcasts state updates to the browser interface via WebSockets. The system persists all run metadata, active agent sessions, and test execution outcomes in PostgreSQL.

4. Air-Gapped Docker Execution Sandbox
The Python agent execution service runs test suites inside isolated Docker containers using the gatekeep-sandbox image. Containers execute with disabled networking (--network none), memory quotas, and CPU restrictions. Test results are collected directly from process exit codes and standard output streams, preventing agents from reporting forged test results.

5. Cryptographic SHA-256 Audit Ledger
All agent prompts, phase submissions, code diffs, test logs, and reviewer decisions are recorded into a cryptographic hash chain stored in PostgreSQL. Each entry hashes the current event payload together with the prior entry's SHA-256 hash. If any database record is altered, the chain breaks immediately, producing a verifiable, tamper-evident audit log.

6. Human-in-the-Loop Reviewer Cockpit
A frontend dashboard built with React 18 and Tailwind CSS provides real-time oversight. Engineers review specifications, inspect architectural plans, review side-by-side Git diffs, monitor container logs, and authorize gate progression.


Core Capabilities

1. Three-Stage Human in the Loop Pipeline
Agents must progress through sequential phases: Requirements, Architecture, and Code. An agent cannot write code or apply patches until human reviewers explicitly approve the requirements and system design through dedicated review gates.

2. Governed Model Context Protocol (MCP) Server
GateKeep provides 20 governed tools over stdio and Server-Sent Events (SSE). Agents can inspect repository structures, search files, read source code, submit specifications, and propose surgical patches.

3. Air-Gapped Docker Execution Sandbox
Tests execute inside isolated Docker containers configured with disabled network access and enforced resource limits, eliminating hallucinated test passes.

4. Cryptographic SHA-256 Audit Ledger
Every action is chained cryptographically into PostgreSQL using SHA-256 hashes, providing an immutable audit trail for compliance and security reviews.

5. Real-Time Operations Dashboard
Reviewers inspect live agent telemetry, evaluate proposed requirements and architectural diagrams, examine side-by-side Git diffs, and approve or reject stage transitions in real time.


Tech Stack

Frontend: React 18, Tailwind CSS, Vite, WebSockets
Backend: Node.js, Express, PostgreSQL, ws
Agent and MCP Engine: Python, FastAPI, MCP SDK
Containerization: Docker
Testing and Security: Pytest, Node Test Runner, SHA-256 Hash Chaining
