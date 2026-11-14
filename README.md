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

Instead of giving the model direct access to your machine, the agent connects to GateKeep through the **Model Context Protocol (MCP)**. GateKeep forces the agent through a three-stage review pipeline, runs all tests inside a Docker container with networking disabled, and records every action in an HMAC-SHA256 chained audit log.

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
- When the agent calls `run_tests`, GateKeep runs the project's **whole** pytest suite inside an ephemeral Docker container. The agent cannot narrow the run to its own test file: existing tests always run, each test is marked **new** or **existing** (compared with the commit the workspace was cloned at), and an existing test that no longer runs fails the run.
- Tests run on a copy of the workspace with secret files and folders (`.env`, keys, `.ssh/`, `.git/`, ...) and unsafe shortcuts removed, so test code cannot open them. Test output is redacted before anyone sees it.
- The container has networking disabled (`--network none`) and strict resource limits (512 MB RAM, 1 CPU).
- Counts come from the JUnit XML report pytest writes to a separate mount, never from printed text, so a test that prints `999 passed` changes nothing. Pass/fail also needs exit code 0 and at least one test. Docker being down, a timeout, zero collected tests, or a missing report are reported as "Sandbox unavailable", "Timed out", "No tests ran" or "Failed", never as a pass.
- Every test run is stored with a **fingerprint** (SHA-256) of the exact code it ran on.
- When the code is ready, the agent calls `request_approval`. The workspace is **frozen** (no more writes), and the run moves from Code to **Gate 3**, a real human step for an Engineer, carrying the fingerprint of the handed-over code.
- At Gate 3 the reviewer inspects the side-by-side git diff in the web dashboard, leaves line-level comments if needed, and either approves (the run is **Done**) or sends the work back to **Code** or to **Design** (which lifts the freeze). The person who asked for the run cannot give this final approval. **Approve only works on the exact tested version:** if the code changed after the last test run, or that run did not pass, Approve is disabled with the reason and the server refuses it. The approval's audit entry records the fingerprint and the test run ID.

### One state machine decides every step change
The Node backend owns run state ([ADR 0001](docs/adr/0001-node-owns-run-state.md)). Every step change goes through one fixed table of allowed moves (`backend/src/runs/machine.js`):

| From | Action | To | Who |
|---|---|---|---|
| Requirements | submit requirements | Gate 1 | Robot |
| Gate 1 | approve / reject | Design / Requirements | Planner |
| Design | submit design | Gate 2 | Robot |
| Gate 2 | approve / reject | Code / Design | Engineer |
| Code | request review | Gate 3 | Robot |
| Gate 3 | approve / reject to code / reject to design | Done / Code / Design | Engineer (not the requester) |
| Any active step | cancel | Cancelled | Planner or Engineer |
| Done or Cancelled | anything | refused | Nobody |

Any move not in the table is refused, and an unknown step refuses everything. An Admin may act for any human role. Each move locks the run, and writes exactly one audit entry with the logged-in name and the server's clock, in one database transaction. Pressing Approve twice, or a robot sending the same submission twice, never moves the run twice. There is no other way to change a run's step: the old `PATCH /runs/:id` route is gone, phase rows accept metrics only, and agents cannot write approval or step events into the audit log.

---

## Audit Ledger (HMAC-SHA256 Chain)

Every event in a run is recorded in a PostgreSQL database:
- When a run is created
- What the initial user prompt was
- What requirements and architecture the agent submitted
- When each human reviewer approved or rejected a gate
- Every patch applied and test run executed
- Which model version and client connected over MCP

Each event stores a stamp: an **HMAC-SHA256** over the event data, timestamp, actor, **run ID**, and the stamp of the previous event, made with a secret key kept outside the database (`GATEKEEP_AUDIT_KEY`, at least 32 characters; the server refuses to start without it):

```
Event #1 (Run Created)        -> stamp: HMAC(key, run + Event #1 + 000...)
Event #2 (Gate 1 Approved)    -> stamp: HMAC(key, run + Event #2 + stamp #1)
Event #3 (Design Submitted)   -> stamp: HMAC(key, run + Event #3 + stamp #2)
Event #4 (Tampered DB Row!)   -> verification fails at this row
```

The latest stamp and entry count of each run are also kept in `audit_heads`, sealed with their own HMAC. So verification catches:
- a past row that was edited, even if the attacker recomputes every plain SHA-256 hash (they do not have the key);
- entries copied in from another run (the run ID is in the stamp);
- the newest entries deleted, or the head moved back to hide that, or the head row deleted (and a chain with a deleted head can no longer be extended).

