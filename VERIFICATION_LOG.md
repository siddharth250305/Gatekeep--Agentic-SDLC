# GateKeep Verification Log

This document tracks verification results, acceptance criteria proofs, and test suite execution across all milestones.

---

## Milestone 0: Stop the Damage (Quick Wins)

**Status:** Completed and Verified
**Branch:** `fix/milestone-0-quick-wins`

### Items Summary

| ID | Problem Fixed | Dependencies Checked | Test Name(s) Verifying Fix | Status |
|---|---|---|---|---|
| **H1** | README honest: SHA-256 hash chain, real test counts, tool count, removed "100%" claims, documented limits | None (`None`) | Manual inspection; `git diff README.md`; `grep -E "100%\|HMAC" README.md` | Verified |
| **D1** | Block `.git` paths; run git with external programs disabled (`-c core.fsmonitor= -c diff.external=`) | None (`None`) | `tests/test_mcp_policy.py::test_git_metadata_is_blocked[*]`, `tests/test_repository.py::test_workspace_tools_refuse_git_metadata[*]`, `tests/test_mcp_diff.py::test_workspace_diff_never_runs_programs_from_repo_config`, `tests/test_mcp_tools.py::test_policy_gate_denies_and_audits_git_writes_in_code_phase` | Verified |
| **C1** | "Passed" only if exit code 0, no timeout, and >=1 test; handle Docker missing/down | None (`None`) | `tests/test_sandbox.py::test_verdict[*]`, `tests/test_sandbox.py::test_docker_daemon_down_is_not_a_pass`, `tests/test_sandbox.py::test_missing_docker_binary_is_reported_not_raised`, `tests/test_sandbox.py::test_printed_fake_counts_cannot_fake_a_pass` | Verified |
| **E3** | Tamper endpoint mounted only when `GATEKEEP_DEMO_MODE=1` | None (`None`) | `backend/test/security.test.js::tamper route is not mounted outside demo mode` | Verified |
| **B0** | No active step denies all tools instead of guessing "req" (fail-closed) | None (`None`) | `tests/test_mcp_policy.py::test_current_phase_of_a_rejected_or_finished_run_is_none[*]`, `tests/test_mcp_policy.py::test_current_phase_of_a_malformed_run_is_none`, `tests/test_mcp_tools.py::test_policy_gate_denies_everything_on_a_rejected_run` | Verified |
| **D6** | Validate run IDs (`^[A-Za-z0-9_-]{1,64}$`) preventing traversal outside `workspaces/` | None (`None`) | `tests/test_workspace.py::test_validate_run_id_accepts_normal_ids[*]`, `tests/test_workspace.py::test_validate_run_id_rejects_path_tricks[*]`, `tests/test_mcp_session.py::test_create_session_rejects_unsafe_run_ids_before_calling_backend[*]` | Verified |
| **D4** | GitHub token removed from clone URL, `.git/config`, and args; transient env only | None (`None`) | `tests/test_workspace.py::test_clone_url_normalizes_without_embedding_a_token`, `tests/test_workspace.py::test_token_goes_to_git_via_env_not_the_url`, `tests/test_workspace.py::test_token_is_never_sent_to_other_hosts` | Verified |
| **D7 (bind)** | MCP server binds to `127.0.0.1` by default | None (`None`) | `tests/test_mcp_tools.py::test_server_listens_on_localhost_by_default` | Verified |
| **A3** | Restrict CORS to dashboard origin (`http://localhost:5173`) | None (`None`) | `backend/test/security.test.js::CORS: the dashboard origin is allowed, including DELETE`, `backend/test/security.test.js::CORS: any other website gets no CORS headers`, `backend/test/security.test.js::CORS: allowed origins come from a comma-separated list` | Verified |
| **F1** | Remove demo mode fake successes and mock catches; show real error banners | None (`None`) | `npm run build` clean; code audit of `src/api.js`, `src/App.jsx`, `src/components/views/OverviewDashboardView.jsx` | Verified |
| **F2** | Remove fake test numbers; show "No test run yet" when idle; red on fail | None (`None`) | `npm run build` clean; code audit of `src/components/views/TestResultsView.jsx` | Verified |
| **F3** | Remove fake code, hardcoded "Line 42" rework message, and comment-triggered rejection | None (`None`) | `npm run build` clean; code audit of `src/components/CodeReview.jsx` | Verified |
| **E5** | Validate audit diary field types and block `__proto__` pollution | None (`None`) | `backend/test/security.test.js::appendEvent rejects *` (7 subtests) | Verified |
| **E7** | Record blocked policy actions in audit log; abort/revert tool writes if audit fails | None (`None`) | `tests/test_mcp_tools.py::test_write_is_undone_when_audit_fails`, `tests/test_mcp_tools.py::test_new_file_is_removed_when_audit_fails`, `tests/test_mcp_tools.py::test_patch_is_undone_when_audit_fails`, `tests/test_mcp_tools.py::test_write_succeeds_and_is_audited_when_backend_is_up`, `tests/test_mcp_tools.py::test_policy_gate_denies_and_audits_git_writes_in_code_phase` | Verified |
| **G5** | Replace `print()` in Python server with stderr logging | None (`None`) | Code audit in `agents/app/mcp/server.py`; `tests/test_mcp_session.py::*` | Verified |
| **G1** | Delete ~700 lines of dead dashboard components, unused schema, and unused status lib | None (`None`) | `npm run build` clean bundle with 1904 modules transformed and 0 missing imports | Verified |
| **C4** | Kill and remove Docker container on timeout; `--cap-drop ALL`, swap limit, tmpfs limit | None (`None`) | `tests/test_sandbox.py::test_timeout_removes_the_container`, `tests/test_sandbox.py::test_container_is_locked_down_and_target_cannot_be_an_option` | Verified |

