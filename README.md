# GateKeep

> A human-in-the-loop control system for AI coding agents. Keeps agents like Claude and Cursor from making unreviewed code changes, stealing secrets, or hallucinating test results.

Built by **Adesh Siddhartha** (Software Engineering student at Blekinge Institute of Technology - BTH).

---

## What is GateKeep?

AI coding assistants (like Claude Desktop, Cursor, or Devin) are genuinely helpful, but letting them run loose in a repository is risky. If you give an agent direct shell access, you quickly run into real problems:

1. **Unrestricted terminal access**: The agent can run destructive commands, install random packages, or edit files outside the project.
2. **Secret leakage**: When an agent gets stuck on a database error, its first instinct is often to inspect `.env`, private keys, or credentials. Once read, those secrets get sent to third-party model APIs in the prompt context.
3. **Skipping planning**: Many agents immediately jump into writing code without writing down requirements or checking the existing architecture. You end up with broken interfaces and messy diffs that need to be completely rewritten.
4. **Hallucinated test runs**: LLMs often claim "all tests passed" when they never actually ran the test suite, when tests crashed with an exit code, or when the tests ran against mocked dummy data.
5. **No paper trail**: When an agent commits code, standard git commits do not tell you which prompt created it, what model produced it, or which human reviewer actually looked at it.

GateKeep solves this by acting as a proxy between the AI agent and your codebase. 

Instead of giving the model direct access to your machine, the agent connects to GateKeep through the **Model Context Protocol (MCP)**. GateKeep forces the agent through a three-stage review pipeline, runs all tests inside an air-gapped Docker container, and records every action in a cryptographic SHA-256 HMAC audit log.

---

## How It Works (The 3-Gate Pipeline)

GateKeep divides the agent's work into three structured phases, each protected by a human review gate:

```
+-------------------------------------------------------------------------------------------------+
|                                    GATEKEEP REVIEW PIPELINE                                     |
+-------------------------------------------------------------------------------------------------+
|                                                                                                 |
|   1. REQUIREMENTS PHASE               2. ARCHITECTURE PHASE             3. CODING & TEST PHASE  |
|   +-----------------------+           +-----------------------+         +---------------------+ |
|   | Agent submits user    |           | Agent submits file    |         | Agent writes code to| |
|   | stories & acceptance  |           | plan, modified files, |         | isolated workspace  | |
|   | criteria              |           | and API contracts     |         | copy                | |
|   +-----------+-----------+           +-----------+-----------+         +----------+----------+ |
|               |                                   |                                |            |
|               v                                   v                                v            |
|   [ GATE 1: PLANNER CHECK ]           [ GATE 2: ARCHITECT CHECK ]       [ AIR-GAPPED DOCKER   ] |
|   Reviewer approves or                Reviewer approves or              Isolated container    |
|   rejects requirements                rejects file plan                 captures real exit    |
|   before any code design              before any code edits             code (pass / fail)    |
|                                                                                    |            |
|                                                                                    v            |
|                                                                         [ GATE 3: CODE REVIEW ] |
|                                                                         Side-by-side git diff   |
|                                                                         Line comments & audit   |
+-------------------------------------------------------------------------------------------------+
```

### 1. Requirements Phase (Gate 1: Planner)
The agent reads the task brief and repository context, then calls `submit_requirements`. It must clearly state what it plans to build, what acceptance criteria it will meet, and what is out of scope. The agent cannot write or patch code during this phase. A human reviewer (acting as Planner) inspects the requirements in the dashboard and either approves or requests rework.

### 2. Architecture Phase (Gate 2: Architect)
Once Gate 1 is approved, the agent enters the design phase and calls `submit_design`. It must specify which files will be created or modified, what interfaces will change, and any potential security risks. The agent still cannot edit files. A human reviewer (acting as Architect or Engineer) checks the file plan and approves it.

### 3. Coding and Testing Phase (Gate 3: Code Review)
Only after Gate 2 is approved can the agent call `apply_patch` or `write_file`. All edits happen in an isolated workspace copy (`agents/workspaces/<run_id>`), never directly on your working tree.
- When the agent calls `run_tests`, GateKeep runs pytest inside an ephemeral Docker container.
- The container has networking disabled (`--network none`) and strict resource limits (512 MB RAM, 1 CPU).
- GateKeep determines pass/fail strictly by checking the process exit code (`exit code 0` vs `!= 0`), so the AI cannot fake or hallucinate passing tests.
- Once tests pass, the human reviewer inspects the side-by-side git diff in the web dashboard, leaves line-level comments if needed, and makes the final decision.

---

## Cryptographic Audit Ledger (SHA-256 HMAC)

Every event in a run is recorded in a PostgreSQL database:
- When a run is created
- What the initial user prompt was
- What requirements and architecture the agent submitted
- When each human reviewer approved or rejected a gate
- Every patch applied and test run executed
- Which model version and client connected over MCP