In demo mode (`GATEKEEP_DEMO_MODE=1`, set by `scripts/dev.sh`) the dashboard shows a **"Simulate Tamper Test"** button that proves this by mutating a past database record and showing the audit badge flip from green to red.

**Limits today:** anyone who has the key (the server's environment) can forge stamps. A database attacker who saved an *older* sealed head row could put it back together with the matching older entries (a rollback); an anchor outside the database would close that. Chains written before this change (plain SHA-256) no longer verify; reset dev data with `scripts/dev.sh reset`.

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
| **Automated Test Suite** | **293 Python + 156 Node + 18 dashboard passing** | Counts are collected test cases (parametrized cases count separately). The 156 Node tests run on a real Postgres (`npm run test:pg`); 7 of them need real locking and are skipped under the in-memory `npm test`. Includes 3 real Docker sandbox tests. |
| **Sensitive File Access** | **Blocked, including through shortcuts** | One block list (`.env*`, keys, `id_*`, credential files, `*.tfstate`, `.ssh/`, `.aws/`, `.git/`, ...). Every tool (read, write, search, file list, repository context) checks the real file behind a symlink, and refuses shortcuts to blocked files or outside the workspace. Secret files are removed from the sandbox copy before tests run. |
| **Secret Redaction** | **Every output** | File reads, search results, diffs, repository context and test output have secret values replaced with `***`: whole private-key blocks, known token formats, and `key = "value"`, `KEY=value` and `key: value` lines. Search matches on the redacted text, so it cannot confirm a secret value. Pattern-based: an unusual secret format can still slip through. |
| **Path Traversal Protection** | **Blocked** | `..` segments (with `/` or `\`) are rejected by the policy engine, and every resolved path must stay inside the run workspace. |
| **Test Result Integrity** | **JUnit report + exit code** | Counts come from pytest's JUnit XML report, never from printed text or the LLM's summary. The whole suite always runs and existing tests must keep running. The agent still writes its own new tests, so a weak new test can pass; test code that attacks pytest itself (a `conftest.py` rewriting the report) is not stopped, but the reviewer sees it in the diff. |
| **Approval Integrity** | **Exact tested version** | Gate 3 approval is bound to the code fingerprint and the test run ID; the workspace is frozen while review is pending. |
| **Network Isolation** | **No network** | The Docker sandbox runs with `--network none`, no Linux capabilities, a read-only code mount and capped memory, CPU, processes and `/tmp`. |
| **Audit Ledger Verification** | **HMAC + sealed head** | Edited rows (even with recomputed SHA-256), copied rows and deleted newest rows are detected. See the limits in the Audit Ledger section above. |
| **Live Telemetry Latency** | **< 100 ms** | Agent tool calls and test outputs appear on the React dashboard in real time over WebSockets. |
| **Frontend Build Time** | **~1.1 seconds** | Vite bundles 1,900 modules cleanly with zero warnings. |

---

## Known Limitations

GateKeep is a student project and is not production-ready yet. The main gaps, explained in simple English in [`drawback.md`](drawback.md) with a fix plan in [`organised.md`](organised.md):

- **Agents with their own tools can go around GateKeep.** Claude Code and Cursor keep their built-in Edit and Bash tools unless you restrict them.
- **Audit log rollback**: a database attacker who kept an old sealed head can roll a run's diary back to that point (no anchor outside the database yet).
- **Test code runs inside pytest**: a test written to attack pytest itself can still lie about its own results.

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
# The audit diary's HMAC key (kept outside the database; the server will not start without it)
export GATEKEEP_AUDIT_KEY=$(openssl rand -hex 32)
npm start        # starts API and WebSocket server on http://localhost:4040
```

**Shortcut:** `scripts/dev.sh setup` creates the agent token, pipeline secret, MCP token, audit key and your account in one go, and `scripts/dev.sh start` runs everything with them.

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
│   │   └── runs/            # Run routes, state machine, test runs, seeds
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
3. **Hash-chained logs need a key**: Tying every prompt, patch, and approval into a plain SHA-256 chain only catches careless edits; anyone with database access can recompute it. A keyed HMAC, the run ID in each stamp, and a sealed head make edits, copies and deletions detectable. An anchor outside the database is the remaining step.

---

## Author

**Adesh Siddhartha**
Software Engineering Student, Blekinge Institute of Technology (BTH)
GitHub: [@siddharth250305](https://github.com/siddharth250305)
