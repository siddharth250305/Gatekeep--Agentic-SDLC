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
      } > "$ENVF"
    )
    echo "wrote $ENVF"
    echo "Now create your reviewer account (role Admin can approve every gate):"
    (cd "$ROOT/backend" && npm run -s user:create -- --username "${2:-admin}" --name "${3:-${2:-admin}}" --role Admin)
    echo "Done. Start everything with: scripts/dev.sh start"
    ;;
  start)
    if [ ! -f "$ENVF" ]; then echo "first run: scripts/dev.sh setup [username]"; exit 1; fi
    set -a; . "$ENVF"; set +a
    $DC up -d db
    wait_for_db
    (cd "$ROOT/backend" && PIPELINE_URL=http://localhost:8077 GATEKEEP_DEMO_MODE=1 nohup node src/server.js > /tmp/gk-api.log 2>&1 & disown)
    (cd "$ROOT/agents" && . .venv/bin/activate && CHECKPOINT_DB="$PG" GATEKEEP_API=http://localhost:4040 nohup uvicorn app.main:app --port 8077 > /tmp/gk-agents.log 2>&1 & disown)
    (cd "$ROOT/agents" && . .venv/bin/activate && GATEKEEP_API=http://localhost:4040 nohup python -m app.mcp.server --transport sse > /tmp/gk-mcp.log 2>&1 & disown)
    (cd "$ROOT" && nohup npm run dev > /tmp/gk-fe.log 2>&1 & disown)
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
    $DC exec -T db psql -U gatekeep -c "TRUNCATE runs, audit_events, run_phases, test_results, run_artifacts RESTART IDENTITY CASCADE;" 2>/dev/null || true
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
