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
