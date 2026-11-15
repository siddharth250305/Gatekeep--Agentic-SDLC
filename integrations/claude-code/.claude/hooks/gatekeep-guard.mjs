#!/usr/bin/env node
// GateKeep guard for Claude Code (I1): a PreToolUse hook that lets the agent
// use only GateKeep's MCP tools. Built-in Edit / Write / Bash / Read / Grep /
// WebFetch / Task ... and every other MCP server are denied, so all file
// changes, test runs and hand-overs go through GateKeep's policy, sandbox and
// audit log. It is an allowlist: a tool added to Claude Code later is denied
// until it is listed here.
//
// Wired in .claude/settings.json (PreToolUse, matcher "*"). Broken input
// blocks the call (exit 2): when in doubt, no.
//
// GATEKEEP_MCP_SERVER: the name of the GateKeep server in .mcp.json (default "gatekeep").

import { readFileSync } from 'node:fs'

const server = process.env.GATEKEEP_MCP_SERVER || 'gatekeep'
// Exactly GateKeep's own tools on that server: a server named 'gatekeep__x'
// (tools 'mcp__gatekeep__x__...') or a tool not called gatekeep_* is denied.
const escaped = server.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const GATEKEEP_TOOL = new RegExp(`^mcp__${escaped}__gatekeep_[a-z0-9_]+$`)
// Harmless built-ins that touch neither files, shell nor network.
const ALLOWED_TOOLS = new Set(['TodoWrite'])

function block(message) {
  process.stderr.write(`GateKeep guard: ${message}\n`)
  process.exit(2)
}

let input
try {
  input = JSON.parse(readFileSync(0, 'utf8'))
} catch {
  block('could not read the hook input, so the tool call is blocked')
}
const tool = input?.tool_name
if (typeof tool !== 'string' || !tool) block('the hook input names no tool, so the call is blocked')

if (ALLOWED_TOOLS.has(tool) || GATEKEEP_TOOL.test(tool)) {
  process.exit(0) // normal permission rules apply (settings.json allows mcp__gatekeep)
}

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason:
      `GateKeep governs this project: '${tool}' is not allowed. Read, change and test code only with the ` +
      `GateKeep tools (gatekeep_read_file, gatekeep_apply_patch, gatekeep_write_file, gatekeep_run_tests, ` +
      `gatekeep_request_approval). Humans approve every gate on the GateKeep dashboard.`,
  },
}))
process.exit(0)
