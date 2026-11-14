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

---

## Milestone 3: Trustworthy Evidence

**Status:** Completed and verified (including the live browser check)
**Branch:** `fix/milestone-3-trustworthy-evidence`

### Dependency gate

| Item | Needs | Prerequisite state |
|---|---|---|
| C2 | C1 | `[x]` Milestone 0, verified (`tests/test_sandbox.py::test_verdict[*]`) |
| C3 | C2 | built first in this milestone |
| B6 | B3 | `[x]` Milestone 2, verified (Gate 3 state machine) |
| B7 | B3, B6, C2 | all three done before B7 |
| D2, D3 | D5 | `[x]` Milestone 1, verified (one block list) |
| D8 | D3, D5 | both done before D8 |
| E4 | none | |
| E1 | E4 | built together, same stamp format |

### Items summary

| ID | Problem fixed | Test name(s) verifying the fix | Status |
|---|---|---|---|
| **C2** | Counts come from pytest's JUnit XML report on a separate `/results` mount, never from printed text. Each test's name, file and outcome is saved as a backend **test run**. A missing, broken, oversized, DOCTYPE-bearing or non-regular-file report never passes. | `tests/test_sandbox.py::test_printing_999_passed_does_not_change_the_count`, `::test_a_missing_junit_report_is_never_a_pass`, `::test_each_test_name_and_result_is_saved`, `::test_a_huge_or_broken_junit_report_is_not_trusted`, `::test_a_report_that_is_not_a_regular_file_is_not_read[symlink,fifo]`, `::test_a_report_with_a_doctype_is_not_trusted`, `::test_real_sandbox_ignores_printed_counts_and_hides_secrets` (real Docker); `backend/test/evidence.test.js::C2: a test run must be well formed`, `::C2 + C3: the run shows the latest test run with every test, marked new or existing`; `backend/test/runs.test.js::tests + sandbox surface on the run; results come only from a recorded test run (C2)`; `src/App.test.jsx::the test results page lists every test, marked new or existing (C2, C3)` | Verified |
| **C3** | The whole suite always runs (`target` no longer narrows). Each test is marked new or existing against git `HEAD`. An existing test that did not run, or is now skipped when it was not written to skip at `HEAD`, fails the run. Unreadable git history fails the run. | `tests/test_sandbox.py::test_the_robot_cannot_narrow_the_run_to_one_target`, `::test_new_and_existing_tests_are_marked`, `::test_deleting_an_existing_test_fails_the_run`, `::test_skipping_an_existing_test_counts_as_not_running_it`, `::test_an_existing_test_that_was_already_skipped_may_stay_skipped`, `::test_a_broken_git_history_fails_the_run_instead_of_marking_everything_new`, `::test_a_repo_with_no_commits_has_no_baseline`; `tests/test_mcp_tools_backend.py::test_run_tests_always_runs_the_whole_suite` | Verified |
| **B6** | `request_approval` freezes the workspace (a marker outside it) before the move to Gate 3. `write_file` / `apply_patch` are refused and audited while frozen. The freeze lifts only when the backend says the run is back at Code. A per-run lock stops writes racing the hand-over. An unclear failure keeps the freeze. The backend refuses new test runs outside Code. | `tests/test_mcp_tools_backend.py::test_writes_after_request_review_are_refused`, `::test_the_freeze_holds_even_if_the_backend_answer_is_stale`, `::test_the_freeze_lifts_when_gate_3_sends_the_work_back_to_code`, `::test_a_refused_review_request_does_not_freeze_the_workspace`, `::test_an_ambiguous_review_failure_keeps_the_freeze_if_the_run_reached_gate_3`; `tests/test_agent_context.py::test_pipeline_hands_over_the_tested_fingerprint_and_freezes_the_workspace`; `backend/test/evidence.test.js::B6 (server side): test runs can only be recorded while the run is at Code` | Verified |
| **B7** | Tree fingerprint (`agents/app/fingerprint.py`). Each test run is stored with its fingerprint. `request_review` must carry a fingerprint. Gate 3 approve requires the latest test run to have that fingerprint and `Passed`, with counts that agree (`reviewEvidence`, one rule shared by the run view and approve). The approval's audit entry records `{fingerprint, testRun}`. The dashboard disables Approve with the reason. | `backend/test/evidence.test.js::B7: *` (7 tests), `::HTTP: test runs are agent-only, result fields cannot be faked through PUT /tests, approve refusal says why`; `tests/test_mcp_tools_backend.py::test_run_tests_records_a_test_run_bound_to_the_code_fingerprint`, `::test_request_approval_sends_the_code_fingerprint`, `::test_the_fingerprint_changes_when_any_file_changes`; `src/App.test.jsx::at Gate 3, Approve is disabled with the reason when the code changed after the last test run (B7)`, `::at Gate 3 with no review evidence at all, Approve stays disabled (fail closed)` | Verified |
| **D2** | `resolve_inside()` follows every symlink and refuses a real path that leaves the workspace, lies in `.git`, or is a sensitive file. Used by read, write, patch, search, file list, scanner, retriever, context and the sandbox copy. | `tests/test_repository.py::test_reading_through_a_bad_shortcut_is_refused[*]`, `::test_writing_through_a_bad_shortcut_is_refused[*]`, `::test_a_harmless_shortcut_inside_the_workspace_still_works`, `::test_search_list_and_context_never_follow_bad_shortcuts`, `::test_the_retriever_does_not_read_through_bad_shortcuts` | Verified |
| **D3** | Secrets become `***` in file reads, search (matched on the redacted text, so it cannot confirm a value), `workspace_diff`, repository context and test output. Covered: whole private-key blocks (also with no END line), unquoted `.env`/YAML values, upper-case `KEY=value` anywhere, JSON, Stripe/AI keys, `user:pass@` URLs, Basic auth. Key names are length-capped, so a 100k-character line takes milliseconds. | `tests/test_repository.py::test_a_whole_private_key_block_is_hidden`, `::test_a_private_key_with_no_end_line_is_hidden_to_the_end`, `::test_unquoted_and_json_secrets_are_hidden[*]` (6), `::test_ordinary_code_about_passwords_is_left_alone[*]` (4), `::test_vendor_keys_and_url_credentials_are_hidden[*]` (5), `::test_search_results_are_redacted_and_cannot_find_secret_values`, `::test_workspace_diff_is_redacted`, `::test_redaction_stays_fast_on_huge_lines`; `tests/test_sandbox.py::test_secrets_in_test_output_are_redacted`; `tests/test_mcp_tools_backend.py::test_get_diff_hides_secrets` | Verified |
| **D8** | Tests run on a copy of the workspace without secret files and folders (`.env`, keys, `.ssh/`, `.git/`, ...) or unsafe shortcuts. The real workspace is untouched. | `tests/test_sandbox.py::test_secret_files_are_stripped_from_the_sandbox_copy`, `::test_the_sandbox_copy_and_the_fingerprint_cover_the_same_files`, `::test_real_sandbox_ignores_printed_counts_and_hides_secrets` (real Docker: `test_env_is_not_in_the_sandbox` passed) | Verified |
| **E4** | `run_id` is inside every stamp. `audit_heads` holds the latest seq and stamp with its own HMAC. Verify reports `truncated`, `head_mismatch` or `head_missing`. An append refuses a head whose seal is invalid or missing, or that doesn't match the last entry, instead of re-sealing it. An existing run's wiped diary cannot restart. | `backend/test/audit-hmac.test.js::E4: *` (9 tests); `backend/test/chain.test.js::computeHash covers the run id...`, `::verifyChain refuses a chain with no head, and one that stops short of its head` | Verified |
| **E1** | Stamps are HMAC-SHA256 with `GATEKEEP_AUDIT_KEY` (env, ≥32 chars). No key means the backend refuses to start and nothing can be stamped. The dashboard says **SHA-256 HMAC** again. | `backend/test/audit-hmac.test.js::E1: the stamp is keyed...`, `::E1: no key, or a short key, refuses to stamp (fail closed)`, `::E1: editing a row and recomputing every plain SHA-256 stamp is detected`; `src/App.test.jsx::the dashboard says SHA-256 HMAC now that the chain is HMAC-signed (E1)` | Verified |