---

### "Done When" Acceptance Verification

#### 1. The robot cannot write to `.git`.
**Verification Command:**
```bash
cd agents && .venv/bin/pytest -v tests/test_mcp_policy.py -k "git_metadata" && .venv/bin/pytest -v tests/test_repository.py -k "refuse_git_metadata" && .venv/bin/pytest -v tests/test_mcp_tools.py -k "denies_and_audits_git_writes"
```
**Output:**
```
tests/test_mcp_policy.py::test_git_metadata_is_blocked[.git/config] PASSED
tests/test_mcp_policy.py::test_git_metadata_is_blocked[.git/hooks/pre-commit] PASSED
tests/test_mcp_policy.py::test_git_metadata_is_blocked[sub/.git/config] PASSED
tests/test_mcp_policy.py::test_git_metadata_is_blocked[.GIT/config] PASSED
tests/test_mcp_policy.py::test_git_metadata_is_blocked[.git] PASSED
tests/test_repository.py::test_workspace_tools_refuse_git_metadata[.git/config] PASSED
tests/test_repository.py::test_workspace_tools_refuse_git_metadata[pkg/.git/HEAD] PASSED
tests/test_repository.py::test_workspace_tools_refuse_git_metadata[.GIT/config] PASSED
tests/test_mcp_tools.py::test_policy_gate_denies_and_audits_git_writes_in_code_phase PASSED
```
**Result:** Passed.

#### 2. Docker off, or zero tests, shows "Failed" or "Sandbox unavailable", never "Passed".
**Verification Command:**
```bash
cd agents && .venv/bin/pytest -v tests/test_sandbox.py -k "verdict or docker_daemon_down or missing_docker or printed_fake"
```
**Output:**
```
tests/test_sandbox.py::test_verdict[result0-Passed] PASSED
tests/test_sandbox.py::test_verdict[result1-Failed] PASSED
tests/test_sandbox.py::test_verdict[result2-Failed] PASSED
tests/test_sandbox.py::test_verdict[result3-No tests ran] PASSED
tests/test_sandbox.py::test_verdict[result4-No tests ran] PASSED
tests/test_sandbox.py::test_verdict[result5-Timed out] PASSED
tests/test_sandbox.py::test_verdict[result6-Sandbox unavailable] PASSED
tests/test_sandbox.py::test_verdict[result7-Sandbox unavailable] PASSED
tests/test_sandbox.py::test_verdict[result8-Failed] PASSED
tests/test_sandbox.py::test_docker_daemon_down_is_not_a_pass PASSED
tests/test_sandbox.py::test_missing_docker_binary_is_reported_not_raised PASSED
tests/test_sandbox.py::test_printed_fake_counts_cannot_fake_a_pass PASSED
```
**Result:** Passed.

#### 3. The dashboard never shows "demo mode" or hardcoded numbers.
**Verification Command:**
```bash
git grep -i "demo mode" src/
git grep "Line 42" src/
git grep -n "No test" src/components/views/TestResultsView.jsx
```
**Output:**
- No "demo mode" banners in UI.
- No "Line 42" fake rework comments.
- TestResultsView properly defaults to "No test run yet" and displays actual test run outcomes.
**Result:** Passed.

#### 4. The README makes no claim that the code does not support.
**Verification Command:**
```bash
grep -E "100%|HMAC" README.md
```
**Output:**
- SHA-256 hash chain honestly described (tamper-evident, not tamper-proof without HMAC key).
- Accurate automated test counts reported (105 Python + 38 Node).
- Removed unsupported 100% claims.
- Added explicit "Known Limitations" section referencing `drawback.md` and `organised.md`.
**Result:** Passed.

