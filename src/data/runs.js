// Mock data modelling the GateKeep governed multi-agent pipeline.
// A run turns a feature brief into verified code across agents + human gates.

export const REVIEWER = {
  name: 'Adesh Siddhartha',
  org: 'Student · BTH',
  role: 'Engineer',
  initials: 'AS',
}

export const NAV = [
  { key: 'runs', label: 'Runs', icon: 'Play', badge: null },
  { key: 'approvals', label: 'Approvals', icon: 'BadgeCheck', badge: 2 },
  { key: 'audit', label: 'Audit Log', icon: 'FileText', badge: null },
  { key: 'artifacts', label: 'Artifacts', icon: 'Package', badge: null },
]

export const TABS = [
  'Code Review',
  'Test Results',
  'Self-healing',
  'Design Reference',
  'Requirements',
  'Agent Logs',
]

// Diff lines: n1 = old line no, n2 = new line no, type = ctx|add|rem, text = code
const throttleDiff = {
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
}

export const runs = [
  {
    id: 'RUN-0427',
    brief: 'Add rate limiting to the checkout webhook',
    description:
      'Implement rate limiting (60 req/min per merchant) for the checkout webhook. Return 429 with Retry-After. Exempt internal reconciliation traffic.',
    repo: 'commerce-core',
    branch: 'feat/webhook-throttle',
    commit: '9f3c2e1',
    updatedAt: 'Sep 19, 2026 14:41 UTC',
    status: 'awaiting_gate',
    awaiting: true,
    steps: [
      { key: 'req', label: 'Requirements', role: 'Agent', state: 'approved', status: 'Approved', at: 'Sep 17, 10:24', cost: '$0.12', tokens: '4,180' },
      { key: 'g1', label: 'Gate 1', role: 'Planner', state: 'approved', status: 'Approved', at: 'Sep 17, 10:32', cost: null, tokens: null },
      { key: 'design', label: 'Design', role: 'Agent', state: 'approved', status: 'Approved', at: 'Sep 17, 11:02', cost: '$0.16', tokens: '6,240' },
      { key: 'g2', label: 'Gate 2', role: 'Engineer', state: 'approved', status: 'Approved', at: 'Sep 17, 11:15', cost: null, tokens: null },
      { key: 'code', label: 'Code & Tests', role: 'Agent', state: 'active', status: 'Ready for review', at: null, num: 3, cost: '$0.14', tokens: '8,000' },
      { key: 'out', label: 'Output', role: 'Branch', state: 'pending', status: 'Not started', at: null, num: 4, cost: null, tokens: null },
    ],
    files: [
      { path: 'app/middleware/throttle.py', add: 48, rem: 6 },
      { path: 'app/deps/redis.py', add: 12, rem: 3 },
      { path: 'app/routes/webhook.py', add: 20, rem: 4 },
      { path: 'tests/test_throttle.py', add: 64, rem: 0 },
      { path: 'tests/test_webhook.py', add: 18, rem: 2 },
      { path: 'README.md', add: 4, rem: 0 },
    ],
    diff: throttleDiff,
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
    sandbox: {
      status: 'Completed',
      image: 'python:3.12-slim',
      network: 'Disabled',
      memory: '512 MB',
      cpu: '1 core',
      timeout: '30 seconds',
    },
    totals: { cost: '$0.42', tokens: '18,420', wall: '8m 31s' },
    tests: { passed: 14, failed: 0, total: 14, iterations: 2, duration: '4m 27s' },
    audit: [
      { gate: 'Gate 1 – Requirements', by: 'Priya Sharma', at: 'Sep 17, 10:24 UTC', hash: 'a3f9c2...7c2d', state: 'approved' },
      { gate: 'Gate 2 – Design', by: 'Alex Chen', at: 'Sep 17, 11:02 UTC', hash: 'd4e6a1...9f8b', state: 'approved' },
      { gate: 'Gate 3 – Code & Tests', by: null, at: null, hash: null, state: 'pending', note: 'Pending your review' },
    ],
    verified: true,
  },
  {
    id: 'RUN-0426',
    brief: 'Migrate audit export to signed URLs',
    description:
      'Replace public export links with time-boxed signed URLs (15 min TTL) scoped to reviewer identity.',
    repo: 'gatekeep-core',
    branch: 'feat/signed-exports',
    commit: '2b70a91',
    updatedAt: 'Sep 19, 2026 14:39 UTC',
    status: 'running',
    awaiting: false,
    steps: [
      { key: 'req', label: 'Requirements', role: 'Agent', state: 'approved', status: 'Approved', at: 'Sep 19, 13:31', cost: '$0.11', tokens: '3,900' },
      { key: 'g1', label: 'Gate 1', role: 'Planner', state: 'approved', status: 'Approved', at: 'Sep 19, 13:38', cost: null, tokens: null },
      { key: 'design', label: 'Design', role: 'Agent', state: 'active', status: 'In progress', at: null, num: 3, cost: '$0.16', tokens: '8,000' },
      { key: 'g2', label: 'Gate 2', role: 'Engineer', state: 'pending', status: 'Not started', at: null, num: 4, cost: null, tokens: null },
      { key: 'code', label: 'Code & Tests', role: 'Agent', state: 'pending', status: 'Not started', at: null, num: 5, cost: null, tokens: null },
      { key: 'out', label: 'Output', role: 'Branch', state: 'pending', status: 'Not started', at: null, num: 6, cost: null, tokens: null },
    ],
    files: [],
    diff: null,
    summary: {
      headline: 'Design in progress',
      sub: 'The design agent is drafting the signing flow. No code has been generated yet.',
      checks: ['Requirements approved', 'Gate 1 approved', 'Design 62% complete'],
    },
    sandbox: {
      status: 'Idle',
      image: 'python:3.12-slim',
      network: 'Disabled',
      memory: '512 MB',
      cpu: '1 core',
      timeout: '30 seconds',
    },
    totals: { cost: '$0.27', tokens: '11,900', wall: '6m 42s' },
    tests: null,
    audit: [
      { gate: 'Gate 1 – Requirements', by: 'Priya Sharma', at: 'Sep 19, 13:31 UTC', hash: 'c5f10a...6d02', state: 'approved' },
      { gate: 'Gate 2 – Design', by: null, at: null, hash: null, state: 'pending', note: 'Awaiting agent' },
    ],
    verified: true,
  },
  {
    id: 'RUN-0425',
    brief: 'Fix flaky retry test in scheduler',
    description:
      'Stabilise a retry test that intermittently fails under load. No behavioural change to the scheduler itself.',
    repo: 'gatekeep-core',
    branch: 'fix/scheduler-retry',
    commit: '7d3108a',
    updatedAt: 'Sep 19, 2026 12:33 UTC',
    status: 'rejected',
    awaiting: false,
    steps: [
      { key: 'req', label: 'Requirements', role: 'Agent', state: 'approved', status: 'Approved', at: 'Sep 19, 11:56', cost: '$0.10', tokens: '3,600' },
      { key: 'g1', label: 'Gate 1', role: 'Planner', state: 'approved', status: 'Approved', at: 'Sep 19, 12:01', cost: null, tokens: null },
      { key: 'design', label: 'Design', role: 'Agent', state: 'approved', status: 'Approved', at: 'Sep 19, 12:10', cost: '$0.15', tokens: '5,950' },
      { key: 'g2', label: 'Gate 2', role: 'Engineer', state: 'approved', status: 'Approved', at: 'Sep 19, 12:18', cost: null, tokens: null },
      { key: 'code', label: 'Code & Tests', role: 'Agent', state: 'rejected', status: 'Rejected', at: 'Sep 19, 12:33', cost: '$0.26', tokens: '11,500' },
      { key: 'out', label: 'Output', role: 'Branch', state: 'pending', status: 'Not started', at: null, num: 6, cost: null, tokens: null },
    ],
    files: [
      { path: 'app/scheduler/retry.py', add: 22, rem: 9 },
      { path: 'tests/test_retry.py', add: 40, rem: 5 },
    ],
    diff: {
      file: 'app/scheduler/retry.py',
      add: 22,
      rem: 9,
      lines: [
        { n1: 8, n2: 8, type: 'ctx', text: 'class RetryPolicy:' },
        { n1: 9, n2: null, type: 'rem', text: '    def wait(self):' },
        { n1: 10, n2: null, type: 'rem', text: '        time.sleep(self.backoff)' },
        { n1: null, n2: 9, type: 'add', text: '    def wait(self, clock=time):' },
        { n1: null, n2: 10, type: 'add', text: '        clock.sleep(self.backoff)' },
      ],
    },
    summary: {
      headline: 'Changes requested',
      sub: 'The fake clock leaked into the production scheduler path. Isolation to test scope was requested.',
      checks: ['11/14 tests passed', '3 self-heal iterations', 'Rejected at Gate 3'],
    },
    sandbox: {
      status: 'Completed',
      image: 'python:3.12-slim',
      network: 'Disabled',
      memory: '512 MB',
      cpu: '1 core',
      timeout: '30 seconds',
    },
    totals: { cost: '$0.51', tokens: '21,050', wall: '11m 30s' },
    tests: { passed: 11, failed: 3, total: 14, iterations: 3, duration: '5m 12s' },
    audit: [
      { gate: 'Gate 1 – Requirements', by: 'Johan Abera', at: 'Sep 19, 11:56 UTC', hash: 'e0aa21...c7f4', state: 'approved' },
      { gate: 'Gate 2 – Design', by: 'Alex Chen', at: 'Sep 19, 12:10 UTC', hash: '3c88bb...9012', state: 'approved' },
      { gate: 'Gate 3 – Code & Tests', by: 'Adesh Siddhartha', at: 'Sep 19, 12:33 UTC', hash: 'f4d57e...1088', state: 'rejected', note: 'Rejected with feedback' },
    ],
    verified: true,
  },
]
