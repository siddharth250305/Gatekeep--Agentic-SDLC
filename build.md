# Building LogScrub with GateKeep

What we're doing, why, what has happened so far, and what comes next.

*Last updated: 2026-10-19. Status: run 1 (`RUN-1004`) is **done and shipped** (commit `ba402f0`, 131 tests passing, audit chain valid). Next: run 2.*

---

## 1. The big idea in one paragraph

GateKeep is a product that lets an AI write software **only under human control**: the AI does the work in phases, and a human must approve each phase before the next one starts. Everything is written to a log that can't be quietly edited. To find out whether GateKeep really works, we are **using it to build a real, small tool**, and writing down everything that goes wrong along the way. That tool is **LogScrub**.

## 2. What LogScrub is

A command-line tool that hides personal data in log files.

**The problem it solves:** developers often copy log files into support tickets, emails or AI chats. Those logs contain customers' emails, phone numbers, card numbers and IP addresses. Sharing them is a privacy leak and, under GDPR, can be reported as one.

**What it does:**

```
$ python -m logscrub samples/app.log
```

Input:
```
2026-10-18T09:12:03Z INFO login ok user=jane.doe@example.com ip=203.0.113.7
2026-10-18T09:12:09Z INFO paid card=4242 4242 4242 4242 phone=+49 151 23456789
```

Output:
```
2026-10-18T09:12:03Z INFO login ok user=[EMAIL] ip=[IP]
2026-10-18T09:12:09Z INFO paid card=[CARD] phone=[PHONE]
logscrub: email=1 phone=1 card=1 ip=1      <- summary, printed separately
```

**Why it's a good test project for GateKeep:**

- **It needs human judgment.** Is `1234567812345670` a card number or an order ID? Is `1.2.3.4` an IP address or a version number? The AI can't know; a human has to decide. That is exactly what GateKeep's approval gates are for.
- **It's easy to test.** Each detector either finds the data or it doesn't, so the automated tests show clearly whether the code works.
- **The audit log matters.** For a privacy tool, a compliance reviewer will ask *"who decided these rules, and when?"* GateKeep is supposed to answer that.

## 3. The pieces and how they connect

```
 You (the human reviewer)
   │  approve / reject in the dashboard (localhost:5180)
   ▼
 GateKeep backend (localhost:4040) ── stores runs, phases, test results, audit log (Postgres)
   ▲
   │  GateKeep tools over MCP (read_file, write_file, run_tests, submit_requirements, ...)
   │
 Claude (the AI developer) ── can ONLY touch the code through GateKeep's tools
   │
   ▼
 Workspace: agents/workspaces/RUN-1004   (a copy of the LogScrub code for this run)
   │
   ▼
 Docker sandbox ── runs the tests in isolation (no network, read-only, 30 s limit)
```

| Piece | Where | What it is |
|---|---|---|
| LogScrub "remote" | `~/projects/logscrub.git` | The main copy of the LogScrub code, like a private GitHub repo on your laptop. No login needed. |
| Run workspace | `agents/workspaces/RUN-XXXX` | A copy of the code for one run. Claude works here. |
| Client folder | `~/gk-client/` | Where you start Claude from. It holds the MCP connection settings (`.mcp.json`), the rules for Claude (`CLAUDE.md`) and the `gk` helper script. |
| `gk` script | `~/gk-client/gk` | Shortcuts for the manual steps (see section 5). |

**Why Claude goes through MCP:** you have no API credits, so GateKeep's built-in AI agents (which call Gemini or Claude through an API) can't do the work. Instead, Claude itself is the developer, and connects to GateKeep through MCP. GateKeep decides which tools Claude may use in each phase; for example, writing files is not allowed during the requirements phase.

## 4. How one run works (the flow)

Every feature is one **run**. A run moves through these phases:

```
 1. Requirements ──► GATE 1 ──► 2. Design ──► GATE 2 ──► 3. Code + tests ──► FINAL GATE ──► done
    (Claude)        (you)        (Claude)      (you)       (Claude)            (you)
```

| Phase | Who | What happens |
|---|---|---|
| Requirements | Claude | Reads the code and writes what to build as user stories, including **questions** about unclear cases. |
| Gate 1 | You (Planner) | Check the requirements and answer the questions. Approve or reject. |
| Design | Claude | Plans which files and functions to write. |
| Gate 2 | You (Engineer) | Check the plan. Approve or reject. |
| Code | Claude | Writes code and tests, runs the tests in the Docker sandbox, then asks for approval. |
| Final gate | You | Review the actual code changes and test results. Approve. |
| Ship | You | Save the code to the main repo so the next run builds on it. |

Claude **stops and waits** after each submission. It cannot approve its own work. That is the core promise of GateKeep.

## 5. Your manual steps for each run

