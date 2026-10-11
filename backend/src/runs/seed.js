// Seed demo runs matching the frontend, with REAL audit events so verify works
// and the tamper demo has a live target. Idempotent: skips runs that exist.

import { appendEvent } from '../audit/service.js'
import { createRun, updateRun, upsertPhase, upsertTests, upsertArtifacts } from './service.js'

const SANDBOX = { status: 'Completed', image: 'python:3.12-slim', network: 'Disabled', memory: '512 MB', cpu: '1 core', timeout: '30 seconds' }

async function has(db, runId) {
  const r = await db.query('SELECT 1 FROM runs WHERE run_id = $1', [runId])
  return !!r.rows[0]
}

const RUN_0427_ARTIFACTS = {
  requirements: `### Engineering Requirements: Webhook Rate Limiting\n\n#### 1. Problem Statement\nThe checkout webhook is vulnerable to burst traffic and unauthenticated request floods, creating downstream queue starvation and latency spikes in payment reconciliation.\n\n#### 2. User Stories & Acceptance Criteria\n- **AC-1**: Limit webhook invocations to 60 requests per minute per merchant ID (\`merchant_<id>\`).\n- **AC-2**: When limit is exceeded, immediately return HTTP 429 Too Many Requests with header \`Retry-After: 60\`.\n- **AC-3**: Internal reconciliation worker requests bearing header \`X-Internal-Secret\` must bypass rate limiting entirely.\n- **AC-4**: Sliding window counters stored in Redis with 60-second TTL; no persistent memory leakage.`,
  design: {
    files_to_modify: ['app/middleware/throttle.py', 'app/deps/redis.py', 'app/routes/webhook.py'],
    files_to_create: ['tests/test_throttle.py', 'tests/test_webhook.py'],
    threat_model: 'Spoofing: Internal secret verified using constant-time comparison.\nTampering: Redis counter keys scoped by namespace to prevent merchant collisions.\nDenial of Service: Atomic INCR + EXPIRE sliding window blocks brute-force exhaustion.',
    testing_strategy: [
      'Verify 60 requests succeed within 60 seconds',
      'Verify 61st request returns HTTP 429 with Retry-After header',
      'Verify X-Internal-Secret bypasses throttling under load',
    ],
  },
  files: [
    { path: 'app/middleware/throttle.py', add: 48, rem: 6 },
    { path: 'app/deps/redis.py', add: 12, rem: 3 },
    { path: 'app/routes/webhook.py', add: 20, rem: 4 },
    { path: 'tests/test_throttle.py', add: 64, rem: 0 },
    { path: 'tests/test_webhook.py', add: 18, rem: 2 },
    { path: 'README.md', add: 4, rem: 0 },
  ],
  diff: {
    file: 'app/middleware/throttle.py',
    add: 48,
    rem: 6,
    lines: [
      { n1: 11, n2: 12, type: 'ctx', text: 'class RateLimiter:' },
      { n1: 12, n2: 13, type: 'ctx', text: '    def __init__(self, redis: Redis, limit: int = 60):' },
      { n1: 13, n2: 14, type: 'ctx', text: '        self.redis = redis' },
      { n1: 14, n2: 15, type: 'ctx', text: '        self.limit = limit' },
      { n1: 15, n2: null, type: 'rem', text: '    def is_allowed(self, key: str) -> bool:' },
      { n1: 16, n2: null, type: 'rem', text: '        count = self.redis.incr(key)' },
      { n1: 17, n2: null, type: 'rem', text: '        return count <= self.limit' },
      { n1: null, n2: 16, type: 'add', text: '    def is_allowed(self, key: str) -> tuple[bool, int]:' },
      { n1: null, n2: 17, type: 'add', text: '        current = self.redis.incr(key)' },
      { n1: null, n2: 18, type: 'add', text: '        if current == 1:' },
      { n1: null, n2: 19, type: 'add', text: '            self.redis.expire(key, 60)' },
      { n1: null, n2: 20, type: 'add', text: '        remaining = max(0, self.limit - current)' },
      { n1: null, n2: 21, type: 'add', text: '        return current <= self.limit, remaining' },
      { n1: 24, n2: 28, type: 'ctx', text: '    def throttle_key(self, merchant_id: str) -> str:' },
      { n1: 25, n2: 29, type: 'ctx', text: '        return f"throttle:{merchant_id}"' },
    ],
  },
  summary: {
    headline: 'Ready for your review',
    sub: 'The code has been generated, tested and is ready for approval.',
    checks: [
      '14/14 tests passed',
      '2 self-heal iterations',
      'All previous gates approved',
      'Sandbox executed with no network access',
    ],
  },
  comments: [],
}

