# GateKeep - manual test guide

A click-by-click walkthrough to exercise the product live.

## 1. Start everything (one command)

```bash
./scripts/dev.sh start
```

Starts Postgres, the API (:4040), the agent service (:8077), and the UI (:5180).
Open **http://localhost:5180**.

Reset to fresh demo data anytime: `./scripts/dev.sh reset` (then refresh the page).
Stop the app: `./scripts/dev.sh stop`. Stop the database too: `./scripts/dev.sh db-stop`.

## 2. Look around (30 seconds)

- **RUN-0427** loads with an amber "Awaiting your approval".
- The **pipeline** row shows Requirements -> Gate 1 -> Design -> Gate 2 -> Code & Tests -> Output, with per-phase cost and tokens.
- Left nav: **Runs / Approvals / Audit Log / Artifacts** - click each, they all render.
- Right side: **Run summary** (cost/tokens/time), **Verification** (sandbox + tests), **Approval chain** (the real SHA-256 events).

## 3. The tamper demo (the headline)

1. In the right-hand **Approval chain**, hover over any event row - a small **tamper** link appears.
2. Click it. This runs a REAL `UPDATE` on that row in Postgres.
3. Watch the badge flip **"Verified" (green) -> "Chain broken at #N" (red)**, with the diverging hashes shown.
4. Reset it: `./scripts/dev.sh reset`, refresh.

That is the point of the product: any secret change to the record is caught by cryptography.

## 4. Approve a gate

- Top-right **"Acting as"** picks your role. RUN-0427 is at the **Engineer** gate.
- Set "Acting as" = **Engineer**, click **Approve**. The run completes (code + output go green, status -> approved).
- Try the wrong role: set "Acting as" = **Planner** on an Engineer gate and click Approve - you get a toast that the gate belongs to Engineer. That is the role enforcement working.

## 5. Run a full pipeline from scratch (the AI doing work)

1. Click **+ New run** (top-right). Type a brief, e.g. "Add caching to the product API", optionally a repo/branch, and **Create run**. It opens the new run.
2. Click **Run pipeline**. The Requirements agent runs (watch tokens tick), then it stops at **Gate 1 (Planner)**.
3. Set "Acting as" = **Planner**, click **Approve** -> Design agent runs -> stops at **Gate 2 (Engineer)**.
4. Set "Acting as" = **Engineer**, click **Approve** -> Coding agent runs + real `pytest` in Docker -> stops at the final **Code** gate.
5. "Acting as" = **Engineer**, click **Approve** -> run completes. Check **Verification** (real test result) and **Changes** (the real diff the agent produced).

## 6. See it update live

Open the app in **two browser tabs**. Approve or tamper in one - the other updates instantly (WebSocket). No refresh needed.

## 7. Prove it is real, not a mock (optional)

```bash
# the audit row is a real DB row:
docker compose -f backend/docker-compose.yml exec db \
  psql -U gatekeep -c "SELECT seq, event, left(hash,12) FROM audit_events WHERE run_id='RUN-0427' ORDER BY seq;"

# verify the chain over HTTP:
curl -XPOST localhost:4040/runs/RUN-0427/audit/verify
```

## Notes / current limits

- The reviewer is one person switching roles ("Acting as"); a real deployment would have separate accounts per role.
- Seeded runs (RUN-0425/26/27) show sample code diffs; only agent-run pipelines (step 5) show real agent output.
