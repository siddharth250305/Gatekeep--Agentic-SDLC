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