export async function seed(db) {
  if (!(await has(db, 'RUN-0427'))) {
    await createRun(db, {
      runId: 'RUN-0427',
      brief: 'Add rate limiting to the checkout webhook',
      description: 'Implement rate limiting (60 req/min per merchant) for the checkout webhook. Return 429 with Retry-After. Exempt internal reconciliation traffic.',
      repo: 'commerce-core', branch: 'feat/webhook-throttle', commit: '9f3c2e1',
    })
    await upsertPhase(db, 'RUN-0427', 'req', { state: 'approved', status: 'Approved', at: 'Sep 17, 10:24', cost_usd: 0.12, input_tokens: 2800, output_tokens: 1380, model: 'claude', duration_ms: 96000 })
    await upsertPhase(db, 'RUN-0427', 'g1', { state: 'approved', status: 'Approved', at: 'Sep 17, 10:32' })
    await upsertPhase(db, 'RUN-0427', 'design', { state: 'approved', status: 'Approved', at: 'Sep 17, 11:02', cost_usd: 0.16, input_tokens: 4100, output_tokens: 2140, model: 'claude', duration_ms: 148000 })
    await upsertPhase(db, 'RUN-0427', 'g2', { state: 'approved', status: 'Approved', at: 'Sep 17, 11:15' })
    await upsertPhase(db, 'RUN-0427', 'code', { state: 'active', status: 'Ready for review', cost_usd: 0.14, input_tokens: 5200, output_tokens: 2800, model: 'claude', duration_ms: 267000 })
    await upsertTests(db, 'RUN-0427', { ...SANDBOX, passed: 14, failed: 0, total: 14, iterations: 2, duration_ms: 267000 })
    await upsertArtifacts(db, 'RUN-0427', RUN_0427_ARTIFACTS)
    await updateRun(db, 'RUN-0427', { status: 'awaiting_gate', gate: 'Engineer' })
    await appendEvent(db, { runId: 'RUN-0427', event: 'run.created', actor: 'ml-priya' })
    await appendEvent(db, { runId: 'RUN-0427', event: 'requirements.approved', actor: 'ml-priya' })
    await appendEvent(db, { runId: 'RUN-0427', event: 'design.approved', actor: 'o-lindqvist', payload: { file: 'app/middleware/throttle.py' } })
    await appendEvent(db, { runId: 'RUN-0427', event: 'coding.completed', actor: 'code-agent', payload: { tests: '14/14' } })
  } else {
    // If RUN-0427 already exists in DB, ensure artifacts are populated
    await upsertArtifacts(db, 'RUN-0427', RUN_0427_ARTIFACTS)
  }

  if (!(await has(db, 'RUN-0426'))) {
    await createRun(db, {
      runId: 'RUN-0426', brief: 'Migrate audit export to signed URLs',
      description: 'Replace public export links with time-boxed signed URLs (15 min TTL) scoped to reviewer identity.',
      repo: 'gatekeep-core', branch: 'feat/signed-exports', commit: '2b70a91',
    })
    await upsertPhase(db, 'RUN-0426', 'req', { state: 'approved', status: 'Approved', at: 'Sep 19, 13:31', cost_usd: 0.11, input_tokens: 2600, output_tokens: 1300, duration_ms: 88000 })
    await upsertPhase(db, 'RUN-0426', 'g1', { state: 'approved', status: 'Approved', at: 'Sep 19, 13:38' })
    await upsertPhase(db, 'RUN-0426', 'design', { state: 'active', status: 'In progress', cost_usd: 0.16, input_tokens: 5000, output_tokens: 3000, duration_ms: 314000 })
    await updateRun(db, 'RUN-0426', { status: 'running' })
    await appendEvent(db, { runId: 'RUN-0426', event: 'run.created', actor: 'ml-priya' })
    await appendEvent(db, { runId: 'RUN-0426', event: 'requirements.approved', actor: 'ml-priya' })
  }

  if (!(await has(db, 'RUN-0425'))) {
    await createRun(db, {
      runId: 'RUN-0425', brief: 'Fix flaky retry test in scheduler',
      description: 'Stabilise a retry test that intermittently fails under load. No behavioural change to the scheduler itself.',
      repo: 'gatekeep-core', branch: 'fix/scheduler-retry', commit: '7d3108a',
    })
    await upsertPhase(db, 'RUN-0425', 'req', { state: 'approved', status: 'Approved', at: 'Sep 19, 11:56', cost_usd: 0.1, input_tokens: 2400, output_tokens: 1200, duration_ms: 79000 })
    await upsertPhase(db, 'RUN-0425', 'g1', { state: 'approved', status: 'Approved', at: 'Sep 19, 12:01' })
    await upsertPhase(db, 'RUN-0425', 'design', { state: 'approved', status: 'Approved', at: 'Sep 19, 12:10', cost_usd: 0.15, input_tokens: 3900, output_tokens: 2050, duration_ms: 141000 })
    await upsertPhase(db, 'RUN-0425', 'g2', { state: 'approved', status: 'Approved', at: 'Sep 19, 12:18' })
    await upsertPhase(db, 'RUN-0425', 'code', { state: 'rejected', status: 'Rejected', at: 'Sep 19, 12:33', cost_usd: 0.26, input_tokens: 7500, output_tokens: 4000, duration_ms: 470000 })
    await upsertTests(db, 'RUN-0425', { ...SANDBOX, passed: 11, failed: 3, total: 14, iterations: 3, duration_ms: 312000 })
    await updateRun(db, 'RUN-0425', { status: 'rejected' })
    await appendEvent(db, { runId: 'RUN-0425', event: 'run.created', actor: 'j-abera' })
    await appendEvent(db, { runId: 'RUN-0425', event: 'design.approved', actor: 'o-lindqvist' })
    await appendEvent(db, { runId: 'RUN-0425', event: 'coding.rejected', actor: 'adrt25', payload: { reason: 'fake clock leaked into prod path' } })
  }

  return listCount(db)
}

async function listCount(db) {
  const r = await db.query('SELECT count(*)::int AS n FROM runs')
  return r.rows[0].n
}
