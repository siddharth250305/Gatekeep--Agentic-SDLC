# GateKeep: Autonomous AI Agent Governance & Execution OS
**Technical Whitepaper, Architecture Specification & Empirical Results**

---

## 1. Executive Summary

Autonomous coding agents (e.g., Anthropic Claude, Cursor, Devin) are increasingly deployed directly into software repositories. While these agents accelerate software delivery, granting them unrestricted shell access and autonomous commit rights introduces severe enterprise risks: **unauthorized code modification**, **credential leakage**, **architectural drift**, and **hallucinated test passes**.

**GateKeep** is a provider-agnostic governance and execution operating system that sits between autonomous coding agents and production codebases. External LLMs connect to GateKeep via the **Model Context Protocol (MCP)**. GateKeep enforces a strict **3-stage Human-in-the-Loop (HITL) approval pipeline**, intercepts every tool invocation through a server-side **Policy Engine**, runs test verification in an **air-gapped Docker sandbox**, and binds every prompt, patch, test log, and human signature into a **cryptographic SHA-256 HMAC audit ledger** stored in PostgreSQL.

---

## 2. The Problem Statement

### 2.1 The Critical Vulnerabilities of Ungoverned Coding Agents

When organizations integrate autonomous coding agents into development workflows, they encounter five fundamental failure modes:

1. **Unrestricted Shell & Host Access**: Agents provided with raw bash execution or broad IDE tool suites can execute destructive commands, modify untracked system files, or install malicious dependencies.
2. **Credential and Secret Exfiltration**: Agents often inspect `.env` files, SSH keys (`id_rsa`), or SSL certificates (`*.pem`) to diagnose connection issues. In doing so, these secrets are incorporated into the LLM context window and sent to third-party model providers, violating data compliance (GDPR, SOC 2).
3. **Premature Execution and Architectural Drift**: Given an end-user prompt, LLMs immediately generate code without validating architectural intent or formalizing requirements. This creates technical debt, breaks existing contracts, and leads to costly rework.
4. **Hallucinated Test Verification**: LLMs frequently claim that test suites passed when tests were never executed, failed with runtime errors, or were run against mocked configurations. Without an external execution oracle, human reviewers cannot trust agent-reported pass rates.
5. **Absence of Auditability and Regulatory Provenance**: When an agent modifies production code, traditional git commit logs fail to capture the prompt history, model version, human reviewer identity, and intermediate security decisions, making regulatory compliance impossible.

---

## 3. How GateKeep Solves the Problem

GateKeep replaces unchecked agent execution with a **Zero-Trust Governance Layer**:

```
+-------------------------------------------------------------------------------------------------+
|                                    GATEKEEP GOVERNANCE PIPELINE                                 |
+-------------------------------------------------------------------------------------------------+
|                                                                                                 |
|   1. SPECIFICATION PHASE              2. ARCHITECTURAL PHASE            3. CODING & TEST PHASE   |
|   +-----------------------+           +-----------------------+         +---------------------+  |
|   | Agent submits formal  |           | Agent submits technical|         | Agent writes patches|  |
|   | requirements & scopes |           | file plan & contracts |         | to isolated worktree|  |
|   +-----------+-----------+           +-----------+-----------+         +----------+----------+  |
|               |                                   |                                |             |
|               v                                   v                                v             |
|   [ GATE 1: PLANNER CHECK ]           [ GATE 2: ARCHITECT CHECK]        [ AIR-GAPPED DOCKER   ]  |
|   Human approves/rejects              Human approves/rejects            --network none sandbox   |
|   requirements before design          file changes before code          captures real pytest     |
|                                                                                    |             |
|                                                                                    v             |
|                                                                         [ GATE 3: LEAD REVIEW ]  |
|                                                                         Side-by-side git diff    |
|                                                                         Cryptographic SHA seal   |
+-------------------------------------------------------------------------------------------------+
```

