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
│  • 18 Governed Tools                         │
└──────────────────────┬───────────────────────┘
                       │
        ┌──────────────┴──────────────┐
        ▼                             ▼
┌───────────────┐             ┌───────────────┐
│ Node API :4000│             │ Docker Sandbox│
│ PostgreSQL    │             │ Pytest        │
│ SHA-256 Audit │             │ Workspaces    │
└───────┬───────┘             └───────────────┘
        ▼
GateKeep Dashboard (:5173)
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
The MCP server listens on `http://0.0.0.0:8078/sse`.

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
        "GATEKEEP_API": "http://localhost:4000"
      }
    }
  }
}
```

### B. Cursor
In Cursor Settings -> Features -> MCP Servers -> Add New MCP Server:
- **Name**: `gatekeep`
- **Type**: `SSE`
- **URL**: `http://localhost:8078/sse`

### C. Claude Code (CLI)
When starting Claude Code:
```bash
claude mcp add gatekeep -- python3 -m app.mcp.server
```

---

## 3. The 18 Governed Tools

| Tool | Permitted Phase | Function |
|---|---|---|
| `gatekeep_get_run` | All | Fetch live run state, cost, token totals, and audit chain verification |
| `gatekeep_get_agent_context` | All | Fetch structured context (phase, approved specs, restrictions) |
| `gatekeep_get_repository_context` | All | Retrieve repository manifest, file hierarchy, and keyword-ranked relevant files |
| `gatekeep_list_files` | All | List tracked source files in the workspace |
| `gatekeep_read_file` | All | Read file content (scrubbed of secrets, size-capped) |
| `gatekeep_search_code` | All | Search workspace code for symbols or keywords |
| `gatekeep_get_requirements_context` | `req` | Fetch existing requirements draft |
| `gatekeep_submit_requirements` | `req` | Submit user stories and advance pipeline to **Gate 1 (Planner)** |
| `gatekeep_get_design_context` | `design` | Fetch approved requirements to draft technical design |
| `gatekeep_submit_design` | `design` | Submit architectural design and advance pipeline to **Gate 2 (Engineer)** |
| `gatekeep_apply_patch` | `code` | Surgical find-and-replace modification |
| `gatekeep_write_file` | `code` | Controlled file write/overwrite inside workspace |
| `gatekeep_get_diff` | `code` | Extract git diff of unstaged/staged modifications |
| `gatekeep_run_tests` | `code` | Trigger Pytest execution inside air-gapped Docker container |
| `gatekeep_get_test_results` | `code` | Fetch latest container execution output and assertion count |
| `gatekeep_request_approval` | All | Request human review from the assigned role |
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
