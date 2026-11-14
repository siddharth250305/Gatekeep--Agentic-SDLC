// Test evidence for Gate 3 (B7): a code fingerprint and a test run on it.
import { recordTestRun, robotAction } from '../../src/runs/service.js'

export const FP = 'a'.repeat(64)
export const OTHER_FP = 'b'.repeat(64)

export const PASSING = {
  fingerprint: FP, status: 'Passed', passed: 3, failed: 0, skipped: 0, total: 3, duration_ms: 1200,
  output: '3 passed',
  cases: [
    { name: 'test_old', file: 'tests/test_app.py', outcome: 'passed', new: false },
    { name: 'test_limit', file: 'tests/test_limit.py', outcome: 'passed', new: true },
    { name: 'test_429', file: 'tests/test_limit.py', outcome: 'passed', new: true },
  ],
  missing_existing: [],
}

// The robot's usual Code step: a passing test run on FP, then request review on FP.
export async function handOver(db, runId, { agent = 'mcp', testRun = PASSING, fingerprint = FP } = {}) {
  if (testRun) {
    const tr = await recordTestRun(db, runId, testRun, { agent })
    if (tr.error) throw new Error(`test run refused: ${tr.error}`)
  }
  return robotAction(db, runId, 'request_review', { agent, fingerprint })
}