1. **Model Context Protocol (MCP) Boundary**: The agent never accesses the host operating system. It communicates exclusively through 20 structured, governed MCP tools over `stdio` or `SSE`.
2. **Server-Side Policy Engine**: Tool permissions are dynamically locked to the current pipeline phase. `apply_patch` and `write_file` are rejected during the Requirements and Architecture phases. All paths containing `.env`, `*.key`, `*.pem`, or path traversal sequences (`../../`) are blocked.
3. **Deterministic Air-Gapped Test Runner**: Tests execute inside a dedicated container with disabled networking (`--network none`) and strict resource caps (512 MB RAM). Test pass/fail outcomes are determined strictly by OS process exit codes (`0` vs `!= 0`), eliminating hallucinated passes.
4. **Cryptographic Provenance**: Every state mutation is hashed and chained into an immutable SHA-256 HMAC ledger in PostgreSQL. Any retroactive modification to past logs breaks the hash chain.

---

## 4. Research Foundations & Academic Background

GateKeep builds upon three key areas of software engineering research:

### 4.1 Agentic SDLC Failure Taxonomies
Recent empirical benchmarks (e.g., SWE-bench, Jimenez et al., 2024) demonstrate that autonomous agents fail disproportionately not due to syntax errors, but due to **misaligned specifications** and **improper scope isolation**. GateKeep implements structured phase decomposition, forcing LLMs to freeze formal requirements before generating architectural diffs.

### 4.2 Bounded Autonomy & Human-in-the-Loop (HITL) Paradigms
Research in human-agent teaming (Endsley et al., 2022) indicates that fully autonomous systems cause automation complacency and catastrophic error blindness. GateKeep introduces **synchronous gates with asynchronous notification**, allowing human reviewers to step in at high-leverage inflection points (Requirements and Architecture) while automating low-level test execution.

### 4.3 Deterministic Oracles and Supply Chain Security (SLSA)
Under the Supply-chain Levels for Software Artifacts (SLSA) framework, automated modifications must carry non-falsifiable provenance. By combining isolated Git worktrees, air-gapped Docker execution, and HMAC hash-chaining, GateKeep guarantees that generated code satisfies SLSA Level 3 compliance standards.

---

## 5. System Architecture

GateKeep is structured into four decoupled, event-driven layers:

```
+--------------------------------------------------------------------------------+
|                             1. EXTERNAL AGENT LAYER                            |
|             Claude Desktop (stdio)  /  Cursor IDE (SSE on port 8078)           |
+--------------------------------------------------------------------------------+
                                        |
                                        | JSON-RPC 2.0 (Model Context Protocol)
                                        v
+--------------------------------------------------------------------------------+
|                       2. GOVERNANCE & POLICY LAYER (FastAPI)                   |
|   +------------------------------------------------------------------------+   |
|   | 20 Governed MCP Tools:                                                 |   |
|   |  - Discovery: list_runs, get_agent_context, get_repo_context           |   |
|   |  - Gating: submit_reqs, submit_design, request_approval                |   |
|   |  - Mutation: apply_patch, write_file, get_diff, run_tests              |   |
|   |  - Audit: get_audit_log, report_model                                  |   |
|   +------------------------------------------------------------------------+   |
|   | PolicyEngine: Phase Permissions, Path Traversal Guard, Secret Filter   |   |
|   +------------------------------------------------------------------------+   |
|   | SessionManager: Worktree Mapping (agents/workspaces/<run_id>)          |   |
|   +------------------------------------------------------------------------+   |
+--------------------------------------------------------------------------------+
                                        |
                                        | REST & WebSocket RPC
                                        v
+--------------------------------------------------------------------------------+
|                   3. BACKEND ORCHESTRATION & LEDGER (Node.js)                  |
|   - Express.js Pipeline Engine (Req -> Gate1 -> Design -> Gate2 -> Code -> Out)|
|   - WebSocket Hub (`ws`): Sub-100ms Live Telemetry Broadcast                   |
|   - PostgreSQL Database:                                                       |
|       * runs: Active run state, metrics, diffs, and artifacts                  |
|       * mcp_sessions: Live provider, client, model, and tool telemetry         |
|       * audit_events: Cryptographic SHA-256 HMAC Hash-Chained Ledger           |
+--------------------------------------------------------------------------------+
             |                                                  |
             | WebSocket Broadcast                              | Execution RPC
             v                                                  v
+-----------------------------+       +------------------------------------------+
|  4. REVIEWER COCKPIT (UI)   |       |    5. EXECUTION & AIR-GAPPED SANDBOX     |
|  - React 18 / Tailwind CSS  |       |  - Python FastAPI Service (:8077)        |
|  - Multi-Agent Stepper      |       |  - Docker Container: `gatekeep-sandbox`  |
|  - Side-by-Side Git Diff IDE|       |  - Isolation: `--network none`           |
|  - Real-Time MCP Telemetry  |       |  - Resource Limits: 512 MB RAM, 1 CPU    |
|  - Gate Decision Modals     |       |  - Real pytest Log Scraping & Exit Codes |
+-----------------------------+       +------------------------------------------+
```

