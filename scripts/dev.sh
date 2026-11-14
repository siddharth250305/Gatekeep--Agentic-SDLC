#!/usr/bin/env bash
# GateKeep dev helper: start / stop / reset all services.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:$PATH"
PG="postgresql://gatekeep:gatekeep@localhost:5432/gatekeep"
DC="docker compose -f $ROOT/backend/docker-compose.yml"
# Local secrets made by `dev.sh setup` (git-ignored, readable only by you).
ENVF="$ROOT/.gatekeep.local.env"

wait_for_db() {
  printf "waiting for postgres"
  for i in $(seq 1 20); do $DC exec -T db pg_isready -U gatekeep >/dev/null 2>&1 && break; printf "."; sleep 1; done; echo
}

case "$1" in
  setup)
    # One-time: agent token, pipeline secret, MCP token, and your reviewer account.
    if [ -f "$ENVF" ]; then echo "already set up ($ENVF). Delete it to start over."; exit 0; fi
    $DC up -d db
    wait_for_db
    TOKEN=$(cd "$ROOT/backend" && npm run -s token:create -- --name dev-agents | tail -1)
    (
      umask 077
      {
        echo "# Created by scripts/dev.sh setup. Do not commit."
        echo "GATEKEEP_API_TOKEN=$TOKEN"
        echo "GATEKEEP_PIPELINE_SECRET=$(openssl rand -hex 32)"
        echo "GATEKEEP_MCP_TOKEN=$(openssl rand -hex 32)"
        echo "GATEKEEP_AUDIT_KEY=$(openssl rand -hex 32)"
      } > "$ENVF"
    )
    echo "wrote $ENVF"
    echo "Now create your reviewer account (role Admin can approve every gate):"
    (cd "$ROOT/backend" && npm run -s user:create -- --username "${2:-admin}" --name "${3:-${2:-admin}}" --role Admin)
    echo "Done. Start everything with: scripts/dev.sh start"
    ;;
  start)
    if [ ! -f "$ENVF" ]; then echo "first run: scripts/dev.sh setup [username]"; exit 1; fi
    # Setups made before the HMAC audit diary (E1) have no audit key yet.
    if ! grep -q '^GATEKEEP_AUDIT_KEY=' "$ENVF"; then
      echo "GATEKEEP_AUDIT_KEY=$(openssl rand -hex 32)" >> "$ENVF"
      echo "added GATEKEEP_AUDIT_KEY to $ENVF (older audit entries will not verify; run 'dev.sh reset')"
    fi
    set -a; . "$ENVF"; set +a
    $DC up -d db
    wait_for_db
    (cd "$ROOT/backend" && PIPELINE_URL=http://localhost:8077 GATEKEEP_DEMO_MODE=1 nohup node src/server.js > /tmp/gk-api.log 2>&1 & disown)
    # Only the backend gets the audit key; the agent-facing services never see it.
    (cd "$ROOT/agents" && . .venv/bin/activate && unset GATEKEEP_AUDIT_KEY && CHECKPOINT_DB="$PG" GATEKEEP_API=http://localhost:4040 nohup uvicorn app.main:app --port 8077 > /tmp/gk-agents.log 2>&1 & disown)
    (cd "$ROOT/agents" && . .venv/bin/activate && unset GATEKEEP_AUDIT_KEY && GATEKEEP_API=http://localhost:4040 nohup python -m app.mcp.server --transport sse > /tmp/gk-mcp.log 2>&1 & disown)
    (cd "$ROOT" && unset GATEKEEP_AUDIT_KEY && nohup npm run dev > /tmp/gk-fe.log 2>&1 & disown)
    sleep 4
    echo "  UI:    http://localhost:5180"
    echo "  API:   http://localhost:4040  (logs: /tmp/gk-api.log)"
    echo "  Agent: http://localhost:8077  (logs: /tmp/gk-agents.log)"
    echo "  MCP:   http://localhost:8078/sse  (logs: /tmp/gk-mcp.log, needs GATEKEEP_MCP_TOKEN from $ENVF)"
    ;;
  stop)
    pkill -f "node src/server.js" 2>/dev/null || true
    pkill -f "uvicorn app.main" 2>/dev/null || true
    pkill -f "app.mcp.server" 2>/dev/null || true
    pkill -f "vite" 2>/dev/null || true
    echo "stopped app services (Postgres container still running; use 'dev.sh db-stop' to stop it)"
    ;;
  reset)
    if [ -f "$ENVF" ]; then set -a; . "$ENVF"; set +a; fi  # the seed stamps the diary with GATEKEEP_AUDIT_KEY
    $DC exec -T db psql -U gatekeep -c "TRUNCATE runs, audit_events, audit_heads, run_phases, test_results, test_runs, run_artifacts RESTART IDENTITY CASCADE;" 2>/dev/null || true
    $DC exec -T db psql -U gatekeep -c "TRUNCATE checkpoints, checkpoint_blobs, checkpoint_writes;" 2>/dev/null || true
    (cd "$ROOT/backend" && npm run seed)
    echo "reset done: demo runs reseeded (refresh the UI)"
    ;;
  db-stop)
    $DC down
    ;;
  *)
    echo "usage: scripts/dev.sh {setup [username]|start|stop|reset|db-stop}"
    ;;
esac