#### 5. The tamper button is gone unless `DEMO_MODE=1`.
**Verification Command:**
```bash
node --test backend/test/security.test.js
```
**Output:**
```
✔ CORS: the dashboard origin is allowed, including DELETE (49.980916ms)
✔ CORS: any other website gets no CORS headers (13.775375ms)
✔ CORS: allowed origins come from a comma-separated list (0.6465ms)
✔ tamper route is not mounted outside demo mode (29.051583ms)
✔ appendEvent rejects numeric event (3.035333ms)
✔ appendEvent rejects object actor (2.138458ms)
✔ appendEvent rejects empty actor (3.447458ms)
✔ appendEvent rejects array payload (2.078667ms)
✔ appendEvent rejects __proto__ in payload (2.157291ms)
✔ appendEvent rejects numeric createdAt (2.57425ms)
✔ appendEvent rejects garbage createdAt (3.213375ms)
✔ a rejected bad event over HTTP leaves the chain valid (5.970542ms)
```
- UI views (`App.jsx`, `CodeReview.jsx`, `OverviewDashboardView.jsx`, `AuditLogView.jsx`) omit `onTamper` handler when `GATEKEEP_DEMO_MODE !== '1'`, completely hiding tamper test buttons from the DOM.
**Result:** Passed.

---

### Automated Test Suite Totals

| Test Suite | Result | Details |
|---|---|---|
| **Python (`cd agents && pytest -v`)** | **105 Passed, 0 Failed, 0 Skipped** | Includes 2 Docker sandbox tests executed against Docker daemon |
| **Node (`cd backend && npm test`)** | **38 Passed, 0 Failed** | Security, audit chain, runs, MCP sessions, CORS, and gates tests |
| **Frontend Build (`npm run build`)** | **Built Cleanly** | 1,904 modules transformed in 1.22s, zero errors |

---

## Milestone 1: Foundations

