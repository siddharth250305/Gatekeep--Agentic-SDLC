#!/usr/bin/env node
// GateKeep guard for Cursor (I1), wired in .cursor/hooks.json:
//   beforeShellExecution  every terminal command the agent wants to run: denied
//   beforeReadFile        a direct file read (could see .env): denied; use gatekeep_read_file
//   beforeMCPExecution    only GateKeep's own MCP tools are allowed
// Broken input blocks the call (exit 2). Cursor's hooks cannot stop its
// built-in file edits before they happen; .cursor/rules/gatekeep.mdc tells the
// agent to edit only through GateKeep, and Gate 3 shows every changed file.
//
// GATEKEEP_HOME: where GateKeep is installed (the same variable .cursor/mcp.json
// uses); only that exact server command is GateKeep. GATEKEEP_MCP_URL: when
// GateKeep runs as an HTTP MCP server, its URL. With neither set, no MCP tool
// is allowed (fail closed).

import { readFileSync } from 'node:fs'

const answer = (permission, message) => {
  process.stdout.write(JSON.stringify({
    permission,
    ...(message ? { userMessage: message, agentMessage: message } : {}),
  }))
  process.exit(0)
}

let input
try {
  input = JSON.parse(readFileSync(0, 'utf8'))
} catch {
  process.stderr.write('GateKeep guard: could not read the hook input, so the action is blocked\n')
  process.exit(2)
}

const USE_GATEKEEP = 'GateKeep governs this project. Read, change and test code only with the GateKeep MCP tools (gatekeep_read_file, gatekeep_apply_patch, gatekeep_write_file, gatekeep_run_tests).'

function isGatekeepServer(inp) {
  const url = process.env.GATEKEEP_MCP_URL
  if (url && typeof inp.url === 'string') return inp.url === url || inp.url.startsWith(`${url.replace(/\/$/, '')}/`)
  const home = process.env.GATEKEEP_HOME?.replace(/\/+$/, '')
  if (!home || typeof inp.command !== 'string') return false
  const [python, script] = inp.command.trim().split(/\s+/)
  return python === `${home}/agents/.venv/bin/python` && script === `${home}/agents/app/mcp/server.py`
}

switch (input?.hook_event_name) {
  case 'beforeShellExecution':
    answer('deny', `Shell commands are off. ${USE_GATEKEEP}`)
    break
  case 'beforeReadFile':
    answer('deny', `Direct file reads are off. ${USE_GATEKEEP}`)
    break
  case 'beforeMCPExecution': {
    const ok = typeof input.tool_name === 'string' && input.tool_name.startsWith('gatekeep_') && isGatekeepServer(input)
    answer(ok ? 'allow' : 'deny', ok ? null : `Only GateKeep's MCP tools are allowed. ${USE_GATEKEEP}`)
    break
  }
  default:
    process.stderr.write('GateKeep guard: unknown hook event, so the action is blocked\n')
    process.exit(2)
}
