CREATE TABLE IF NOT EXISTS audit_events (
  id         BIGSERIAL PRIMARY KEY,
  run_id     TEXT    NOT NULL,
  seq        INTEGER NOT NULL,
  event      TEXT    NOT NULL,
  actor      TEXT    NOT NULL,
  payload    JSONB   NOT NULL DEFAULT '{}'::jsonb,
  created_at TEXT    NOT NULL,
  prev_hash  TEXT    NOT NULL,
  hash       TEXT    NOT NULL,
  UNIQUE (run_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_audit_run_seq ON audit_events (run_id, seq);

CREATE TABLE IF NOT EXISTS runs (
  run_id      TEXT PRIMARY KEY,
  brief       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  repo        TEXT NOT NULL DEFAULT '',
  branch      TEXT NOT NULL DEFAULT '',
  commit      TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'running',
  gate        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS run_phases (
  id            BIGSERIAL PRIMARY KEY,
  run_id        TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  seq           INTEGER NOT NULL,
  key           TEXT NOT NULL,
  label         TEXT NOT NULL,
  role          TEXT NOT NULL,
  state         TEXT NOT NULL DEFAULT 'pending',
  status        TEXT NOT NULL DEFAULT 'Not started',
  at            TEXT,
  cost_usd      NUMERIC(10,4),
  input_tokens  INTEGER,
  output_tokens INTEGER,
  model         TEXT,
  duration_ms   INTEGER,
  UNIQUE (run_id, key)
);

CREATE INDEX IF NOT EXISTS idx_run_phases ON run_phases (run_id, seq);

-- State machine (B2). step is the run's position: req, g1, design, g2, code,
-- g3, done or cancelled. Runs from before the state machine have no step and
-- are refused every move (fail closed). created_by is the reviewer who asked
-- for the work (they may not give the final approval). started_at makes
-- Start safe to repeat.
ALTER TABLE runs ADD COLUMN IF NOT EXISTS step TEXT;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS created_by BIGINT;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS created_by_name TEXT;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;


CREATE TABLE IF NOT EXISTS test_results (
  run_id      TEXT PRIMARY KEY REFERENCES runs(run_id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'Idle',
  image       TEXT,
  network     TEXT,
  memory      TEXT,
  cpu         TEXT,
  timeout     TEXT,
  passed      INTEGER,
  failed      INTEGER,
  total       INTEGER,
  iterations  INTEGER,
  duration_ms INTEGER,
  output      TEXT
);

ALTER TABLE test_results ADD COLUMN IF NOT EXISTS output TEXT;

-- Every test run, kept (C2, B7). fingerprint is the SHA-256 of the exact code
-- the tests ran on; cases holds each test's name, file, outcome and whether it
-- is new. The latest row is what the dashboard shows and what Gate 3 checks.
-- test_results above keeps only the sandbox profile (image, limits).
CREATE TABLE IF NOT EXISTS test_runs (
  id               TEXT PRIMARY KEY,
  run_id           TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  seq              INTEGER NOT NULL,
  fingerprint      TEXT NOT NULL,
  status           TEXT NOT NULL,
  passed           INTEGER NOT NULL,
  failed           INTEGER NOT NULL,
  skipped          INTEGER NOT NULL DEFAULT 0,
  total            INTEGER NOT NULL,
  iterations       INTEGER,
  duration_ms      INTEGER,
  output           TEXT,
  cases            JSONB NOT NULL DEFAULT '[]'::jsonb,
  missing_existing JSONB NOT NULL DEFAULT '[]'::jsonb,
  recorded_by      TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, seq)
);

-- The fingerprint of the code handed over at "request review" (B7).
ALTER TABLE runs ADD COLUMN IF NOT EXISTS review_fingerprint TEXT;

-- What the coding agent actually produced (real files/diff/summary/requirements/design/comments).
CREATE TABLE IF NOT EXISTS run_artifacts (
  run_id       TEXT PRIMARY KEY REFERENCES runs(run_id) ON DELETE CASCADE,
  files        JSONB,
  diff         JSONB,
  summary      JSONB,
  requirements TEXT,
  design       JSONB,
  comments     JSONB DEFAULT '[]'::jsonb
);

ALTER TABLE run_artifacts ADD COLUMN IF NOT EXISTS requirements TEXT;
ALTER TABLE run_artifacts ADD COLUMN IF NOT EXISTS design JSONB;
ALTER TABLE run_artifacts ADD COLUMN IF NOT EXISTS comments JSONB DEFAULT '[]'::jsonb;

-- UI-safe repository context (paths + reasons + languages; NO source, NO secrets).
CREATE TABLE IF NOT EXISTS run_repo_context (
  run_id  TEXT PRIMARY KEY REFERENCES runs(run_id) ON DELETE CASCADE,
  context JSONB
);

-- MCP Sessions: tracks external agent connections to GateKeep runs.
CREATE TABLE IF NOT EXISTS mcp_sessions (
  id          BIGSERIAL PRIMARY KEY,
  session_id  TEXT UNIQUE NOT NULL,
  run_id      TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  provider    TEXT NOT NULL DEFAULT 'unknown',
  client      TEXT NOT NULL DEFAULT 'unknown',
  model       TEXT,
  status      TEXT NOT NULL DEFAULT 'active',
  tool_calls  INTEGER NOT NULL DEFAULT 0,
  last_tool   TEXT,
  last_tool_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_mcp_sessions_run ON mcp_sessions (run_id);
CREATE INDEX IF NOT EXISTS idx_mcp_sessions_status ON mcp_sessions (status);

-- Latest seq + hash of each run's audit chain. Appends lock this row
-- (SELECT ... FOR UPDATE) so concurrent writers to one run are serialized.
CREATE TABLE IF NOT EXISTS audit_heads (
  run_id TEXT PRIMARY KEY,
  seq    INTEGER NOT NULL,
  hash   TEXT    NOT NULL
);
-- HMAC over (run_id, seq, hash) with the audit key, so the head cannot be
-- moved back to hide deleted entries (E4).
ALTER TABLE audit_heads ADD COLUMN IF NOT EXISTS mac TEXT;

-- Human reviewers. role: Planner | Engineer | Admin (Admin may act for any gate).
CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  display_name  TEXT NOT NULL,
  role          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  disabled      BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Dashboard login sessions. Only a SHA-256 of the token is stored.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

-- Long-lived tokens for the agent services (MCP server, pipeline). They can
-- submit work but can never approve a gate. Only a SHA-256 is stored.
CREATE TABLE IF NOT EXISTS api_tokens (
  token_hash TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);