```bash
# 1. Create the run in the dashboard (+ New run): write the brief, set repo = ~/projects/logscrub.git.
#    Note the run ID (e.g. RUN-1005). Do NOT click "Run pipeline".

# 2. Copy the code into the run's workspace
cd ~/gk-client
./gk prepare RUN-1005

# 3. Start Claude, locked to GateKeep tools only
./gk start
#    Then tell it: "Work on GateKeep run RUN-1005 ..." (it stops after requirements)

# 4. Gate 1: read the requirements in the dashboard, answer Claude's questions IN THE CHAT, approve.
# 5. Tell Claude to continue -> it submits a design. Gate 2: review, approve.
# 6. Tell Claude to continue -> it writes code and runs tests.

# 7. Review the code yourself (shows every change, runs the tests, runs the demo)
./gk review RUN-1005

# 8. Final approval, check the audit log, save the code
./gk finish RUN-1005
./gk verify RUN-1005
./gk ship RUN-1005 "short description of the change"
```

| `gk` command | What it does |
|---|---|
| `start` | Starts Claude Code with only GateKeep's tools allowed (no direct file or shell access). |
| `prepare RUN` | Copies the latest LogScrub code into the run's workspace. |
| `review RUN` | Shows every change, including new files, runs the tests and runs the demo on `samples/app.log`. |
| `finish RUN` | Gives the final approval. **Temporary workaround**, because the dashboard button fails (see blocker 1). |
| `verify RUN` | Checks that the audit log hasn't been tampered with. |
| `ship RUN "msg"` | Commits the work (leaving out Python cache files), pushes it to `~/projects/logscrub.git`, then runs `record`. |
| `record RUN` | Shows the shipped files, diff and commit on the run's dashboard page and adds a `code.shipped` audit event. Safe to run again. |

## 6. The plan: 5 runs, each testing a different part of GateKeep

| Run | Feature added to LogScrub | What it tests in GateKeep |
|---|---|---|
| **1** (now) | Detect and mask email, phone, card (with checksum), IPv4; command-line tool + summary | The full flow end to end |
| 2 | IBAN detection + a policy file (mask / keep last 4 / drop line) | **Rejection and rework:** you reject the first requirements on purpose |
| 3 | Detect leaked AWS keys, GitHub tokens, private keys | **A known limitation:** GateKeep hides secrets when Claude reads files, so Claude may not see its own test data |
| 4 | Consistent fake names (same email → same token, using a key from an env var) | **Sensitive-file rules:** `.env` and `secrets.*` are blocked |
| 5 | nginx log support, with a sample log containing a hidden prompt injection | **Prompt-injection resistance** + the 30-second sandbox time limit |

## 7. What happened in run 1 (`RUN-1004`), step by step

### Step 1: setup
- Created the LogScrub starter repo (`seed` commit `925fe13`): an almost empty package, one smoke test, a README and `samples/app.log`.
- The sample log contains **deliberate traps** for you to decide at Gate 1:

| Value in the log | The trap |
|---|---|
| `4242 4242 4242 4242` | A real card format with spaces. Must be masked. |
| `order=1234567812345678` | Fails the card checksum (Luhn), so it's clearly an order ID. |
| `order=1234567812345670` | **Passes** the checksum but is labelled as an order. Card or not? |
| `version 1.2.3.4` | A version number that looks like an IP address. |

### Step 2: first problem, "Workspace not found"
Claude couldn't read the code because the run's workspace hadn't been created (`./gk prepare` was skipped). I created it. **Lesson:** GateKeep's MCP mode has no tool to fetch the code, so this step is manual. *(Friction item.)*

### Step 3: requirements and Gate 1
Claude wrote the requirements and listed **11 open questions**, including the card/order and version/IP traps. Good behaviour: it noticed the traps itself. Gates 1 and 2 were approved.

### Step 4: code, round 1
Claude wrote 8 files (4 code, 4 test files) and ran 60 tests in the sandbox: **all passed.** But the demo showed problems:

```
WARN order=[CARD] retry           <- order ID wrongly masked as a card
INFO app version [IP] started     <- version number wrongly masked as an IP
"call me on 0151 23456789"        <- phone number NOT masked (a real leak)
```

**Why:** your answers to Claude's questions never reached it. Clicking *Approve* at Gate 1 only records "approved"; it can't carry decisions. The audit log confirms that the approvals have no notes attached. Claude had to guess, and said so in its report. **This is the most important finding so far.**

### Step 5: code, round 2 (reviewer decisions sent in chat)
You sent three decisions:
1. **Cards:** must pass the checksum **and** start with a real card prefix (Visa 4, Mastercard 51-55/2221-2720, Amex 34/37, Discover 6011/65).
2. **IPs:** don't mask a number that comes right after the word "version" or "v".
3. **Phones:** also mask national numbers starting with 0 (9-13 digits, spaces or dashes allowed).

