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

Instead of giving the model direct access to your machine, the agent connects to GateKeep through the **Model Context Protocol (MCP)**. GateKeep forces the agent through a three-stage review pipeline, runs all tests inside a Docker container with networking disabled, and records every action in a SHA-256 hash-chained audit log.

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
|   [ GATE 1: PLANNER CHECK ]           [ GATE 2: ARCHITECT CHECK ]       [ NO-NETWORK DOCKER   ] |
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
- GateKeep decides pass/fail from the process exit code, not from the AI's summary. A run only counts as **Passed** when pytest exits with 0 and at least one test ran. Docker being down, a timeout, or zero collected tests are reported as "Sandbox unavailable", "Timed out" or "No tests ran", never as a pass.
- Once tests pass, the human reviewer inspects the side-by-side git diff in the web dashboard, leaves line-level comments if needed, and makes the final decision.

---

## Audit Ledger (SHA-256 Hash Chain)

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

If anyone alters a past row directly in PostgreSQL (for example, to cover up an unauthorized edit or spoof an approval) and does not recompute the hashes, verification fails at that row. In demo mode (`GATEKEEP_DEMO_MODE=1`, set by `scripts/dev.sh`) the dashboard shows a **"Simulate Tamper Test"** button that proves this by mutating a past database record and showing the audit badge flip from green to red.

**Limits today:** the hashes are plain SHA-256 with no secret key, so the chain is *tamper-evident*, not tamper-proof. Someone with write access to the database can rewrite a row and recompute every later hash using the public code. Deleting the newest events is also not detected yet. A keyed HMAC and an external anchor for the latest hash are planned (see `organised.md`, items E1 and E4).

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
- **It is easy to verify**: Detectors either redact the pattern or they do not. All 131 tests were executed inside the no-network sandbox container and passed.
- **The audit log matters**: For a privacy tool, being able to verify who approved each redaction rule and when is a real requirement.

---

## Test Results and Security Checks

I tested GateKeep against automated test suites and common attack vectors:

| Test / Metric | Result | What it Means |
| :--- | :--- | :--- |
| **Automated Test Suite** | **146 Python + 62 Node passing** | Counts are collected test cases (parametrized cases count separately). Includes 2 real Docker sandbox tests and 4 locking/rollback tests that run against a real Postgres (`npm run test:pg`, and in CI). |
| **Sensitive File Access** | **Blocked by name** | The MCP file tools refuse `.env`, `*.key`, `*.pem`, `id_rsa` and similar names, plus anything under `.git/`. Not yet covered: symlinks to secrets, secrets printed by test code, and some common names such as `id_ed25519` (see `drawback.md`). |
| **Path Traversal Protection** | **Blocked** | `..` segments (with `/` or `\`) are rejected by the policy engine, and every resolved path must stay inside the run workspace. |
| **Test Result Integrity** | **Exit code decides** | Pass/fail comes from the sandbox exit code and recorded counts, never from the LLM's own summary. The agent still writes its own tests, so a weak test can pass. |
| **Network Isolation** | **No network** | The Docker sandbox runs with `--network none`, no Linux capabilities, a read-only code mount and capped memory, CPU, processes and `/tmp`. |
| **Audit Ledger Verification** | **Tamper-evident** | Editing a past row without recomputing hashes is detected. See the limits in the Audit Ledger section above. |
| **Live Telemetry Latency** | **< 100 ms** | Agent tool calls and test outputs appear on the React dashboard in real time over WebSockets. |
| **Frontend Build Time** | **~1.1 seconds** | Vite bundles 1,900 modules cleanly with zero warnings. |

---

## Known Limitations

GateKeep is a student project and is not production-ready yet. The main gaps, explained in simple English in [`drawback.md`](drawback.md) with a fix plan in [`organised.md`](organised.md):

- **Agent tokens can still change phase state directly.** Only logged-in reviewers can approve a gate, but the agent-side routes (`PUT /runs/:id/phases/:key`, `PATCH /runs/:id`) still accept raw state changes from an agent token, and Gate 3 is not a real phase in the state machine yet. Both are fixed in Milestone 2.
- **Agents with their own tools can go around GateKeep.** Claude Code and Cursor keep their built-in Edit and Bash tools unless you restrict them.
- **Audit log is tamper-evident, not tamper-proof** (plain SHA-256, no secret key).

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

# Create your reviewer account (asks for a password, min 10 characters).
# Roles: Planner (Gate 1), Engineer (Gate 2 and 3), Admin (any gate).
npm run user:create -- --username adesh --name "Adesh" --role Admin

# Create a token for the agent services. It can submit work, never approve.
npm run token:create -- --name agents      # prints gka_... once

# A shared secret so only the backend can resume the agent pipeline
export GATEKEEP_PIPELINE_SECRET=$(openssl rand -hex 32)
npm start        # starts API and WebSocket server on http://localhost:4040
```

**Shortcut:** `scripts/dev.sh setup` creates the agent token, pipeline secret, MCP token and your account in one go, and `scripts/dev.sh start` runs everything with them.

### 2. Start the Python Agent Service

```bash
# From the project root
cd agents
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Start the agent service on port 8077 (same pipeline secret as the backend)
export GATEKEEP_API=http://localhost:4040
export GATEKEEP_API_TOKEN=gka_...            # from npm run token:create
export GATEKEEP_PIPELINE_SECRET=...          # same value as the backend
uvicorn app.main:app --port 8077
```

### 3. Start the Frontend Dashboard

```bash
# From the project root
npm install
npm run dev      # starts dashboard on http://localhost:5180
```

Open `http://localhost:5180` and sign in with the account you created. You can click between runs, review diffs, and approve the gates your role allows. Every decision is recorded under your username in the audit log.

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
        "GATEKEEP_API": "http://localhost:4040",
        "GATEKEEP_API_TOKEN": "gka_..."
      }
    }
  }
}
```

For Cursor (SSE), the MCP server needs `GATEKEEP_MCP_TOKEN` and the client must send it as a bearer token. See [`docs/MCP_GUIDE.md`](docs/MCP_GUIDE.md).

---

## Project Structure

```
gatekeeper/
├── agents/                  # Python agent backend & MCP server
│   ├── app/
│   │   ├── mcp/             # MCP tool definitions, session manager, policy engine
│   │   ├── graph.py         # LangGraph workflow definition
│   │   └── sandbox.py       # Docker test runner (--network none)
│   └── tests/               # Unit and integration test suites
├── backend/                 # Node.js orchestration backend
│   ├── src/
│   │   ├── server.js        # Express server & WebSocket hub (port 4040)
│   │   ├── db.js            # PostgreSQL connection pool & schema migration
│   │   └── runs/            # Run routes, SHA-256 audit ledger, seeds
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
3. **Hash-chained logs make tampering visible**: Tying every prompt, patch, and approval into a SHA-256 hash chain means a careless edit to past events is caught. Making it tamper-proof needs a secret key (HMAC) and an anchor outside the database, which is the next step.

---

## Author

**Adesh Siddhartha**
Software Engineering Student, Blekinge Institute of Technology (BTH)
GitHub: [@siddharth250305](https://github.com/siddharth250305)
