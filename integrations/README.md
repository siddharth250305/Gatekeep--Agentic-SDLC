# GateKeep integrations

GateKeep only governs an agent that has no other way to change your code. These
files make that true for Claude Code and Cursor (I1), and make GateKeep a
required check on GitHub (I6).

## Claude Code (`claude-code/`)

Copy into the root of the project the agent works on:

```bash
cp -R integrations/claude-code/.claude integrations/claude-code/.mcp.json /path/to/project/
export GATEKEEP_HOME=/path/to/gatekeeper GATEKEEP_API_TOKEN=gka_...   # agent token: npm run token:create
```

- `.claude/settings.json` denies Claude Code's built-in tools that read, edit,
  run or fetch (`Bash`, `Edit`, `Write`, `MultiEdit`, `NotebookEdit`, `Read`,
  `Glob`, `Grep`, `WebFetch`, `WebSearch`, `Task`, `Agent`, ...), allows the
  GateKeep MCP server, and turns off bypass-permissions mode.
- `.claude/hooks/gatekeep-guard.mjs` runs before **every** tool call and is an
  allowlist: only `mcp__gatekeep__gatekeep_*` (and `TodoWrite`) get through.
  Every other tool, including tools added to Claude Code later and tools of
  other MCP servers, is denied with a message telling the agent to use GateKeep.
  Unreadable hook input blocks the call.
- `.mcp.json` starts the GateKeep MCP server for the project.

Limits: project settings can be overridden by a person's own local settings.
For a team, install the same `permissions` and `hooks` as managed (enterprise)
settings, which users cannot override. If `node` is missing the hook cannot
run; the `permissions.deny` list still blocks the built-in tools.

## Cursor (`cursor/`)

```bash
cp -R integrations/cursor/.cursor /path/to/project/
export GATEKEEP_HOME=/path/to/gatekeeper GATEKEEP_API_TOKEN=gka_...
```

- `.cursor/hooks.json` + `hooks/gatekeep-guard.mjs`: every shell command and
  every direct file read is denied; MCP calls are allowed only for GateKeep's
  own tools from the exact server command under `$GATEKEEP_HOME` (or
  `$GATEKEEP_MCP_URL`). With neither set, no MCP tool is allowed.
- `.cursor/rules/gatekeep.mdc` (always applied) tells the agent to change code
  only through GateKeep and explains the REQ-ID / file-plan / test-name rules.
- `.cursor/mcp.json` starts the GateKeep MCP server.

Limit: Cursor's hooks cannot stop its built-in editor before a change happens.
The rule tells the agent not to use it, and anything changed outside GateKeep
never reaches a GateKeep run (the reviewer approves only the run's workspace).

## GitHub required check (`github/`)

`gatekeep-check.yml` verifies the signed evidence GateKeep commits with every
Pull Request it opens (`.gatekeep/evidence/<run>.json`) and checks that the
PR's code is exactly the approved code. See the comments in the file for setup.
The same check runs locally:

```bash
node backend/src/evidence/verify.js .gatekeep/evidence/RUN-1.json --public-key gatekeep.pub.pem --tree .
```