Claude changed only `logscrub/detectors.py` plus the tests: **114 tests pass.** The sample log is now correct:

```
2026-10-18T09:12:03Z INFO login ok user=[EMAIL] ip=[IP]
2026-10-18T09:12:09Z INFO paid card=[CARD] phone=[PHONE]
2026-10-18T09:13:44Z WARN order=1234567812345678 failed
2026-10-18T09:14:02Z WARN order=1234567812345670 retry
2026-10-18T09:15:10Z INFO app version 1.2.3.4 started
logscrub: email=1 phone=1 card=1 ip=1
```

### Step 6: my independent check (extra test inputs)

| Input | Result | Verdict |
|---|---|---|
| `0151 23456789`, `030-1234567`, `+1 (415) 555-0132` | masked | ✅ |
| Visa `4111 1111 1111 1111`, Amex `3782 822463 10005` | masked | ✅ |
| `version 1.2.3.4 from 10.0.0.1` | only `10.0.0.1` masked | ✅ |
| `count=123456789`, timestamps, `port 8080` | left alone | ✅ |
| `0049 151 23456789` | **not masked** | ❌ leak (common German format) |
| `0151/23456789` | **not masked** | ❌ leak |
| `ver 1.2.3.4`, `000123456` | masked by mistake | ⚠️ harmless noise |

I also found that running the tests locally had created 10 Python cache files (`.pyc`) that `ship` would have committed. I deleted them and fixed `gk` so it can't happen again.

### Step 7: round 3, then shipped
Claude fixed the `0049 …` and `0151/…` phone formats (131 tests). You ran `review`, `finish`, `verify` and `ship`. The code is now in `~/projects/logscrub.git` as commit `ba402f0`.

### Step 8: independent check after shipping
You approved without reading all 956 lines, which is normal: nobody can review every line of AI code. So I checked the shipped commit independently:

| Check | Result |
|---|---|
| Shipped code = what Claude wrote in the workspace | ✅ identical |
| Tests in the Docker sandbox | ✅ 131 passed, 0 failed |
| 7 lines of data that **must** be masked (emails, cards in 4 formats, IPs incl. `ip:port`, 6 phone formats, JSON) | ✅ all masked |
| 8 lines that must **not** be touched (timestamps, order IDs, versions, browser user agents, UUIDs, hashes, prices, invalid IPs) | ✅ all untouched |
| Speed: 20 MB log, 300,000 lines + one 2 MB line | ✅ 5 seconds |
| Broken UTF-8, Windows line endings, missing file | ✅ handled (exit code 1 for a missing file) |
| Audit chain | ✅ valid |

**Known gaps (not bugs, outside the agreed rules):** `4242.4242.4242.4242` (dots), `151 23456789` (no leading 0), `(030) 1234567` (brackets) are not masked; `ver 1.2.3.4` and `id=000123456` are masked by mistake. Good candidates for run 2's policy file.

### Step 9: making the result visible in the dashboard
The dashboard didn't show the real code. I fixed that (see problems 3, 10 and 11) and recorded run 1 with the new `./gk record RUN-1004` command. The run's page now shows its 8 real files with full diffs, the summary (`8 files changed`, `131/131 tests passed`), and a `code.shipped` audit event with the commit.

## 8. How to review without reading every line

You don't need to understand every line. Review **behaviour**, not code:

1. **Look at the demo output** in `./gk review` (the sample log before and after). Does every personal value get masked, and does everything else stay the same?
2. **Try your own tricky lines.** Put them in a file and run `python -m logscrub yourfile.log` in the workspace. One surprising result tells you more than 100 lines of code.
3. **Read the test names, not the code**, e.g. `test_order_id_with_valid_luhn_is_not_a_card`. Each one is a rule Claude says the tool follows.
4. **Ask Claude for a behaviour table** before approving: "List 20 example input lines and the exact output, including the edge cases you're unsure about."
5. **Read only the policy part of the code** (here `is_card`, `has_card_prefix`, `is_ip`, the phone limits at the top of `detectors.py`). That's where your decisions live.

This is a real product insight: **GateKeep's final gate shows code, but a reviewer needs behaviour.** A good next feature would be for the final gate to show example inputs and outputs next to the diff.

## 9. What you did in run 1 (for reference)

**Option A (what you did): one more short round to fix the two phone leaks.** Paste this into Claude:

```
Reviewer decisions, round 2:
1. Phones starting with 00 (international prefix, e.g. "0049 151 23456789") must be masked; allow up to 15 digits for numbers starting with 00.
2. Also accept "/" as a separator in national numbers (e.g. "0151/23456789").
3. Leave "ver 1.2.3.4" and zero-padded IDs as they are; those false positives are accepted.
Add tests for 1 and 2, re-run the tests in the sandbox, and request approval again.
```