### Test-first evidence (T1)

Every new test was run and failed for the intended reason before the code changed. The user asked to see this report before any commit, so RED/GREEN evidence is kept here rather than in checkpoint commits.

| Area | RED (before the fix) | GREEN (after) |
|---|---|---|
| Sandbox C2/C3/D8/D3 | 10 failed: "no /results mount", `assert 5 == 0` (printed "5 passed" trusted), `KeyError: 'cases'` | 26/26 sandbox tests |
| Repository D2/D3 | 14 failed: read/write through `config.py -> .env` allowed, key bodies, unquoted values, search, diff not redacted. (Shortcuts *outside* the workspace were already refused by the old containment check.) | 64/64 |
| MCP B6/B7/C3 | Compile-time RED (`app.fingerprint` missing). Then, against a stub that raised `NotImplementedError`, 8 failed. Two guard tests (freeze lifts / refused request leaves it writable) cannot fail before a freeze exists. | 37/37 |
| Pipeline B6/B7 | `KeyError: 'fingerprint'` | passes |
| Backend B7 | Compile-time RED (`recordTestRun` missing). Then, against a stub, 11 failed. | 11/11 |
| Backend E4/E1 | Compile-time RED (`auditKey` missing). Then, against a stub, 9 failed. | 9/9 |
| Dashboard | 4 failed (label, Approve not blocked, no test list) | 17/17 |
| Review fixes | Python: 11 failed. The 100k-line redaction and the FIFO report each hung past 120 s and were stopped. Backend: 5 failed (rollback re-sealed, unsealed head accepted, tail mismatch accepted, wiped diary restarted, inconsistent "Passed" accepted). | all green |

Test-harness corrections made while going GREEN (the code was not changed for these):
- The fake `docker run` also swallowed the `git` calls of the code under test. It now passes them to the real `subprocess.run`.
- The pipeline test expected the workspace to stay thawed after a Gate 3 rework. The pipeline actually re-tests and hands over again, so it is frozen again. The test now checks the second test run and the second hand-over.
- The Approve selectors matched two buttons (header and Overview card). The tests now check both.

### "Done when" acceptance verification

All 7 are proven by automated tests and by the live run below (real backend, real Docker, real MCP tools).