**Status:** Completed and Verified (one review finding, #9, deferred to Milestone 2)
**Branch:** `feat/milestone-1-foundations`

### Items Summary

| ID | What was built | Tests verifying it | Status |
|---|---|---|---|
| **G4** | Decision record for the main design choices | `docs/adr/` (documentation, no test) | Verified |
| **T0** | Backend tests run against real Postgres as well as in-memory pg-mem (`npm run test:pg`) | `backend/test/helpers/db.js` (test database factory), `backend/test/concurrency.test.js` (5 tests that run only on real Postgres) | Verified |
| **E6** | Database transactions and row locks on approvals and audit writes | `backend/test/concurrency.test.js`, `backend/test/decide-pipeline.test.js` (double-decide and stale-gate refused), `backend/test/gates.test.js` | Verified |
| **A1** | Reviewer login (scrypt, `gks_` session tokens), agent tokens (`gka_`), login screen and session persistence in the dashboard | `backend/test/auth.test.js` (hashing, login, session and agent-token rules, 401 on every protected route), `backend/test/helpers/auth.js` (test helpers), `src/App.test.jsx` (login screen, sign-in, expired session) | Verified |
| **D7 (token)** | MCP network transports require a bearer token; agent API calls carry one | `agents/tests/test_mcp_tools.py::test_network_transport_refuses_to_start_without_a_token`, `::test_network_app_rejects_requests_without_the_token`, `::test_network_app_lets_the_right_token_through`; `agents/tests/test_pipeline_auth.py::test_auth_headers_carry_the_agent_token` | Verified |
| **A4** | WebSocket requires a valid token and an allowed Origin | `backend/test/realtime.test.js` (no token 401, wrong origin refused, valid token receives broadcasts, agent bearer header, closed on logout) | Verified |
| **D5** | One shared block list for secret files | `agents/tests/test_repository.py::test_previously_missed_secret_files_are_sensitive`, `::test_workspace_tools_refuse_writing_secret_files`, `::test_normal_files_are_not_sensitive`; `agents/tests/test_mcp_policy.py::test_sensitive_file_blocked` | Verified |
| **G3** | Duplicate code removed (diff logic moved to `agents/app/diffing.py`) | `agents/tests/test_mcp_diff.py`, `agents/tests/test_mcp_tools_backend.py` | Verified |
| **A2, F9** (done early with A1) | Who decides comes from the login; role dropdown removed | `backend/test/auth.test.js`, `backend/test/gates.test.js`, `src/App.test.jsx` | Verified |

### Review findings

The ECC code review of the Milestone 1 changes found 12 issues. #1 to #4 (the high and critical ones) were fixed first; #5 to #12 were handled in the cleanup pass:

| # | Finding | Result |
|---|---|---|
| 5 | Unlimited login attempts | **Fixed.** 5 wrong passwords per user and 30 attempts per address in 15 minutes, then 429 with `Retry-After`. Test: `backend/test/auth.test.js`. |
| 6 | First comments on a run with no artifacts row could race | **Fixed.** The row is created before it is locked. Test: `backend/test/concurrency.test.js` (two first comments, both stored). |
| 7 | Any reviewer could delete any comment | **Fixed.** Author or Admin only; older comments with no author are Admin-only. Test: `backend/test/auth.test.js`. |
| 8 | WebSocket stayed open after logout or expiry | **Fixed.** Logins are re-checked every 30 s and dead sockets closed with code 4001. Test: `backend/test/realtime.test.js`. |
| 9 | Session token in the WebSocket URL | **Deferred to Milestone 2.** Needs a single-use ticket endpoint. |
| 10 | Expired sessions were never deleted | **Fixed.** Deleted at each login. Test: `backend/test/auth.test.js`. |
| 11 | Tamper route open to any reviewer | **Fixed.** Admin-only (`requireAdmin`). Test: `backend/test/audit.test.js` (403 for an Engineer, 200 for an Admin). |
| 12 | `user-create` used a private readline API to hide the password | **Fixed.** Uses a muted output stream. Checked with a piped password. |

Also fixed during verification: two dashboard crashes (an infinitely recursive call in `src/api.js`, and the `App.jsx` realtime effect that returned `null` as its cleanup).

### Cleanup pass

- Backend `npm audit fix` (body-parser 1.20.9, qs 6.16.2); 0 vulnerabilities left.
- Vite 8 major upgrade skipped on purpose; no `npm audit fix --force` on the dashboard.
- Python: `_backend_get` returns `dict[str, Any] | list[Any]`; unused test imports removed; catch-all `except Exception` replaced by `httpx.HTTPError`/`ValueError` (backend calls) and `SubprocessError`/`OSError` (git) in `mcp/session.py` and `mcp/tools.py`. One catch-all is kept on purpose: it rolls a file back and re-raises.
- New tests: `test_workspace_tools.py`, `test_mcp_tools_backend.py`, `test_mcp_server_tools.py` (70 tests).
- Dashboard Vitest uses 4.1.12 with an npm override so its private copy of Vite is 7.x. Vitest 2.1.9 was rejected because it pulled in two critical advisories. The app itself still builds with Vite 5.4.

### Dashboard smoke tests (`src/App.test.jsx`)

Rendered inside `StrictMode`, like `main.jsx`. They cover the logged-out login screen, signing in, a wrong password, the logged-in dashboard (token on every request and on the WebSocket), and an expired session returning to login. With each of the two old bugs put back in a scratch copy, all 5 tests failed, so they would have caught both crashes.

### Automated Test Suite Totals

| Test Suite | Result | Details |
|---|---|---|
| **Python (`cd agents && pytest`)** | **221 Passed, 0 Failed** | 86% total coverage (`mcp/server.py` 95%, `mcp/tools.py` 99%, `repository/tools.py` 99%, `mcp/session.py` 72%) |
| **Node, in-memory (`cd backend && npm test`)** | **72 Passed, 0 Failed, 5 Skipped** | The 5 skipped tests need real Postgres |
| **Node, real Postgres (`cd backend && npm run test:pg`)** | **77 Passed, 0 Failed** | 94.78% line and 81.51% branch coverage |
| **Dashboard (`npm test`, Vitest + React Testing Library)** | **5 Passed, 0 Failed** | Login screen, sign-in, wrong password, logged-in dashboard, expired session |
| **Frontend Build (`npm run build`)** | **Built Cleanly** | No errors |

### Security and live checks

- `npm audit`: backend 0. Dashboard 4 remain (esbuild and postcss-selector-parser moderate, source-map-js and vite high), none critical; the Vite and esbuild ones need the Vite 8 upgrade. `pip-audit`: none.
- No secrets found; no `console.log` in `src/`.
- Live end-to-end run on an isolated stack: 26/26 original checks and 10/10 checks for the review fixes (#5 429 after 5 wrong passwords with `Retry-After: 900`, #6 both first comments stored, #7 delete gives 403/200/200/404, #8 socket closed with 4001 about 11 s after logout, #10 0 expired of 6 sessions).
- Browser check with the ECC Chrome DevTools tools: login screen, sign in, dashboard, no console errors.

### Known leftovers (not blocking)

- Finding #9 (token in the WebSocket URL), deferred to Milestone 2.
- The dashboard shows a delete button on comments the user cannot delete (they get a 403).
- Older lint and type warnings in `graph.py`, `main.py`, `llm.py` and `retriever.py`.
- The test numbers above were measured on the working tree before the Milestone 1 commit.

---

## Milestone 2: Real Checkpoints

**Status:** Completed and Verified (not committed yet)
**Branch:** `fix/milestone-2-checkpoints`

### Dependency gate

| Needed | From | Present in code |
|---|---|---|
| G4 | Milestone 1 | `docs/adr/0001-node-owns-run-state.md` (now marks steps 3 and 4 done, step 5 started) |
| E6 | Milestone 1 | `withTransaction` in `backend/src/db.js`, `SELECT ... FOR UPDATE` row locks |
| A1 | Milestone 1 | `requireHuman` / `requireAgent` in `backend/src/auth/middleware.js` |

### Items summary

| ID | What was built | Tests verifying it | Status |
|---|---|---|---|
| **B2** | One state machine: `backend/src/runs/machine.js` holds the allowed-moves table; `transition()` in `backend/src/runs/service.js` is the only code that changes `runs.step` (row lock, phase display, one audit event, one transaction). Unknown or missing step refuses everything. | `backend/test/state-machine.test.js` (24 tests, incl. an exhaustive check of every step x action x actor against a copy of the organised.md table), `backend/test/checkpoints-http.test.js` | Verified |
| **B5** | Only gates (`g1`, `g2`, `g3`) take approve or reject; robot steps refuse them for every role, including Admin. The robot can never approve, reject or cancel. | `state-machine.test.js::B5: robot steps cannot be approved or rejected by anyone`, `::the robot can never approve, reject or cancel`, `checkpoints-http.test.js::decide: robot step 409, ...` | Verified |
| **B3** | Real Gate 3 (`g3`, Engineer). `request_review` moves Code to Gate 3; the requester cannot give the final approval. MCP `request_approval` calls the robot action; coding tools are closed at `g3`. | `state-machine.test.js::the happy path walks every forward row of the table`, `::the requester cannot approve their own run at Gate 3`, `agents/tests/test_mcp_tools_backend.py::test_request_approval_stores_the_diff_and_moves_code_to_gate_3`, `agents/tests/test_mcp_policy.py::test_request_approval_only_from_code_or_gate_3`, `::test_coding_tools_are_closed_at_gate_3` | Verified |
| **B4** | Rework loop: Gate 1 reject goes to Requirements, Gate 2 to Design, Gate 3 to Code or Design (the reviewer picks; the server requires the choice). The dashboard's rework window offers Code/Design at Gate 3. | `state-machine.test.js::B4: each reject sends the run back to the right step`, `::B4: rejecting at Gate 3 needs a target`, `::B4 regression: reject at Gate 2, resubmit requirements, can never jump to Code`, `agents/tests/test_graph.py::test_reject_at_gate_2_goes_back_to_design_never_to_code`, `::test_reject_at_gate_3_goes_to_the_step_the_reviewer_chose`, `src/App.test.jsx::at Gate 3, Request Rework lets the reviewer send the work back to Design (B4)` | Verified |
| **B1** | `PATCH /runs/:id` removed. `PUT /phases/:key` takes metrics only (`state`/`status`/`at` get 403). Robots move a run only with `POST /runs/:id/actions/:action`; their artifacts ride on the move and are stored only if it is allowed. `PUT /artifacts` accepts only the current robot step's artifacts (closed at gates, Done and Cancelled). MCP tools and the pipeline no longer write state. | `checkpoints-http.test.js::B1: PATCH /runs/:id no longer exists ...`, `::B1: PUT /phases cannot change state ...`, `::a submission stores its artifact in the same step as the move, or not at all`, `::artifacts can only be written for the robot step the run is at`, `agents/tests/test_graph.py` (`assert_reports_work_only` in every flow), `agents/tests/test_mcp_tools_backend.py::test_submit_requirements_stores_them_and_asks_the_backend_to_open_gate_1` | Verified |
| **B8** | Approve carries the step the reviewer saw (`gate`); a stale one gets 409. A repeated robot submission returns 200 unchanged with no second move. Start claims the run once (`started_at`); the claim is released only when the pipeline was never reached. ("Retry" is read as a robot re-sending a submission; there is no separate retry endpoint in the code.) | `state-machine.test.js::B8: approving twice never skips a gate`, `::B8: an approve meant for Gate 2 cannot land on Gate 3`, `::B8: a repeated robot submission is a no-op`, `checkpoints-http.test.js::B8: *` (6 tests), `concurrency.test.js::five copies of one robot submission at once`, `src/App.test.jsx::approve tells the server which gate the reviewer was looking at (B8)` | Verified |
| **E2** | The agent audit endpoint refuses `actor` and `createdAt`; the server stamps the agent token name and its own clock, and accepts only work events (`mcp.`, `repo.`, `workspace.`, `sandbox.`, `pipeline.`). Step changes are written only by the state machine. | `checkpoints-http.test.js::E2: *` (3 tests), `state-machine.test.js::every step change writes exactly one audit entry with the real actor and server time`, `agents/tests/test_mcp_tools_backend.py::test_audit_entries_never_carry_a_client_chosen_actor` | Verified |
| **A2** (re-check) | Decisions, cancels and comments take the name and role from the login; the pipeline and the audit log get the logged-in name. | `auth.test.js::Admin may decide any gate; the actor comes from the login`, `::comment author and role come from the login`, `gates.test.js::HTTP decide broadcasts a run.updated event`, `decide-pipeline.test.js::the pipeline is told which gate was decided, where the run went, and by whom` | Verified |
| **F9** (re-check) | No role dropdown: `grep` finds no `Acting as` and no `<select>` in `src/`; the rework window now says "Signed in as". | `src/App.test.jsx` (login role shown in header), grep | Verified |
| **#9** (M1 leftover) | `POST /auth/ws-ticket` gives a reviewer a single-use ticket valid 30 s; the WebSocket accepts `?ticket=` or a bearer header, never `?token=`. | `backend/test/realtime.test.js::#9: *` (5 tests), `src/App.test.jsx::logged in: the dashboard renders the run with the session token attached` | Verified |
| **#7 UI** (M1 leftover) | The comment delete button shows only to the author or an Admin (`src/lib/permissions.js`). | `src/components/views/SpecsDesignView.test.jsx` (3 tests) | Verified |

### Test-first evidence (RED, then GREEN)

| Suite | RED (before the fix) | GREEN (after) |
|---|---|---|
| `backend/test/state-machine.test.js` | `ERR_MODULE_NOT_FOUND: src/runs/machine.js` (compile-time RED) | 24/24 |
| `backend/test/checkpoints-http.test.js` | 14 of 15 failing at runtime; later additions also seen failing first: `details` 1, artifacts-with-move 1, review fixes 4 | 21/21 |
| `backend/test/realtime.test.js` | `ERR_MODULE_NOT_FOUND: src/auth/tickets.js` | 11/11 |
| `agents/tests` (graph, policy, tools, pipeline auth) | 28 failing; `request_approval` gating 1 | 235/235 |
| `src/` Vitest | 6 failing (ticket URL, decide `gate`, Gate 3 target x2, delete button x2); then 2 (Start, legacy run) | 13/13 |

One test needed a correction while going GREEN: `B4: each reject ...` expected the Gate 3 phase row to read `pending` after sending work back. The code shows it as `rejected` ("Changes requested") until the run moves on, on purpose, so the assertion was changed and an extra check added that it returns to `pending` after the next move. The "agent cannot write step-change events" test passed before the fix for the wrong reason (missing `actor`), so it was tightened to also prove a valid work event is accepted.

### "Done when" acceptance verification

#### 1. Every row in the allowed-moves table has a test, and every move not in the table is refused.
```bash
cd backend && TEST_DATABASE_URL=... node --test --test-reporter=spec --test-name-pattern="machine knows exactly|every \(step, action, actor\)|..." test/state-machine.test.js test/checkpoints-http.test.js
```
```
✔ the machine knows exactly the steps and actions of the design table
✔ every (step, action, actor) combination matches the allowed moves table
✔ an unknown or missing step refuses everything (fail closed)
✔ an unknown action or actor is refused
✔ B5: robot steps cannot be approved or rejected by anyone
✔ the robot can never approve, reject or cancel
✔ the happy path walks every forward row of the table
✔ B4: each reject sends the run back to the right step
✔ B4: rejecting at Gate 3 needs a target (code or design)
✔ cancel works from every active step and is final
✔ wrong role is refused and changes nothing
✔ the requester cannot approve their own run at Gate 3
✔ the full table works over HTTP, and the robot route only moves robot steps
✔ robot actions: unknown action 400, not allowed 409, human caller 403, unknown run 404
✔ decide: robot step 409, wrong role 403, bad decision 400, Gate 3 reject needs a target
✔ cancel: Planner or Engineer only, final afterwards
```
The exhaustive test checks all 8 steps x 8 actions x 4 actors (256 combinations) and counts exactly 35 allowed ones (3 robot rows, 7 gate rows x role + Admin, 6 cancel rows x 3 roles).
**Result:** Passed.

#### 2. "Reject at Gate 2, resubmit requirements, jump to Code" is fixed.
```
✔ B4 regression: reject at Gate 2, resubmit requirements, can never jump to Code
tests/test_graph.py::test_reject_at_gate_2_goes_back_to_design_never_to_code PASSED
tests/test_graph.py::test_reject_at_gate_3_goes_to_the_step_the_reviewer_chose PASSED
```
After the Gate 2 reject the run is at Design; `submit_requirements`, approving Gate 1 or Gate 2, and `request_review` are all refused, the Code phase stays `pending`, and the only way on is a new design through Gate 2.
**Result:** Passed.

#### 3. A finished run cannot be reopened.
```
✔ a finished (Done) run cannot be reopened by anyone
✔ Done and Cancelled refuse every action, from every actor
✔ cancel works from every active step and is final
✔ a cancelled run cannot be decided
```
**Result:** Passed.

#### 4. Every step change has exactly one audit entry with the real logged-in name.
```
✔ every step change writes exactly one audit entry with the real actor and server time
✔ creating a run records who asked for it
✔ a refused move writes nothing to the audit log
✔ five reviewers approving Gate 1 at once: one approval, Design is not skipped   (real Postgres)
✔ five copies of one robot submission at once: one move, one audit entry          (real Postgres)
✔ a decision that fails half-way changes nothing                                   (real Postgres)
✔ E2: the audit endpoint refuses a caller-chosen actor or date
✔ E2: an agent cannot write step-change or run events into the diary
✔ E2: agent work events are stamped with the token name and the server clock
✔ a robot action can attach details to its one audit entry
```
The main test walks 12 moves (with rejects at all three gates) and checks after each one: exactly one new entry, the expected event name, actor (`pat-planner`, `eli-engineer` or `agent:mcp-agent`), `from`/`to`, and a server-clock timestamp.
**Result:** Passed.

### Design decisions worth knowing

- **Pipeline mode was ported, not left broken.** Closing `PATCH /runs` and phase state writes would have broken the LangGraph pipeline, which used them for every move. `agents/app/graph.py` now calls the robot actions, its gate nodes only route on the decision the backend already recorded, every reject sends work back (no more "reject = stop"), and `cancel` ends the graph. The keep-or-remove decision for pipeline mode stays with G9 (Milestone 5).
- **The backend records a decision before telling the pipeline.** `/decide` commits the move, then asks the pipeline to continue. A pipeline failure is returned as a `pipeline` warning next to the recorded decision; it is never applied twice. A decision the state machine refuses is never forwarded.
- **Admin** may act for any human role (Milestone 1 rule), but never as the robot, and the requester rule applies to an Admin too.
- **Legacy runs** created before this change have no `step`; every move on them is refused (fail closed) and the dashboard does not offer Approve.

### Review findings (ECC code-reviewer)

0 critical, 0 high, 3 medium, 4 low.

| # | Finding | Result |
|---|---|---|
| M1 | A pipeline run whose pipeline is gone stalls silently after a decision | **Fixed.** The decision is still recorded and the response carries `pipeline: { resumed: false, reason: 'not_running' }` for runs the pipeline started. Test: `checkpoints-http.test.js::a decision on a pipeline run whose pipeline is gone is recorded with a warning`. |
| M2 | `PUT /artifacts` could swap the reviewed diff or requirements at a gate or after Done | **Fixed.** Only the current robot step's artifacts can be written. Test: `::artifacts can only be written for the robot step the run is at`. |
| M3 | A failed Start released the claim even when the graph might have begun | **Fixed.** Released only on connection refused. Tests: `::B8: a start that never reached the pipeline can be tried again`, `::B8: a start that failed inside the pipeline is not released`. |
| L1 | Start shown for a run that was already started | **Fixed.** `run.started` is exposed and the button is hidden. Test: `src/App.test.jsx::Start is offered only for a run at Requirements that was never started`. |
| L2 | Legacy runs with no step show Approve | **Fixed** in the UI (Approve disabled). Test: `src/App.test.jsx::a run with no known step ... cannot be approved`. The server already refused. |
| L3 | Ticket fetch retries every 1.5 s after the session expires | **Not changed.** A 401 from the ticket call already signs the user out, which closes the effect and stops the loop. |
| L4 | A non-string `gate` silently dropped the stale check | **Fixed.** 400. Test: `::decide: a gate that is not a string is refused, not ignored`. |
| (note) | Seeded demo runs have no requester id, so the requester rule does not apply to them | Demo data only; left as is. |
| (note) | `/resume` to the pipeline has no timeout, so a slow phase holds the in-process `deciding` guard | Unchanged from Milestone 1; the database lock is what protects state. Left for G6/G9. |

### Automated test suite totals

| Test Suite | Result | Details |
|---|---|---|
| **Python (`cd agents && .venv/bin/pytest -v`)** | **235 Passed, 0 Failed** | Coverage not measured this time: `pytest-cov`/`coverage` are not installed in `agents/.venv` |
| **Node, in-memory (`cd backend && npm test`)** | **123 Passed, 0 Failed, 7 Skipped** | The 7 skipped tests need real Postgres |
| **Node, real Postgres (`cd backend && npm run test:pg`)** | **130 Passed, 0 Failed** | 96.15% line, 88.46% branch coverage (`node --test --experimental-test-coverage`); `machine.js` 100% lines / 98% branches |
| **Dashboard (`npm test`, Vitest)** | **14 Passed, 0 Failed** (2 files) | `src/App.test.jsx` (11), `src/components/views/SpecsDesignView.test.jsx` (3) |
| **Frontend Build (`npm run build`)** | **Built Cleanly** | 1,905 modules transformed in 1.05 s |

### Live checks

A real backend on a throwaway Postgres database (`gatekeep_m2_live`, dropped afterwards), driven over HTTP and WebSocket with real logins (Planner, two Engineers) and a real agent token: **30/30 checks passed**, after the review fixes as well. They covered every table row, the Gate 2 regression, Done refusing everything, 10 moves giving exactly 10 audit entries with login and token names, a valid chain, and single-use tickets (a reused ticket and `?token=` both get 401). The first run reported 29/30 because the script expected 12 moves where it made 10; the script was corrected, not the code.

Browser check (ECC Chrome DevTools, real Chrome 157, dashboard on Vite against the live backend and a throwaway Postgres, dropped afterwards): **passed.** The first attempt could not start because a stale DevTools Chrome window held the profile; it was closed and the check re-run.

| Check | Observed in the browser |
|---|---|
| Sign in as `eli` (Engineer) | Dashboard loads; header shows "eli Engineer" |
| Pipeline | 7 steps (Requirements, Gate 1, Design, Gate 2, Code & Tests, Gate 3, Done); the run waiting at Gate 3 shows step 6 "Ready for review" with the first five steps ticked |
| Gate 3 rework window | Offers "Send the work back to": Code (default) or Design; says "Signed in as Engineer" |
| Reject to Design | The browser's `POST /runs/RUN-UI-G3/decide` body was `{"decision":"reject","feedback":"...","gate":"g3","target":"design"}`; the server moved the run to Design, wrote one `g3.rejected` entry by `eli`, and the chain verified |
| Live update | After the run was moved back to Gate 3 through the API, the open page switched to "Awaiting Gate: Engineer" with no refresh |
| WebSocket URL | The app's socket was `ws://localhost:4141/?ticket=...`; the session token appeared in no URL (Vite's own hot-reload socket on `:5181` has its own token and is dev-mode only) |
| Comment delete button (#7) | `eli` sees the trash icon only on their own comment, not `pat`'s; `rae` sees it on neither |
| Requester rule | As `rae`, who created the run, Approve showed "Decision NOT recorded ... the person who asked for this work cannot give the final approval"; the run stayed at `g3` and no audit entry was written |
| Console | No errors or warnings, apart from the expected 403 from the refused approve |

Things seen in the browser that are not Milestone 2 bugs but are worth knowing:
- The Approve buttons are enabled for a reviewer whose role does not match the gate (for example an Engineer at Gate 1) and for the requester at Gate 3. The server refuses them with a clear message, so this is a usability gap, not a security one; it belongs with the gate banner (F4).
- The Audit Ledger card said "SHA-256 HMAC" although the chain is plain SHA-256 (HMAC is E1, Milestone 3). **Fixed after the browser check** (see below).
- A step sent back for rework keeps its old completion time (for example Design still shows the first completion time while it shows "Rework requested").

### Known leftovers (not blocking)

- B6/B7 (Milestone 3): approval is not yet tied to a diff hash or test run ID.
- Deferred to Milestone 4 (F4, with the gate banner): the Approve buttons do not yet disable for a reviewer whose role does not match the gate or for the requester at Gate 3 (the server refuses them with a clear message), and a step sent back for rework keeps its old completion time.
- Pipeline mode recovery: if the pipeline process loses a run, the `/decide` response now carries a warning (the dashboard does not display it yet), and the only way out is Cancel (G9).
- There is no Cancel button in the dashboard yet (the API exists); planned with the gate banner (F4).
- No Python lint run: `ruff` is not installed on this machine.

### Follow-up after the browser check: "HMAC" label

The browser check showed the dashboard claiming HMAC while the chain is plain SHA-256 (organised.md Part 7 / rule 6: never claim what the code does not do). Fixed until E1 makes it true:

| Where | Before | After |
|---|---|---|
| Overview, Audit Ledger Seal card (`src/components/views/OverviewDashboardView.jsx`) | `SHA-256 HMAC` | `SHA-256 hash chain` |
| Audit Chain tab (`src/components/views/AuditLogView.jsx`) | `Algorithm: SHA-256 (HMAC signed)` | `Algorithm: SHA-256 hash chain` |

The second one is the same false claim on another tab, so it was fixed too (only the Overview label had been asked for).

Test: `src/App.test.jsx::the dashboard says SHA-256, never HMAC, until the chain really is HMAC-signed (E1)` opens the Overview and the Audit Chain tab and checks the new text and that `HMAC` appears nowhere. RED first: it failed before the change (the text was not found). While going GREEN the test also needed a fix of its own (the nav has two buttons with the same title, desktop and mobile, so the selector was ambiguous); the code was not touched for that.

Re-run: `npm test` 14/14 passed, `npm run build` built cleanly. Only dashboard label text and one test changed, so the Python and backend suites were not re-run; their results above stand.