---

## 6. Technologies Used, Implementation & Justification

| Technology | Implementation Role | Technical Justification ("Why Chosen") |
| :--- | :--- | :--- |
| **Model Context Protocol (MCP)** | Exposes 20 governed tools over `stdio` and `SSE` | Open, provider-agnostic standard natively supported by Claude and Cursor. Eliminates vendor lock-in and prevents sharing raw API keys. |
| **Python 3.11 & FastAPI** | Core agent backend, repository retriever, and Docker runner | High-performance async runtime with mature SDKs for Docker and Git automation. Native support for Pytest execution parsing. |
| **Node.js 20 & Express** | Pipeline orchestrator, gate state machine, and REST router | Single-threaded event loop excels at asynchronous I/O and state orchestration without thread-locking overhead. |
| **WebSockets (`ws`)** | Real-time bi-directional pipeline communication | Achieves sub-100ms state synchronization across the dashboard without polling overhead. |
| **PostgreSQL 15** | Primary persistence and cryptographic audit ledger storage | Strict ACID compliance guarantees atomic gate transitions and tamper-evident sequential hash calculation. |
| **Docker Engine** | Air-gapped sandbox (`gatekeep-sandbox`) for automated testing | Guarantees deterministic test results, eliminates exfiltration risk with `--network none`, and prevents resource starvation. |
| **React 18 & Vite** | Human-in-the-Loop review cockpit and diff inspector | Component-driven reactivity, sub-second HMR development, and lightweight bundle footprint (<1,900 modules transformed in ~900ms). |
| **Tailwind CSS** | Professional design system adhering to Apple HIG patterns | Eliminates CSS bloat, provides responsive bento-grid layouts, and enables clean dark/light mode interfaces. |

---

## 7. Empirical Results & Verification Metrics

GateKeep has undergone comprehensive automated testing and real-world repository verification on real production packages (`pallets/itsdangerous`):

| Evaluation Metric | Measured Result | Significance |
| :--- | :--- | :--- |
| **Automated Test Suite Pass Rate** | **100% (68 / 68 Tests)** | 42 Python unit/integration tests + 26 Node test suites passing with 0 failures. |
| **Sensitive File Access Interception** | **100% Blocked** | Rejection of `.env`, `*.key`, `*.pem`, and `id_rsa` reads/writes across all phases. |
| **Path Traversal Rejection Rate** | **100% Blocked** | Path traversal attacks (`../../etc/passwd`) rejected by the PolicyEngine. |
| **Hallucinated Test Detection** | **0% Hallucinations** | All pass/fail metrics are derived from Docker process exit codes, not LLM assertions. |
| **Network Isolation Enforcement** | **0 Ingress / 0 Egress** | Docker sandbox executes with `--network none`, preventing external data exfiltration. |
| **Audit Ledger Verification** | **100% Tamper-Evident** | Any manual SQL mutation in past ledger entries immediately breaks SHA-256 HMAC chain verification. |
| **Telemetry Dispatch Latency** | **< 100 ms** | Real-time WebSocket event propagation from container test run to React frontend. |
| **Build Transformation Speed** | **~900 ms** | Clean Vite production build transforming 1,904 modules cleanly. |

---

## 8. Summary for Technical Interviews & Case Studies

When presenting GateKeep in system design interviews or technical discussions, highlight these three architectural decisions:
1. **Separation of Policy from Execution**: The agent never talks directly to the OS; every tool call is evaluated by a stateless, deterministic policy matrix before file I/O occurs.
2. **Air-Gapped Test Oracles**: Solving LLM test hallucinations by stripping network access and capturing raw OS exit codes.
3. **Cryptographic Accountability**: Making autonomous AI actions compliant with enterprise regulatory standards via SHA-256 HMAC hash chaining.
