# GateKeep Model Context Protocol (MCP) Integration Guide

GateKeep provides a **provider-agnostic MCP governance layer** for external AI coding agents.

Rather than GateKeep calling external LLMs via proprietary API keys, external LLMs connect to GateKeep as MCP clients and operate strictly within GateKeep's governed environment.

```
External LLM Client (Claude / Cursor / Other)
        │
        │ MCP (SSE over HTTP / stdio)
        ▼
┌──────────────────────────────────────────────┐
│       GateKeep MCP Server (:8078)            │
│                                              │
│  • Session ↔ Run Binding                     │
│  • Phase-Aware Policy Enforcement            │
│  • Security Globs & Path Traversal Guard     │
│  • 20 Governed Tools                         │
└──────────────────────┬───────────────────────┘
                       │
        ┌──────────────┴──────────────┐
        ▼                             ▼
┌───────────────┐             ┌───────────────┐
│ Node API :4040│             │ Docker Sandbox│
│ PostgreSQL    │             │ Pytest        │
│ SHA-256 Audit │             │ Workspaces    │
└───────┬───────┘             └───────────────┘
        ▼
GateKeep Dashboard (:5180)
```

---

## 1. Quickstart

### Step 1: Start GateKeep Services
Ensure PostgreSQL and Node backend are running:
```bash
./scripts/dev.sh start
```

### Step 2: Start the MCP Server
In a separate terminal or service manager:
```bash
cd agents
.venv/bin/python -m app.mcp.server
```
The MCP server listens on `http://127.0.0.1:8078/sse` (this machine only). Set `GATEKEEP_MCP_HOST` or pass `--host` to expose it on another interface.

---

## 2. Client Configurations

### A. Claude Desktop
Add GateKeep to your `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "gatekeep": {
      "command": "/Users/adeshsiddharth123/gatekeeper/agents/.venv/bin/python",
      "args": ["-m", "app.mcp.server"],
      "cwd": "/Users/adeshsiddharth123/gatekeeper/agents",
      "env": {
        "GATEKEEP_API": "http://localhost:4040",
        "GATEKEEP_API_TOKEN": "<agent token>"
      }
    }
  }
}
```

The MCP server calls the GateKeep backend with an **agent token**. Create one in `backend/` with `npm run token:create -- --name claude-desktop`. Agent tokens can submit work but can never approve a gate. stdio needs no MCP token because nothing goes over the network.

### B. Cursor
Network transports (SSE, streamable HTTP) require a bearer token. Start the server with `GATEKEEP_MCP_TOKEN` and `GATEKEEP_API_TOKEN` set (`scripts/dev.sh setup` creates both), then add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "gatekeep": {
      "url": "http://localhost:8078/sse",
      "headers": { "Authorization": "Bearer <GATEKEEP_MCP_TOKEN>" }
    }
  }
}
```

Without `GATEKEEP_MCP_TOKEN` the server refuses to start in network mode.

### C. Claude Code (CLI)
When starting Claude Code:
```bash
claude mcp add gatekeep -- python3 -m app.mcp.server
```

---

## 3. The 20 Governed Tools

| Tool | Permitted Phase | Function |
|---|---|---|
| `gatekeep_get_run` | All | Fetch live run state, cost, token totals, and audit chain verification |
| `gatekeep_get_agent_context` | All | Fetch structured context (phase, approved specs, restrictions) |
| `gatekeep_get_repository_context` | All | Retrieve repository manifest, file hierarchy, and keyword-ranked relevant files |
| `gatekeep_list_files` | All | List tracked source files in the workspace |
| `gatekeep_read_file` | All | Read file content (scrubbed of secrets, size-capped) |
| `gatekeep_search_code` | All | Search workspace code for symbols or keywords |
| `gatekeep_get_requirements_context` | `req` | Fetch existing requirements draft |
| `gatekeep_submit_requirements` | `req` | Hand the requirements to the backend, which opens **Gate 1 (Planner)** if the move is allowed (refusals are returned, nothing is stored) |
| `gatekeep_get_design_context` | `design` | Fetch approved requirements to draft technical design |
| `gatekeep_submit_design` | `design` | Hand the design to the backend, which opens **Gate 2 (Engineer)** if the move is allowed |
| `gatekeep_apply_patch` | `code` | Surgical find-and-replace modification |
| `gatekeep_write_file` | `code` | Controlled file write/overwrite inside workspace |
| `gatekeep_get_diff` | `code` | Extract git diff of unstaged/staged modifications |
| `gatekeep_run_tests` | `code` | Trigger Pytest execution inside a no-network Docker container |
| `gatekeep_get_test_results` | `code` | Fetch latest container execution output and assertion count |
| `gatekeep_request_approval` | `code` (no-op at `g3`) | Ask for code review: moves the run from Code to **Gate 3 (Engineer)**. Coding tools are closed at Gate 3 |
| `gatekeep_get_approval_status` | All | Check whether the active gate has been approved or rework requested |
| `gatekeep_get_audit_log` | All | Inspect the cryptographic SHA-256 hash chain of the current run |

---

## 4. Policy Engine Guarantees

Even if the external model attempts to hallucinate or bypass steps:

1. **Phase Restriction**: Attempting to call `apply_patch` during the `req` (Requirements) phase returns:
   `{"error": "Tool 'apply_patch' is not allowed in phase 'req'. Allowed in: ['code']"}`
2. **File Protection**: Attempting to read or write to sensitive configurations (`.env`, `*.pem`, `*.key`, `id_rsa`) returns:
   `{"error": "Cannot write to '.env' — blocked by security policy"}`
3. **Path Traversal Guard**: Attempting relative escapes (`../../etc/passwd`) returns:
   `{"error": "Path traversal (..) is not allowed"}`
4. **Human In The Loop**: No phase transition past a gate can occur without a human reviewer approving on the GateKeep Dashboard.
