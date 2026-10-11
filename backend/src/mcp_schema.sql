-- MCP Sessions: tracks external agent connections to GateKeep runs.
-- Provider-agnostic: works with Claude, Cursor, or any MCP-compatible client.

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
