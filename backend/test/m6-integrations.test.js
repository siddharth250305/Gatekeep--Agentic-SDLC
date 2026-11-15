// Milestone 6, I1: the shipped Claude Code and Cursor settings leave the robot
// no way to edit files or run shell commands except through GateKeep.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = new URL('../../integrations/', import.meta.url)
const file = (rel) => fileURLToPath(new URL(rel, root))
const readJson = (rel) => JSON.parse(readFileSync(file(rel), 'utf8'))

const CLAUDE_GUARD = 'claude-code/.claude/hooks/gatekeep-guard.mjs'
const CURSOR_GUARD = 'cursor/.cursor/hooks/gatekeep-guard.mjs'

function hook(rel, input, env = {}) {
  const res = spawnSync(process.execPath, [file(rel)], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8',
    env: { PATH: process.env.PATH, ...env },
  })
  let out = null
  try { out = res.stdout.trim() ? JSON.parse(res.stdout) : null } catch { out = res.stdout }
  return { code: res.status, out, stderr: res.stderr }
}

const claudeDecision = (tool, input = {}) => {
  const r = hook(CLAUDE_GUARD, { hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input, session_id: 's', cwd: '/tmp' })
  return { code: r.code, decision: r.out?.hookSpecificOutput?.permissionDecision ?? null, reason: r.out?.hookSpecificOutput?.permissionDecisionReason }
}

test('the Claude Code guard denies every built-in tool that reads, edits, runs or fetches (I1)', () => {
  const builtins = ['Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Task', 'Agent', 'BashOutput', 'KillShell']
  for (const tool of builtins) {
    const r = claudeDecision(tool, { command: 'curl -X POST http://localhost:4040/runs/RUN-1/decide' })
    assert.equal(r.code, 0, tool)
    assert.equal(r.decision, 'deny', tool)
    assert.match(r.reason, /GateKeep/)
  }
})

test('the Claude Code guard denies tools of any other MCP server and unknown tools (allowlist, I1)', () => {
  for (const tool of ['mcp__filesystem__write_file', 'mcp__gatekeeper__write_file', 'mcp__gatekeep', 'SomethingNew', 'mcp__gatekeep__x__gatekeep_write_file', 'mcp__gatekeep__evil_tool']) {
    assert.equal(claudeDecision(tool).decision, 'deny', tool)
  }
})

test('the Claude Code guard lets GateKeep tools through (I1)', () => {
  for (const tool of ['mcp__gatekeep__gatekeep_write_file', 'mcp__gatekeep__gatekeep_run_tests', 'TodoWrite']) {
    const r = claudeDecision(tool)
    assert.equal(r.code, 0, tool)
    assert.notEqual(r.decision, 'deny', tool)
  }
})

test('the server name can be changed, still as an allowlist (I1)', () => {
  const r = hook(CLAUDE_GUARD, { hook_event_name: 'PreToolUse', tool_name: 'mcp__gk_prod__gatekeep_read_file' }, { GATEKEEP_MCP_SERVER: 'gk_prod' })
  assert.equal(r.out, null)
  const d = hook(CLAUDE_GUARD, { hook_event_name: 'PreToolUse', tool_name: 'mcp__gatekeep__gatekeep_read_file' }, { GATEKEEP_MCP_SERVER: 'gk_prod' })
  assert.equal(d.out.hookSpecificOutput.permissionDecision, 'deny')
})

test('broken hook input blocks the call (fail closed, I1)', () => {
  for (const input of ['not json', '', '{"hook_event_name":"PreToolUse"}']) {
    const r = hook(CLAUDE_GUARD, input)
    assert.equal(r.code, 2, JSON.stringify(input))
    assert.match(r.stderr, /GateKeep/)
  }
})

test('the shipped Claude Code settings deny the built-in tools and run the guard on every call (I1)', () => {
  const s = readJson('claude-code/.claude/settings.json')
  for (const tool of ['Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Read', 'WebFetch', 'Agent', 'LS', 'BashOutput', 'KillShell', 'Skill', 'SlashCommand']) {
    assert.ok(s.permissions.deny.includes(tool), tool)
  }
  assert.ok(s.permissions.allow.includes('mcp__gatekeep'))
  assert.equal(s.permissions.disableBypassPermissionsMode, 'disable')
  const pre = s.hooks.PreToolUse
  assert.equal(pre.length, 1)
  assert.equal(pre[0].matcher, '*')
  assert.match(pre[0].hooks[0].command, /gatekeep-guard\.mjs/)
  assert.deepEqual(s.enabledMcpjsonServers, ['gatekeep'])
  const mcp = readJson('claude-code/.mcp.json')
  assert.ok(mcp.mcpServers.gatekeep)
})

test('the Cursor guard denies shell commands and direct file reads, and allows only GateKeep MCP (I1)', () => {
  const shell = hook(CURSOR_GUARD, { hook_event_name: 'beforeShellExecution', command: 'rm -rf .', cwd: '/tmp' })
  assert.equal(shell.code, 0)
  assert.equal(shell.out.permission, 'deny')
  const read = hook(CURSOR_GUARD, { hook_event_name: 'beforeReadFile', file_path: '/repo/.env', content: 'SECRET=1' })
  assert.equal(read.out.permission, 'deny')
  const HOME = { GATEKEEP_HOME: '/opt/gatekeep' }
  const real = '/opt/gatekeep/agents/.venv/bin/python /opt/gatekeep/agents/app/mcp/server.py --transport stdio'
  const gk = hook(CURSOR_GUARD, { hook_event_name: 'beforeMCPExecution', tool_name: 'gatekeep_write_file', command: real }, HOME)
  assert.equal(gk.out.permission, 'allow')
  // Review: a command that only mentions server.py is not GateKeep, and with no
  // GATEKEEP_HOME (or GATEKEEP_MCP_URL) nothing is allowed (fail closed).
  const spoof = hook(CURSOR_GUARD, { hook_event_name: 'beforeMCPExecution', tool_name: 'gatekeep_write_file', command: 'python evil.py app/mcp/server.py' }, HOME)
  assert.equal(spoof.out.permission, 'deny')
  assert.equal(hook(CURSOR_GUARD, { hook_event_name: 'beforeMCPExecution', tool_name: 'gatekeep_write_file', command: real }).out.permission, 'deny')
  const other = hook(CURSOR_GUARD, { hook_event_name: 'beforeMCPExecution', tool_name: 'write_file', command: 'npx @modelcontextprotocol/server-filesystem' })
  assert.equal(other.out.permission, 'deny')
  assert.equal(hook(CURSOR_GUARD, 'garbage').code, 2)
})

test('the shipped Cursor files wire the guard and tell the agent the rules (I1)', () => {
  const h = readJson('cursor/.cursor/hooks.json')
  for (const event of ['beforeShellExecution', 'beforeReadFile', 'beforeMCPExecution']) {
    assert.match(h.hooks[event][0].command, /gatekeep-guard\.mjs/, event)
  }
  const rule = readFileSync(file('cursor/.cursor/rules/gatekeep.mdc'), 'utf8')
  assert.match(rule, /alwaysApply: true/)
  assert.match(rule, /gatekeep_write_file/)
  assert.ok(readJson('cursor/.cursor/mcp.json').mcpServers.gatekeep)
})