Each event stores a cryptographic hash that binds the event data, timestamp, actor, and the hash of the previous event (like a lightweight, private blockchain ledger):

```
Event #1 (Run Created)        -> hash: 4a8f9b...
Event #2 (Gate 1 Approved)    -> hash: SHA256(Event #2 + hash #1)
Event #3 (Design Submitted)   -> hash: SHA256(Event #3 + hash #2)
Event #4 (Tampered DB Row!)   -> Hash verification fails immediately!
```

If anyone alters past rows directly in PostgreSQL (for example, trying to cover up an unauthorized edit or spoof an approval), the chain calculation breaks immediately. The dashboard includes a live **"Simulate Tamper Test"** button that proves this live by mutating a past database record and showing the audit badge flip from green to red.

---

## System Architecture

The project is split into four clean components:

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
|   - 20 Governed MCP Tools:                                                     |
|       Discovery: list_runs, get_agent_context, get_repo_context                |
|       Gating: submit_requirements, submit_design, request_approval             |
|       Code/Test: apply_patch, write_file, get_diff, run_tests                  |
|       Audit: get_audit_log, report_model                                       |
|   - PolicyEngine: Enforces phase permissions, blocks path traversal, filters   |
|     sensitive files (.env, *.key, *.pem)                                       |
|   - SessionManager: Maps sessions to isolated workspaces                       |
+--------------------------------------------------------------------------------+
                                        |
                                        | REST & WebSocket RPC
                                        v
+--------------------------------------------------------------------------------+
|                   3. BACKEND ORCHESTRATION & LEDGER (Node.js)                  |
|   - Express.js API & state machine (runs on port 4040)                         |
|   - WebSocket Hub: broadcasts run progress and agent tool calls to UI          |
|   - PostgreSQL Database: stores runs, phases, MCP sessions, and audit events   |
+--------------------------------------------------------------------------------+
             |                                                  |
             | WebSocket Broadcast                              | Docker Run RPC
             v                                                  v