| # | Criterion | Automated proof | Live proof |
|---|---|---|---|
| 1 | A test printing `999 passed` does not change the count | `test_printing_999_passed_does_not_change_the_count`, `test_real_sandbox_ignores_printed_counts_and_hides_secrets` (real Docker: 1 passed, 1 failed, while the output said `999 passed` twice) | `PASS 1. ... [passed=2 failed=1 total=3]` |
| 2 | A test reading `.env` finds none, and printed secrets show `***` | `test_secret_files_are_stripped_from_the_sandbox_copy`, `test_secrets_in_test_output_are_redacted`, real-Docker test above | `PASS 2a`, `PASS 2b` (`API_KEY=***`) |
| 3 | Reading or writing through a shortcut to `.env` or outside the workspace is refused in every tool | D2 tests above | `PASS 3a`–`3d` (read, write, outside, search/list/context) |
| 4 | Writing after `request_review` is refused at Gate 3 | B6 tests above | `PASS 4a` write, `4b` patch, `4c` MCP phase policy |
| 5 | Gate 3 approve refused/disabled when the code hash does not match the latest passing test run | B7 backend + dashboard tests | `PASS 5a` (`reason: code_changed`), `5b` (HTTP 409 "the code changed after the last test run"), `5c` |
| 6 | Editing a row and recomputing plain SHA-256 is detected | `E1: editing a row and recomputing every plain SHA-256 stamp is detected` | `PASS 6` (direct SQL on the live DB: `hash_mismatch` at #2) |
| 7 | Deleting the last entry is detected | `E4: deleting the last entry is detected` and 8 more E4 tests | `PASS 7` (`truncated`), `7b` head moved back (`head_mismatch`), `7c` head deleted (`head_missing`), `7d` append then refused |

### Review findings (ECC code-reviewer and ECC security-reviewer)

Code reviewer: 0 critical, 2 high, 3 medium, 3 low. Security reviewer: 0 critical, 4 high, 6 medium, 3 low. Several findings overlap.

| # | Finding | Result |
|---|---|---|
| CR1 / SR1 (HIGH) | Redaction regex is quadratic: a 20k-character line took ~10 s, and the robot could plant one to hang the MCP server (worst inside the per-run lock at `request_approval`) | **Fixed.** Key prefixes anchored and capped at 64 characters. 100k characters now take milliseconds. Test: `test_redaction_stays_fast_on_huge_lines` (RED: did not finish in 120 s). |
| CR2 (HIGH) | `lockHead` re-sealed a rolled-back head on the next append, laundering a truncation. A head with a NULL seal was also accepted. | **Fixed.** `checkedHead` refuses a head whose seal is invalid or missing, or that doesn't match the last entry. 3 tests. |
| SR3 (HIGH) | The review diff hid gitignored files and paths like `evil__pycache__/`, but the sandbox ran them (for example a hidden `conftest.py`) | **Fixed.** The diff now lists every untracked file, ignored ones included. The diff, the sandbox copy and the fingerprint share one exact-name skip list (`fingerprint.SKIP_DIRS`). Tests: `test_the_review_diff_shows_files_hidden_by_gitignore`, `test_the_sandbox_copy_and_the_fingerprint_cover_the_same_files`. |
| SR4 (HIGH) | A DB attacker who saved an old sealed head can roll a run back to it | **Not fixed (known limit).** Needs an anchor outside the database. Documented in the README. |
| CR3 / SR2 (MED) | An existing test marked skip/xfail counted as having run | **Fixed** (skipped existing tests count as not run unless written to skip at `HEAD`). An existing test *body* weakened to `assert True` is not detected automatically; it shows up in the reviewer's diff. Documented. |
| CR4 / SR9 (MED) | Git failures made every test "new" (fail open), and a git timeout crashed the run | **Fixed.** Only "no `.git`" or "no commit yet" means no baseline; any other git failure fails the run with a message. |
| CR5 / SR13 (MED) | Backend accepted `status: Passed` with failures, missing existing tests or counts that don't add up | **Fixed** in `validTestRun`. 6 more cases in the C2 validation test. |
| SR5 (MED) | `junit.xml` as a symlink or FIFO could hang or fool the host; DOCTYPE entities | **Fixed.** Opened with `O_NOFOLLOW \| O_NONBLOCK`, must be a regular file, at most 5 MB is read, DOCTYPE/ENTITY rejected. 3 tests. |
| SR6 (MED) | `/results` is a writable host folder with no size cap (tests could fill the disk until the timeout) | **Not fixed (leftover).** A container tmpfs cannot be read back after `--rm`. Bounded by the 30 s timeout. |
| SR7 (MED) | Secrets in ordinary files can leave encoded through test output; some formats were not redacted | **Partly fixed.** Added Stripe, AI-API, URL-credential and Basic-auth patterns. Encoded output (reversed, hex) cannot be caught by patterns. Documented. Returning only counts to the robot would change the tool contract and is left for a later decision. |
| SR8 (MED) | Wiping a run's diary and head let a fresh chain start | **Fixed.** A run that exists can only start its diary with `run.created`, and an existing run with an empty diary shows as broken. Test: `E4: wiping a run diary ...`. Deleting the whole run, row included, stays undetectable without an external registry (leftover). |
| SR10 (MED) | `dev.sh` exported the audit key to the agent, MCP and Vite processes | **Fixed.** Those processes `unset GATEKEEP_AUDIT_KEY`. |
| SR11 (LOW) | An unclear `request_approval` failure thawed the workspace even if the run reached Gate 3 | **Fixed.** The run is re-read and the freeze lifts only if it is certainly at Code. The pipeline keeps the freeze on failure. Test added. |
| CR6 / SR12 (LOW) | The fingerprint and the sandbox copy used different skip rules (`*.pyc`) | **Fixed** (one shared rule, see SR3). |
| CR7 (LOW) | The pipeline thaws without asking the backend | **Not changed.** The graph only re-enters the coding node after the backend has recorded a Gate 3 reject to Code (it resumes on `/resume` from `/decide`), so the rule holds. |
| CR8 (LOW) | Migration impact | **Noted.** Runs from before this change show no test results. A run already at Gate 3 has no fingerprint, so it can only be sent back. Chains stamped with plain SHA-256 no longer verify. Reset dev data with `scripts/dev.sh reset`. All of this fails closed. |

### Automated test suite totals (final, after the review fixes)

| Test suite | Result | Details |
|---|---|---|
| **Python (`cd agents && .venv/bin/pytest -v`)** | **293 passed, 0 failed** | Includes 3 real Docker sandbox tests. Coverage not measured (`pytest-cov` not installed). |
| **Node, in-memory (`cd backend && npm test`)** | **149 passed, 0 failed, 7 skipped** | The 7 skipped tests need real Postgres |
| **Node, real Postgres (`npm run test:pg`, with `--experimental-test-coverage`)** | **156 passed, 0 failed** | All files: 96.71% lines / 89.45% branches. `audit/chain.js` 100% lines, `audit/service.js` 100% lines, `runs/service.js` 96.35% lines. |
| **Dashboard (`npm test`, Vitest)** | **18 passed, 0 failed** (2 files) | Includes the browser-check fix below |
| **Frontend build (`npm run build`)** | **Built cleanly** | 1,905 modules, rebuilt after the browser-check fix |

### Live checks

A real backend on a throwaway Postgres database (`gatekeep_m3_live`) with its own audit key, a real agent token and logins (Planner, two Engineers):

- **Fail closed at startup:** without `GATEKEEP_AUDIT_KEY` the backend exited with code 1 and a clear message.
- **MCP + Docker run: 21/21 checks passed.** The real `GateKeepTools` drove a real git workspace holding `.env`, a shortcut to it, and an existing test, using the real Docker sandbox. The robot's "evil" test printed `999 passed`, tried to open `.env` and printed a secret. Checks covered criteria 1–5, C2/C3, the rework loop, and a final approval recording the fingerprint and test run. Re-run after the review fixes, still 21/21.
- **Database attacker run: 7/7 checks passed.** Direct SQL on the live database, then the API's own verify: criteria 6 and 7, head moved back, head deleted, and an append refused afterwards. Re-run after the review fixes, still 7/7.
- **Browser check (ECC Chrome DevTools, real Chrome 157): passed.** Dashboard on Vite (`:5181`) against the live backend, signed in as `eli` (Engineer). On the first attempt DevTools could not start, because an old automation Chrome held its profile. Once the profile was free the check ran:

| Check | Observed in the browser |
|---|---|
| Gate 3, code changed after the last passing test run (`RUN-M3-UI`) | Header "Approve Gate" and Overview "Approve Engineer" both **disabled** with the tooltip "The code changed after the last test run". The gate card says "The code changed after the last test run. Approve is disabled." Clicking was rejected (element not interactive), and no `/decide` request appeared in the network log. |
| Code Review IDE at that gate | Both Approve buttons disabled with the same reason, plus the same note. "Request Changes" stays **enabled**. |
| Gate 3 with no test run at all (`RUN-M3-UI2`) | Approve disabled: "No test run was recorded for this code. Approve is disabled." |
| Test Results tab | "Tests in the last run · 1 existing · 1 new": `test_existing` marked **Existing**, `test_limit_429` marked **New**. Outcome "Passed, 2 passed · 0 failed · 2 total". Ledger card "HMAC-SHA256 chained". |
| Overview ledger | "Ledger Algorithm: SHA-256 HMAC" (E1 label restored) |
| Gate 3 rework loop | Request Rework → Code (default) → the run showed "REWORK REQUESTED" (`POST /decide` body `{"decision":"reject","gate":"g3","target":"code",...}`). The robot then recorded a passing test run on the current fingerprint and requested review through the API. The **open page switched live (WebSocket, no reload)** to Gate 3 with both Approve buttons enabled and the note gone. |
| Approve the exact tested version | Clicked "Approve Engineer": the run went to **Done / Production Ready**, 9 verified blocks. The `g3.approved` diary entry carries `evidence: {fingerprint: bbbb…, testRun: 804af5f9…}`, matching the latest test run. |
| Rework feedback text | With DevTools `fill` the typed text did not reach React state, so the default text was sent: a tool artifact. With real keystrokes (`type_text`) the diary recorded "Overall Guidance: Run the tests on this exact code first". The app is correct. |
| Audit Chain tab, row edited + plain SHA-256 recomputed (`RUN-M3-A6`) | "Tamper Detected (#2)", "Cryptographic Integrity Failure Detected at Block #2", the HMAC explanation, stored vs recomputed stamp, and "Algorithm: HMAC-SHA256 chain, run-bound, head-sealed". Footer "Chain broken". |
| Audit Chain tab, head deleted (`RUN-M3-A7`) | "The sealed chain head for this run was deleted, so missing entries could not otherwise be detected." |
| Console | One 404 for `/favicon.ico` (no favicon in `public/`, harmless). No other errors or warnings. |

**Bug found in the browser check and fixed:** for a deleted head (`brokenAt: null`) the Audit Chain tab still said "Tamper Detected (#2)" and "at Block #2". An old fallback in `AuditLogView.jsx` invented block 2 whenever a chain was broken without a block number (against rule 5, no fake data). It now shows a block number only when the server reports one. Test first: `src/App.test.jsx::a deleted chain head is explained without inventing a block number (E4)` failed (heading read "...at Block #2"), then passed. After the hot reload the browser showed "Tamper Detected" and "Cryptographic Integrity Failure Detected" with no number.

### Known leftovers (not blocking)

- Audit rollback to an old sealed head, and deleting a whole run, need an anchor or registry outside the database.
- A `conftest.py` that attacks pytest itself can still forge its report. It is now always visible in the reviewer's diff, even if gitignored.
- An existing test whose body is weakened is not flagged automatically, only shown in the diff.
- `/results` has no disk cap beyond the 30 s timeout.
- Encoded secrets in test output cannot be caught by pattern redaction.
- Test runs (`test_runs` rows) are not covered by the audit chain, so a database attacker could forge one. The approve audit entry records which test run and fingerprint were used.
- No Python lint run: `ruff` is not installed on this machine.

---

## Milestone 4: Clear Reviewer Experience

**Status:** Completed and verified (including the live browser check)
**Branch:** `fix/milestone-4-reviewer-experience`

### Dependency gate

| Item | Needs | Prerequisite state |
|---|---|---|
| G2 | F1, F2, F3, G1 | `[x]` Milestone 0, verified |
| F4 | B3 | `[x]` Milestone 2, verified (real Gate 3) |
| F6 | B4 | `[x]` Milestone 2, verified (rework loop) |
| F8 | none | |
| F7 | G2 | built in this milestone, before F7 |
| F5 part 1 | B3, G2 | both done (I2, I3 are only needed for part 2, Milestone 6) |

### Items summary

| ID | Problem fixed | Test name(s) verifying the fix | Status |
|---|---|---|---|
| **G2** | `App.jsx` 868 → 375 lines, `CodeReview.jsx` 981 → 148, `SpecsDesignView.jsx` 868 → 107. New focused files: `components/layout/*` (header, menus, tabs, footer), `components/code-review/*` (bar, tabs, diff, dialogs, two side columns, highlighter), `components/specs/*` (markdown blocks, design cards, gate badge, panels, review notes), `components/{GateBanner,Dialog,NewRunDialog}.jsx`, `lib/{gate,diff,markdown}.js`, `hooks/*`. `OverviewDashboardView.jsx` was also over 400 after the split rules were applied, so its status card moved to `RunStatusCard.jsx`. Largest component file now: 375 lines. | `src/milestone4.test.jsx::no React component file is longer than 400 lines (G2)` (reads every `.jsx` source); all earlier dashboard tests still pass | Verified |
| **F4** | One gate banner under the header on every page: "Gate N of 3: …", "Waiting for: role", "You are: role (name)", the only Approve / Request changes buttons, and an "Open the …" link to the page where that gate is reviewed (Gate 2 opens Specs on the Design sub-page). Rules live in one place, `lib/gate.js` `gateView()`, mirroring `backend/src/runs/machine.js`: wrong role disables both buttons (Admin may act for any role); the requester at Gate 3 cannot approve but can request changes; B7 evidence still blocks Approve. The duplicate Approve buttons in the header, the Overview card and the Code Review side panel were removed. **Backend:** `setPhase` clears the time of a step that becomes active or pending again, so a step sent back for rework no longer shows its old completion time. | `src/milestone4.test.jsx::every page shows which gate is active, who must act, who you are, and the actions (F4)`, `::the banner names Gate 1 and Gate 2 the same way`, `::approving from the banner tells the server which gate the reviewer saw`, `::the wrong role sees Approve and Request changes disabled, with the reason`, `::an Admin may act for any gate role`, `::the person who asked for the work cannot give the final approval, but can request changes`, `::code changed after the last test run: Approve is disabled in the banner`, `::while the agent works the banner says so and offers no decision`, `::a finished run says so in the banner`, `::the banner opens the page to review for the current gate`, `::a double click on Approve sends one decision`; `src/lib/gate.test.js::Gate 1: a Planner may decide, an Engineer may not`, `::an Admin who asked for the work still cannot give the final approval`; `backend/test/state-machine.test.js::F4: a step sent back for rework does not keep its old completion time` | Verified |
| **F6** | `ReworkModal` (on the shared `Dialog`): Gate 3 offers Code or Design; Gates 1 and 2 state their one fixed target. Only comments of this gate's phase written after the gate's last decision (`gN.rejected` or `gN.approved` in the audit chain) are listed and sent, so old rounds and other steps are never re-sent; a comment with no readable time is kept and shown, not dropped. The window mounts fresh on every open (empty box after sending) and stays open with the text kept when the server refuses. | `src/milestone4.test.jsx::only this step's new comments are listed and sent, never older rounds or other steps (F6)`, `::at Gates 1 and 2 the window says where the work goes back to`, `::at Gate 3 the reviewer chooses Code or Design`, `::the feedback box is empty again after sending`, `::if the server refuses, the window stays open and keeps what was typed`, `::clicking outside the rework window does not throw away typed guidance`; `src/lib/gate.test.js::a gate revisited after being approved does not re-send the notes of the round it approved`, `::a comment without a readable time is kept and shown` | Verified |
| **F8** | `connectRealtime` retries after 1, 2, 4, 8, 16, 30, 30 … s, resets to 1 s after a good connection, and calls `onReconnect` whenever a connection opens after a failed or dropped one (also when the API was down at page load). The app reloads through a debounced call (250 ms, at most every 1 s under a steady stream), cancelled on sign-out. Every reload is numbered and an older answer that arrives late is dropped. A failed reload keeps the last good data on screen with "API offline". | `src/api.test.js::each failed reconnect waits twice as long, up to 30 seconds (F8)`, `::a good connection resets the wait, and only a reconnect (not the first connect) asks for a reload`, `::if the server was down when the page opened, the first successful connection also reloads`, `::after stop() nothing reconnects`; `src/hooks/useDebouncedCallback.test.jsx::a steady stream of calls still runs at least every maxWait`; `src/milestone4.test.jsx::a burst of live events reloads the runs once, not once per event (F8)`, `::after the live connection comes back, the runs are reloaded once to catch up`, `::a failed reload keeps the last good data and the open rework window`, `::an older reload that answers late never overwrites a newer one`, `::signing out right after a live event does not show a false "session expired"` | Verified |
| **F7** | Shared `Dialog`: `role="dialog"`, `aria-modal`, named; focus moves in (a `data-autofocus` field first), Tab / Shift+Tab stay inside, Esc closes, focus returns to the opener. Used by Request changes, New Run, Quick Open and Full view. Header popups close with Esc and are plain disclosure buttons (no half-built ARIA menu roles). Line comment buttons are always visible (faint until hover or keyboard focus) and in the tab order; removed and added lines with the same number get distinct labels and their own comment box; placeholder lines get no button. Open-file tabs are real buttons; every icon-only button has a name. `select-none` removed from the app shell (kept only on line numbers and decorative tree glyphs, so copied code is clean). ⌘P does not open behind another dialog. | `src/milestone4.test.jsx::dialogs take focus, keep Tab inside, close with Esc and give focus back (F7)`, `::the New Run dialog closes with Esc`, `::the Code Review dialogs (quick open, full view) close with Esc`, `::every button on every page, and in the dialogs, has an accessible name`, `::line comment buttons are always reachable by keyboard, not only on mouse hover`, `::run IDs, hashes and code can be selected and copied`, `::a dialog with an autofocus field still gives focus back to its opener on Esc`, `::Shift+Tab from the dialog itself stays inside the dialog`, `::Cmd+P does not open the file finder behind another dialog`, `::header popups are plain disclosure buttons`, `::the New Run dialog opens with the cursor in the Brief field`, `::a removed and an added line with the same number have their own comment buttons`, `::a run with no code changes offers no comment button on the placeholder line` | Verified |
| **F5 (part 1)** | The Code Review page is three columns: left, the requirements (with the Gate 1 badge) and the test results (outcome, counts, every test marked new or existing); middle, the open-file tabs and diff; right, the design (Gate 2 badge, file plan, threat model, other sections) and the changed-files list, which opens a file in the diff. Empty states say so. The tabs follow the run when a rework replaces its files. | `src/milestone4.test.jsx::Gate 3 shows the approved requirements, the code changes and the approved design together (F5)`, `::the Gate 3 columns say so when there is nothing approved to show`, `::when a rework replaces the changed files, the tabs follow the new files`, `::Code Review never invents a repository or branch name` | Verified |

### Test-first evidence (T1)

The user asked to see this report before any commit, so RED/GREEN evidence is kept here instead of checkpoint commits.

| Round | RED (before the fix) | GREEN (after) |
|---|---|---|
| Milestone items | Backend: `F4` test failed (`actual: 'Nov 14, 08:24 UTC', expected: null`). Dashboard: **34 failed / 13 passed** of 47: no "Gate status" region, no dialogs, `select-none` on the root, `opacity-0` comment buttons, `[['/src/App.jsx', 869], …]` over 400 lines, 7 run-list reloads instead of 3 for a burst, no backoff (`expected 1 to be 2`), no three-column regions. | 47/47, backend 1/1 |
| ECC code-reviewer findings | 5 failed: revisited gate re-sent old notes (`['old-design','new-design']`), no-time comment dropped, no catch-up when the API was down at load, backdrop click discarded guidance, invented `commerce-core` / `main`. | 55/55 |
| ECC react-reviewer findings | 9 failed: focus not returned after an autofocus dialog (`<body>`), Shift+Tab escaped from the dialog itself, a failed reload unmounted the rework window, a late old reload put the banner back to Gate 3, a false "session expired" after sign-out, a double click sent 2 decisions, ⌘P opened behind a dialog, `role="menu"` present, stale tabs after files were replaced. | 64/64 |
| Live browser check findings | 3 failed: New Run focus landed on Close (StrictMode double effect undid `autoFocus`), duplicate "Comment on line 15" labels (and one click opened two boxes), a comment button on the "No code changes" placeholder. | 67/67 |

Guard tests that passed before any fix (they pin behaviour that was already right): `after stop() nothing reconnects`, `Gate 1: a Planner may decide, an Engineer may not`, `an Admin who asked for the work still cannot give the final approval`, `a steady stream of calls still runs at least every maxWait`.

Order note: the shared `Dialog` (F7) and the Gate 3 columns (F5) were written while splitting `CodeReview.jsx` / `App.jsx` (G2), so the extracted dialogs and panels were not written twice. Their RED tests were already in place and failing before any of it.

Test corrections made while going GREEN (the code was not changed for these):
- `App.test.jsx`: the existing approve / rework tests now use the banner, and the two B7 tests expect **one** Approve button instead of two (header + Overview), because a single place to decide is the point of F4. The harness moved to `src/test/app-harness.jsx`, shared with the new tests.
- The hash check used 12 characters; the Audit page shows hashes as first 8 … last 6, so it now looks for 8.
- The late-reload test first counted calls, but StrictMode loads twice at start; it now switches on a phase instead.
- The New Run focus test now focuses the button before clicking (a real click does, `fireEvent.click` does not); the placeholder test reads the region text (the highlighter splits it into spans).

### "Done when" acceptance verification

| # | Criterion | Automated proof | Live proof (browser) |
|---|---|---|---|
| 1 | On any page a reviewer sees within 5 seconds which gate, who must act, what to click | banner tests on all 5 pages; wrong-role, requester, Admin, agent-working, done | Banner read "Gate 3 of 3: Code review · Waiting for: Engineer · You are: Engineer (Eli Engineer)" with Approve Gate 3 / Request changes on Overview, Specs and Code Review; as Pat (Planner) at Gate 2 both buttons disabled with "Only an Engineer can decide Gate 2. You are signed in as Planner. Approve and Request changes are disabled." |
| 2 | Gate 3 shows requirements, design and diff on one screen | `Gate 3 shows the approved requirements, the code changes and the approved design together (F5)` | Screenshot at 1600 px: left "Requirements · Approved by Planner" (AC-1…AC-4, 4 tests marked Existing/New), middle diff, right "Design · Approved by Engineer" (file plan, threat model, 6 changed files) |
| 3 | No component file longer than about 400 lines | G2 test over every `.jsx` | Largest: `App.jsx` 375 lines |
| 4 | All dialogs close with Esc, comment buttons keyboard-reachable, text selectable | F7 tests above | Real keys: Esc closed Request changes and New Run and returned focus to their buttons; Shift+Tab from Close went to "Send Feedback to Agent", Tab wrapped back; focused "Comment on line 13" + Enter opened the box, typed, saved ("Review comment recorded"); `getSelection()` over the code line returned `class RateLimiter:` and over the header `RUN-0427` |

### Review findings (ECC code-reviewer and ECC react-reviewer)

Code reviewer: 0 critical, 0 high, 2 medium, 6 low, plus test gaps. React reviewer: 0 critical, 1 high, 5 medium, 7 low. Several overlap.

| Finding | Result |
|---|---|
| React H1: focus not restored after a dialog with an autofocus field | **Fixed** (opener read on first render). Test added. |
| Code M1 / React L9: no catch-up reload when the API was down at page load | **Fixed** (`onReconnect` after any failed or dropped connection). Test added. |
| Code M2 / React M5: a revisited gate re-sent notes from the round it approved | **Fixed** (round starts at the gate's last approve or reject). Test added. |
| React M2: one failed reload wiped the runs and the open rework window | **Fixed** (keep last good data, show "API offline"). Test added. |
| React M3: an older reload answering late overwrote a newer one | **Fixed** (numbered reloads). Test added. |
| React M4: debounced reload after sign-out showed a false "session expired" | **Fixed** (cancel on sign-out, ignore expiry when signed out). Test added. |
| React M6: double click sent two decisions; toasts cleared each other | **Fixed** (buttons wait while a decision is in flight; one toast timer). Test added. |
| Code L3: a comment with no time was silently dropped after a rework | **Fixed** (kept and shown). Test added. |
| Code L4: Code Review invented `commerce-core` / `main` / `HEAD` | **Fixed** ("Unknown repository" / "Unknown branch", fake branch row removed). Test added. |
| Code L5: dead `approvalBlockReason` re-export in `App.jsx` | **Fixed** (removed). |
| Code L7: review-notes hint promised every note is sent | **Fixed** (says notes go with this phase's gate). |
| Code L8 / React L7: backdrop click discarded typed text; Shift+Tab from the dialog escaped; Esc during sending | **Fixed** (backdrop ignored while the rework box has text; trap covers the dialog itself; Esc ignored while sending). Tests added for the first two. |
| React L8: ⌘P opened the finder behind another dialog | **Fixed.** Test added. |
| React L10: `role="menu"` without menu keyboard behaviour | **Fixed** (plain disclosure buttons with `aria-expanded`). Test added. |
| React L12: tabs went stale when a rework replaced files with the same count | **Fixed** (effect follows the file paths). Test added. |
| Code L6: Overview status card still words gate state itself (parallel to `gateView`) | **Not changed.** It only describes the run; all decisions are in the banner. Left as a small duplication. |
| React L11: "Open the design" while already on Specs remounts it and drops an unposted note draft | **Not fixed (leftover).** |
| React L13: the Gate 3 side columns are hidden below the `lg` breakpoint | **Not fixed (leftover).** Phones and narrow windows see the diff only; Specs and Test Results still have the same content. |
| React: no ESLint config, so `react-hooks` rules are not enforced | **Noted.** Not set up in this milestone. |

### Automated test suite totals (final)

| Test suite | Result | Details |
|---|---|---|
| **Python (`cd agents && .venv/bin/pytest`)** | **293 passed, 0 failed** | No Python code changed in this milestone. |
| **Node, in-memory (`cd backend && npm test`)** | **150 passed, 0 failed, 7 skipped** | The 7 skipped need real Postgres |
| **Node, real Postgres (`npm run test:pg`, with `--experimental-test-coverage`)** | **157 passed, 0 failed** | +1 (F4 step times). All files 96.73% lines / 89.47% branches. |
| **Dashboard (`npm test`, Vitest)** | **67 passed, 0 failed** (6 files) | `App.test.jsx` 15, `milestone4.test.jsx` 40, `api.test.js` 4, `lib/gate.test.js` 4, `SpecsDesignView.test.jsx` 3, `useDebouncedCallback.test.jsx` 1 |
| **Frontend build (`npm run build`)** | **Built cleanly** | 1,932 modules |

### Live check (ECC Chrome DevTools, real Chrome)

A throwaway stack: backend on `:4041` with its own database (`gatekeep_m4_live`, seeded) and audit key, Vite on `:5182`, users `eli` (Engineer), `pat` (Planner), `ada` (Admin), and a robot token. All of it was stopped and the database dropped afterwards. DevTools was first blocked by an old automation Chrome holding its profile; the user freed it.

| Check | Observed in the browser |
|---|---|
| Banner + Gate 3 layout (RUN-0427, as eli) | As in "Done when" 1 and 2 above. |
| Keyboard comment | Focused "Comment on line 13", Enter, typed, saved through Enter on "Save comment". |
| Request changes at Gate 3 | Dialog named "Request changes", `aria-modal`, focus inside; listed exactly the one new comment; Code preselected. Esc closed it, focus back on "Request changes". Reopened, picked Design, typed guidance, sent: banner became "Agent working: Design · Waiting for: Agent", no decision buttons. |
| Audit entry and step times (API read-back) | `g3.rejected` by `eli`, `to: design`, feedback = that one comment + the guidance. Steps: `design:active:-`, `g2:pending:-`, `code:pending:-`, `g3:rejected:Nov 14, 08:52 UTC` (old times cleared, F4). |
| Live update | Robot `submit_design` via the API: the open page switched to "Gate 2 of 3: Design review" with no reload. "Open the design" opened Specs on Phase 2. Request changes at Gate 2: "Sends the work back to: Design", no radios, 0 comments (the Gate 3 code note was not re-sent). |
| Wrong role | Signed out (no false "session expired"), in as `pat`: both buttons disabled with the reason in the tooltip and the banner. |
| Requester | `eli` created RUN-1003, driven to Gate 3 through the API (robot token, `pat` approved Gate 1, test run + review with a fingerprint). The server answered `403 requester` to eli's approve. In the browser as eli: Approve disabled, "You asked for this work, so someone else must give the final approval. Approve is disabled.", Request changes enabled. |
| New Run dialog | After the fix: cursor in Brief; Esc closed it and focus returned to "New run". |
| F8 reconnect | API stopped for ~20 s: ticket requests at 15.0 s, 17.0, 21.0, 29.0, 45.0 (+1, +2, +4, +8, +16 s); the one after the restart succeeded and exactly one `/runs` reload followed at 45.3 s. Bursts of live events after each action caused one extra reload each. |
| Console | Only `ERR_CONNECTION_REFUSED` ×4 during the deliberate outage. |

**Bugs found in the browser check and fixed (test first):** New Run focus landed on Close instead of Brief; removed/added lines with the same number shared a comment label and one click opened two boxes; the "No code changes" placeholder had a comment button. See the T1 table.

### Known leftovers (not blocking)

- React L11 and L13 above (Specs draft lost on the banner link while already on Specs; Gate 3 columns desktop-only).
- Seeded demo runs have a requester name but no user id, so the server does not apply the requester rule to them while the banner (comparing usernames) does. The banner is stricter there, never looser.
- The faint comment button gets full opacity on `:focus-visible`; a focus set by script kept it faint (0.3) in Chrome. Keyboard Tab was not separately timed in the live check.
- No ESLint config in the repo.
- `agents/tests/test_agent_context.py` had an uncommitted change before this milestone began (freeze marker cleanup); it was left untouched.