**Option B:** ship as is and record the two leaks as known issues for run 2.

Either way, finish with:
```bash
cd ~/gk-client
./gk review RUN-1004
./gk finish RUN-1004
./gk verify RUN-1004
./gk ship RUN-1004 "logscrub v1: PII masking"
```

## 10. What we've learned about GateKeep so far (the friction log)

This list is the real output of the exercise.

### Works well ✅
- **Gates hold.** Claude stopped after every submission and never approved its own work.
- **Phase rules are enforced.** Claude can't write files during requirements, can't read `.env`, and can't escape the workspace (`../`, absolute paths and symlinks are blocked).
- **Sandbox tests are real.** The tests ran in Docker with no network, and the results show up in GateKeep.
- **The audit log is tamper-evident.** The hash chain verifies.
- **The agent was honest.** Claude raised unclear cases and flagged its own wrong guesses instead of hiding them.

### Problems found ❌

| # | Problem | Why it matters | Severity |
|---|---|---|---|
| 1 | **Approvals can't carry decisions.** Answers to Claude's questions aren't stored or sent to Claude. | Claude guessed wrong, which led to masked order IDs and leaked phone numbers. The audit log can't show who decided the rules. | 🔴 High |
| 2 | **The final approval button fails** ("gate is assigned to Agent"). | You can't finish a run from the dashboard; `./gk finish` is a workaround. | 🔴 High |
| 3 | **Reviewers couldn't see the code in GateKeep.** `get_diff` missed new files, and nothing sent the diff to the dashboard. | **✅ Fixed:** `get_diff` now includes new files, and Claude's approval request now sends every changed file and its diff to the dashboard. | 🔴 → ✅ |
| 4 | **Anyone can approve any gate** if the request leaves out the role. | The "right person approves" rule can be skipped. | 🔴 High |
| 5 | **Rejecting doesn't work properly.** The run becomes "rejected", Claude doesn't see the feedback, and it doesn't return to the previous phase. | Run 2 depends on this. | 🔴 High (blocks run 2) |
| 6 | No tool to fetch the code in MCP mode; `./gk prepare` is manual. | An easy step to forget (it happened in run 1). | 🟡 Medium |
| 7 | Blocks inside the Claude app don't show up in GateKeep. Some writes were briefly blocked on Claude's side and never reached GateKeep's log. | The audit log doesn't show everything the agent tried. | 🟡 Medium |
| 8 | Run 1 was driven from the **Claude desktop app** (`client: claude-desktop` in the log), not `./gk start`. | The desktop app isn't limited to GateKeep's tools, so the lockdown wasn't tested. Use `./gk start` for run 2. | 🟡 Medium |
| 9 | The dashboard test log can show another run's results if the wrong run is selected. | Confusing: you saw RUN-1003's log while working on RUN-1004. | 🟢 Low |
| 10 | **The Code Review screen showed made-up demo code** (`webhook.py`, a fake "Line 42" comment) for every run, and only one real file at most. | A reviewer could approve after looking at code that isn't the real code. | 🔴 → ✅ Fixed: runs with recorded files show only their own files, every file's diff, and "NEW" markers |
| 11 | Claude's approval summary was stored as plain text, so the Overview card was blank. | The reviewer saw no summary. | 🟡 → ✅ Fixed |
| 12 | Approving was done without really reviewing; reading 956 lines isn't realistic. | The gate is only as good as the review. GateKeep should show behaviour (examples), not just code. See section 8. | 🔴 Product gap |

**Before run 2:** problems 1, 2, 4 and 5 should be fixed in GateKeep (3, 10 and 11 are fixed). Run 2 is built around rejecting work and sending feedback, which doesn't work yet.

## 11. Glossary

| Word | Meaning |
|---|---|
| **Run** | One feature going through GateKeep, from brief to shipped code. |
| **Brief** | The short description of what you want built. |
| **Gate** | A checkpoint where a human must approve before work continues. |
| **MCP** | Model Context Protocol, the way Claude connects to outside tools (here, GateKeep's tools). |
| **Workspace** | The folder with this run's copy of the code. |
| **Sandbox** | An isolated Docker container where the tests run, with no network and no access to your files. |
| **Audit log** | A list of everything that happened in a run. Each entry is linked to the previous one by a hash, so editing history breaks the chain and `verify` detects it. |
| **Luhn checksum** | A simple math check that every real card number passes. Random numbers pass about 1 in 10 times, which is why `1234567812345670` is a trap. |
| **False positive** | Masking something that isn't personal data (annoying). |
| **Leak / false negative** | Missing real personal data (the serious failure for this tool). |
| **Bare repo** | A git repo with no working files, used as a local "remote" in place of GitHub. |