+-----------------------------+       +------------------------------------------+
|  4. REVIEWER DASHBOARD (UI) |       |    5. ISOLATED TEST SANDBOX              |
|  - React 18, Vite (port 5180|       |  - Ephemeral container: gatekeep-sandbox |
|  - Multi-agent stepper      |       |  - Networking: --network none            |
|  - Side-by-side diff IDE    |       |  - Resource limits: 512 MB RAM, 1 CPU    |
|  - Real-time MCP telemetry  |       |  - Captures real pytest logs & exit codes|
|  - Apple light & dark mode  |       |                                          |
+-----------------------------+       +------------------------------------------+
```

---

## Tech Stack and Design Choices

| Component | Technology | Why I Chose It |
| :--- | :--- | :--- |
| **Agent Interface** | Model Context Protocol (MCP) | Open standard supported by Anthropic and Cursor. It means the tool works with multiple models without needing custom API wrappers for each one. |
| **Agent Backend** | Python 3.11 + FastAPI | Python has standard tooling for Git, AST inspection, and pytest parsing. FastAPI makes it simple to run async MCP over stdio and SSE. |
| **Orchestrator** | Node.js 20 + Express | Keeps the state machine fast and simple. Easy to coordinate the database, process events, and manage WebSockets. |
| **Live Updates** | WebSockets (`ws`) | Pushes agent status and tool calls to the frontend instantly so the reviewer does not need to refresh the page. |
| **Database** | PostgreSQL 15 | Relational ACID storage for runs and audit entries. Guarantees that hash chain calculations happen sequentially and reliably. |
| **Sandbox** | Docker Engine | Gives genuine process isolation. Using `--network none` guarantees that untested code cannot phone home or leak credentials. |
| **Frontend** | React 18 + Vite | Fast developer experience with clean component structure. Builds in roughly one second. |
| **Styling** | Tailwind CSS | Clean, custom UI following Apple Human Interface Guidelines. Supports both light mode and pure OLED dark mode. |

---

## Real-World Test Run: Building LogScrub

To test GateKeep in practice, I used it to have an AI agent build a real privacy utility called **LogScrub** (`RUN-1004`).

LogScrub is a CLI tool that automatically masks sensitive personal data (emails, credit card numbers, phone numbers, IP addresses) in application logs before they get shared with support desks or AI chat tools.

### Why LogScrub was a good test:
- **It requires human judgment**: Is `1.2.3.4` an IP address to mask, or is it a software release number? The agent cannot always guess intent correctly; the human reviewer has to set the rule at Gate 1 and Gate 2.
- **It is easy to verify**: Detectors either redact the pattern or they do not. All 131 tests were executed inside the air-gapped container and passed.
- **The audit log matters**: For a privacy tool, being able to verify who approved each redaction rule and when is a real requirement.

---

## Test Results and Security Checks

I tested GateKeep against automated test suites and common attack vectors:

| Test / Metric | Result | What it Means |
| :--- | :--- | :--- |
| **Automated Test Suite** | **68 / 68 Passed (100%)** | 42 Python tests and 26 Node tests pass cleanly with zero failures. |
| **Sensitive File Access** | **100% Blocked** | Attempts to read or write `.env`, `*.key`, `*.pem`, and `id_rsa` are rejected across all phases. |
| **Path Traversal Protection** | **100% Blocked** | Path traversal inputs like `../../etc/passwd` are intercepted and rejected by the policy engine. |
| **Test Hallucination Detection** | **0% Hallucinations** | Pass and fail counts come directly from OS process exit codes, never from the LLM's own summary. |
| **Network Isolation** | **0 Ingress / 0 Egress** | The Docker sandbox runs with `--network none`, stopping any network calls during test execution. |
| **Audit Ledger Verification** | **100% Tamper-Evident** | Any manual change to an existing row in PostgreSQL breaks the SHA-256 HMAC chain immediately. |
| **Live Telemetry Latency** | **< 100 ms** | Agent tool calls and test outputs appear on the React dashboard in real time over WebSockets. |
| **Frontend Build Time** | **~1.1 seconds** | Vite bundles 1,900 modules cleanly with zero warnings. |

---

## Getting Started

### Prerequisites
- Node.js 20+
- Python 3.11+
- Docker Desktop (running)
- PostgreSQL (or run it via the included Docker Compose file)

### 1. Start the Database and Backend

```bash
# Clone the repository
git clone https://github.com/siddharth250305/Gatekeep--Agentic-SDLC.git
cd Gatekeep--Agentic-SDLC

# Start the PostgreSQL container
docker compose -f backend/docker-compose.yml up -d db

# Install dependencies and start the Node backend (port 4040)
cd backend
npm install
npm run seed     # seeds sample runs (RUN-0427, RUN-0426, RUN-0425)
npm start        # starts API and WebSocket server on http://localhost:4040
```

### 2. Start the Python Agent Service

```bash
# From the project root
cd agents
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Start the agent service on port 8077
GATEKEEP_API=http://localhost:4040 uvicorn app.main:app --port 8077
```

### 3. Start the Frontend Dashboard

```bash
# From the project root
npm install
npm run dev      # starts dashboard on http://localhost:5180
```

Open `http://localhost:5180` in your browser. You can click between runs, review diffs, test the dark/light mode toggle, approve gates, or simulate a tamper test.

### 4. Connect Claude Desktop or Cursor over MCP

To let Claude Desktop use GateKeep's tools, add this to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "gatekeep": {
      "command": "/absolute/path/to/gatekeeper/agents/.venv/bin/python",
      "args": ["/absolute/path/to/gatekeeper/agents/app/mcp/server.py", "--transport", "stdio"],
      "cwd": "/absolute/path/to/gatekeeper/agents",
      "env": {
        "PYTHONPATH": "/absolute/path/to/gatekeeper/agents",
        "GATEKEEP_API": "http://localhost:4040"
      }
    }
  }
}
```

---

## Project Structure

```
gatekeeper/
├── agents/                  # Python agent backend & MCP server
│   ├── app/
│   │   ├── mcp/             # MCP tool definitions, session manager, policy engine
│   │   ├── graph.py         # LangGraph workflow definition
│   │   └── sandbox/         # Docker test runner (--network none)
│   └── tests/               # Unit and integration test suites
├── backend/                 # Node.js orchestration backend
│   ├── src/
│   │   ├── server.js        # Express server & WebSocket hub (port 4040)
│   │   ├── db.js            # PostgreSQL connection pool & schema migration
│   │   └── runs/            # Run routes, HMAC audit ledger, seeds
├── src/                     # React 18 review dashboard
│   ├── components/          # Pipeline stepper, diff viewer, status pills, modals
│   ├── components/views/    # Overview, Specs & Design, Code Review, Tests, Audit
│   ├── App.jsx              # Main dashboard container & theme switcher
│   └── index.css            # Apple HIG theme system with light and dark modes
├── scripts/                 # Development helper scripts (dev.sh)
├── docs/                    # MCP integration guide and architecture notes
├── mcp_config.json          # Example Claude Desktop MCP configuration
└── backend/docker-compose.yml # PostgreSQL database container
```

---

## Key Takeaways from Building This

1. **Keep policy checks separate from execution**: The AI model never talks directly to the operating system. Every tool request is checked against the current phase before any file is read or written.
2. **Do not trust agent-reported test results**: Language models are prone to hallucinating passes. Running tests inside a network-isolated Docker container and checking the real process exit code is the only reliable way to know if code actually works.
3. **Cryptographic logs keep everyone honest**: Tying every prompt, patch, and approval into a SHA-256 HMAC hash chain makes it mathematically impossible to alter past actions without being noticed.

---

## Author

**Adesh Siddhartha**
Software Engineering Student, Blekinge Institute of Technology (BTH)
GitHub: [@siddharth250305](https://github.com/siddharth250305)
