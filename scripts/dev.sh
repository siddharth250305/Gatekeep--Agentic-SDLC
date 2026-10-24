#!/usr/bin/env bash
# GateKeep dev helper: start / stop / reset all services.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:$PATH"
PG="postgresql://gatekeep:gatekeep@localhost:5432/gatekeep"
DC="docker compose -f $ROOT/backend/docker-compose.yml"

case "$1" in
  start)
    $DC up -d db
    printf "waiting for postgres"
    for i in $(seq 1 20); do $DC exec -T db pg_isready -U gatekeep >/dev/null 2>&1 && break; printf "."; sleep 1; done; echo
    (cd "$ROOT/backend" && PIPELINE_URL=http://localhost:8077 nohup node src/server.js > /tmp/gk-api.log 2>&1 & disown)
    (cd "$ROOT/agents" && . .venv/bin/activate && CHECKPOINT_DB="$PG" GATEKEEP_API=http://localhost:4040 nohup uvicorn app.main:app --port 8077 > /tmp/gk-agents.log 2>&1 & disown)
    (cd "$ROOT/agents" && . .venv/bin/activate && GATEKEEP_API=http://localhost:4040 nohup python -m app.mcp.server > /tmp/gk-mcp.log 2>&1 & disown)
    (cd "$ROOT" && nohup npm run dev > /tmp/gk-fe.log 2>&1 & disown)
    sleep 4
    echo "  UI:    http://localhost:5180"
    echo "  API:   http://localhost:4040  (logs: /tmp/gk-api.log)"
    echo "  Agent: http://localhost:8077  (logs: /tmp/gk-agents.log)"
    echo "  MCP:   http://localhost:8078/sse  (logs: /tmp/gk-mcp.log)"
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
    echo "usage: scripts/dev.sh {start|stop|reset|db-stop}"
    ;;
esac
