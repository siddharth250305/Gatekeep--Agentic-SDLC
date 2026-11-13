# GateKeep: Drawbacks Explained in Simple English

This document lists the problems found in GateKeep during a full code review.
It is written for someone who has **never seen the code before**.
Each problem is explained with:

- **What is wrong** (in plain words)
- **Example** (a small story showing how it goes wrong)
- **Why it matters**
- **How to fix it**
- **Where in the code** (for developers who want to look)

There is a small dictionary of technical words at the end of this file.

---

## First, what is GateKeep supposed to do?

Imagine you hire a very fast but sometimes careless robot to write code for you.
You do not want it to touch your project without permission.

GateKeep is like a **security office** between the robot (the AI agent) and your project.
The robot must pass through **three checkpoints**, and a human must say "OK" at each one:

| Step | What the robot does | Who checks it |
|---|---|---|
| 1. Requirements | Writes down *what* it will build | Human checkpoint 1 (Gate 1) |
| 2. Design | Writes down *how* it will build it (which files it will change) | Human checkpoint 2 (Gate 2) |
| 3. Coding and testing | Writes the code and runs tests in a locked box | Human checkpoint 3 (Gate 3) |

GateKeep also promises to:

- Hide secret files (passwords, keys) from the robot
- Run tests in a locked box (Docker) so the robot cannot lie about results
- Keep a diary of everything that happened that cannot be secretly edited (the audit log)

**The idea is very good.** The problem is that, right now, many of the doors in this security office are not actually locked. The sections below explain each one.

---

## The short version

| Area | Simple summary |
|---|---|
| Security | There is no login. Anyone (including the robot) can press the "Approve" button. |
| Checkpoints | The robot can skip checkpoints in some situations. Checkpoint 3 is not built properly. |
| Test results | GateKeep can say "tests passed" even when no tests ran. |
| Secrets | The robot can still read secret files through a side door. |
| Diary (audit log) | It is not as tamper-proof as the README says. |
| Dashboard | It sometimes shows fake data and fake success messages. |
| Code quality | Lots of unused code, some files are very large, some logic is duplicated. |
| README | Some claims are stronger than what the code really does. |

---

# Part 1: Security Problems

## Problem 1.1: There is no login at all

**What is wrong**
GateKeep has no username, password, or token check. The part of the system that stores the run state (the "backend server") accepts every request from anyone.

**Example**
A human reviewer is supposed to click "Approve" in the dashboard. But the robot can simply send the same message that the button sends:

```
"Please approve this run."
```

The server cannot tell if it came from the human or the robot, so it approves it. The robot just approved its own work.

**Why it matters**
This breaks the whole point of GateKeep. A checkpoint that the robot can open by itself is not a checkpoint.

**How to fix it**
- Add login for human reviewers (for example GitHub or Google sign-in).
- Give the robot a *different* key that is only allowed to do robot things (submit work, run tests), never approve.
- Save the real logged-in reviewer's name in the diary, not a name typed in a form.

**Where in the code**
`backend/src/app.js` (no login check), `backend/src/routes/runs.js` line 53 (the approve endpoint).

---

## Problem 1.2: The reviewer's name and role are just a dropdown menu

**What is wrong**
In the dashboard there is an "Acting as" menu where you pick "Planner" or "Engineer". Anyone can pick anything. The reviewer's name is also a fixed demo name written in the code.

**Example**
A junior developer who should only approve Gate 1 picks "Engineer" from the menu and approves Gate 2 too. The diary records it as approved by the fixed demo name, not by the real person.

**Why it matters**
The diary is supposed to answer "who approved this?". Right now the answer cannot be trusted.

**How to fix it**
Take the name and role from the login (see Problem 1.1), not from a menu.

**Where in the code**
`src/App.jsx` line 545 (menu), line 247 (name), `src/data/runs.js` line 4.

---

## Problem 1.3: Any website can talk to GateKeep

**What is wrong**
The backend tells web browsers "requests from any website are allowed" (this setting is called CORS `*`).

**Example**
You are running GateKeep on your laptop. You visit a random website. That website can secretly send "approve run RUN-1004" to your GateKeep, and it will work, because there is no login either.

**Why it matters**
Approvals could be triggered without you ever opening the dashboard.

**How to fix it**
Allow only the dashboard's own address (for example `http://localhost:5180`).

**Where in the code**
`backend/src/app.js` lines 13 to 19.

---

## Problem 1.4: The robot's connection point is open to the whole network

**What is wrong**
The part the robot connects to (the "MCP server") listens on every network address of the computer, not just the computer itself, and has no password.

**Example**
You run GateKeep on a laptop in a café. Someone else on the same Wi-Fi can connect and use GateKeep's tools (write files, run tests) on your runs.

**How to fix it**
Listen only on `127.0.0.1` (your own computer) by default, and require a secret token.

**Where in the code**
`agents/app/mcp/server.py` line 321.

---

## Problem 1.5: The robot can trick GateKeep into running commands on your computer

**What is wrong**
Every project has a hidden folder called `.git` that stores Git's settings. GateKeep lets the robot write into this folder. One of Git's settings can say "run this program whenever someone looks at the changes". GateKeep itself runs "look at the changes" (`git diff`) on your real computer, outside the locked box.

**Example**
1. The robot writes a Git setting that says "when showing changes, also run `my-script.sh`".
2. The robot asks GateKeep to show the changes.
3. GateKeep runs `git diff`, and Git runs `my-script.sh` on your real computer.

**Why it matters**
This is the most dangerous problem found. The locked box (Docker) is skipped completely.

**How to fix it**
- Block any file path that contains `.git`.
- Run Git with options that turn off these "run a program" settings.

**Where in the code**
`agents/app/repository/tools.py` line 54 (`write_file`), `agents/app/mcp/tools.py` lines 33 to 49 (runs `git diff`).

---

## Problem 1.6: The robot can read secret files through tests (side door)

**What is wrong**
GateKeep blocks the robot from *opening* files like `.env` (where passwords live). But the robot is allowed to *write a test* and *run it*. A test is just code, and code can open any file. GateKeep then gives the test's printed output back to the robot without hiding anything.

**Example**
The robot writes this "test":

```python
def test_hack():
    print(open(".env").read())
```

It runs the tests. The output contains all the passwords from `.env`. The robot now has them.

**Why it matters**
The README says secret files are "100% blocked". That is not true. Once the robot sees a secret, it is sent to the AI company's servers as part of the conversation.

**How to fix it**
- Remove secret files from the copy of the project before tests run.
- Hide (redact) secrets in every piece of text GateKeep sends back, including test output.

**Where in the code**
`agents/app/mcp/tools.py` around line 355 to 383 (`run_tests`).

---

## Problem 1.7: Shortcut files (symlinks) get past the secret-file block

**What is wrong**
A "symlink" is like a desktop shortcut. A file called `notes.txt` can secretly point to `.env`. GateKeep checks the *name* the robot asks for (`notes.txt`, looks fine) but not the *real file* behind it (`.env`, should be blocked).

**Example**
The project contains a shortcut `config.py` that points to `.env`. The robot asks to read `config.py`. GateKeep allows it and returns the passwords. The reviewer also confirmed that the robot can *overwrite* `.env` this way.

The code search tool is even worse: it follows shortcuts that point **outside** the project, for example to your private SSH key.

**How to fix it**
Follow the shortcut first, then check the real file name. Or simply refuse shortcuts.

**Where in the code**
`agents/app/repository/tools.py` lines 27 to 65, `agents/app/repository/retriever.py` line 52, `agents/app/repository/context.py` line 38.

---

## Problem 1.8: The GitHub password is saved inside the project copy

**What is wrong**
To download a private project, GateKeep puts your GitHub token (a password) inside the download address. Git saves that address in `.git/config`. That file is not blocked, so the robot can read it, and tests can print it.

**Example**
The robot reads `.git/config` and sees `https://ghp_abc123...@github.com/you/project.git`. It now has your GitHub password.

**How to fix it**
After downloading, replace the address with one that has no token, or pass the token in a safer way that is not saved.

**Where in the code**
`agents/app/workspace.py` lines 30 to 36.

---

## Problem 1.9: The secret-file block list is missing common secret files

**What is wrong**
GateKeep has a list of file names it blocks. Some very common secret files are not on the list.

**Not blocked today:** `.aws/credentials`, `id_ed25519` (modern SSH key), `id_ecdsa`, `.envrc`, `prod.env`, `*.tfstate`, `*.tfvars`, `.git-credentials`, `.htpasswd`, `*.p8`.

Also, the same list is written in **two different places** with a comment that says "keep these in sync". That will break one day when someone updates only one.

**How to fix it**
Add the missing names, block whole folders like `.ssh/` and `.aws/`, and keep the list in **one** place.

**Where in the code**
`agents/app/mcp/policy.py` line 34 and `agents/app/repository/security.py` line 19.

---

## Problem 1.10: Secret hiding is incomplete

**What is wrong**
GateKeep tries to hide secret values in text it sends to the robot. But:

- For private keys it hides only the first line. The rest of the key is still visible.
- The code search tool does not hide secrets at all.
- The "show changes" (diff) output does not hide secrets.
- Passwords written without quotes (like `password: hello123` in a YAML file) are not detected.

**How to fix it**
Run secret hiding on **every** piece of text that leaves GateKeep, and hide the whole private key block.

**Where in the code**
`agents/app/repository/security.py` line 30, `agents/app/repository/tools.py` line 44.

---

## Problem 1.11: The robot can reach other runs' folders

**What is wrong**
Every run gets its own folder, named after the run ID. GateKeep never checks that the run ID is a normal name. A run ID like `..` means "the folder above".

**Example**
The robot uses the run ID `..`. Now its "project folder" is actually GateKeep's own code folder. It could rewrite GateKeep's security rules.

**How to fix it**
Only accept run IDs made of letters, numbers, `-` and `_`.

**Where in the code**
`agents/app/mcp/session.py` line 53, `agents/app/mcp/tools.py` line 119.

---

# Part 2: Problems With the Three Checkpoints (Phases)

## Problem 2.1: The robot can change the run's state directly

**What is wrong**
There is one correct way to approve a checkpoint (the "decide" action). But there are also other "back doors" that let anyone set any state directly, for example "mark this run as approved" or "mark Gate 2 as approved". These back doors do not write anything in the diary.

**Example**
The robot sends "set Gate 2 to approved" through the back door. Gate 2 is now approved, no human was involved, and the diary has no record of it.

**How to fix it**
Make the "decide" action the **only** way to move between steps, and let only logged-in humans use it.

**Where in the code**
`backend/src/routes/runs.js` line 86 (phase back door), `backend/src/runs/service.js` line 157 (run status back door).

---

## Problem 2.2: Checkpoint 3 (code review) is not really built

**What is wrong**
The steps stored in the database are:

```
Requirements -> Gate 1 -> Design -> Gate 2 -> Code -> Output
```

There is **no "Gate 3" step**. The "Code" step belongs to the robot, not to a human. When Gate 2 is approved, the system says "the next person to act is: Agent". When the human then tries to approve the code, the server answers "this is assigned to Agent, not you" and refuses.

Also, when the robot says "I'm done, please review", GateKeep does not switch the run into "waiting for human" mode.

**Why it matters**
The final and most important checkpoint does not work through the normal robot path.

**How to fix it**
Add a real `g3` step with a human role (for example "Engineer"). When the robot asks for review, move the run to `g3`.

**Where in the code**
`backend/src/runs/service.js` lines 7 to 14 and line 242, `agents/app/mcp/tools.py` line 395.

---

## Problem 2.3: Rejecting work breaks the run, and can skip the design checkpoint

**What is wrong**
When a human clicks "Reject", the run simply stops. No step is "active" any more. When GateKeep cannot find an active step, it **guesses** "we must be at Requirements" and lets the robot submit requirements again.

**Example (this skips the design check)**
1. The robot's design is **rejected** at Gate 2.
2. GateKeep now thinks we are back at Requirements.
3. The robot submits requirements again. The human approves Gate 1.
4. GateKeep looks for the next unfinished step. Design is still marked "done" from before. Gate 2 is marked "rejected". So it jumps to **Code**.
5. The robot is now writing code based on a design that was **rejected**.

The same guess also lets the robot **reopen a run that was already finished and approved**.

**How to fix it**
- When work is rejected, send it back to the right step (for example, Gate 2 rejected goes back to Design).
- If no step is active, **deny everything** instead of guessing.

**Where in the code**
`agents/app/mcp/server.py` lines 59 to 69, `backend/src/runs/service.js` lines 250 to 256.

---

## Problem 2.4: The robot can change code after tests pass

**What is wrong**
During the Code step the robot can write files, run tests, write more files, and ask for review. Nothing stops it from changing files **after** the tests passed, or **after** it asked for review.

**Example**
1. The robot writes good code. Tests pass. It asks for review.
2. Before the human looks, the robot changes the code again.
3. The human approves, thinking the tests cover what they see. They do not.

The human can also approve code that was **never tested at all**.

**How to fix it**
- When the robot asks for review, **freeze** the folder (no more writes).
- Save a fingerprint (hash) of the code and of the test run. The approval should say "I approve *this exact version*".

**Where in the code**
`agents/app/mcp/policy.py` lines 66 to 70, `backend/src/runs/service.js` line 224.

---

## Problem 2.5: Nobody checks that the code matches the approved design

**What is wrong**
At Gate 2 the human approves a plan like "I will change `login.py` and `auth.py`". Later the robot can change **any** file, for example `payment.py`, and nobody notices.

**Why it matters**
The design checkpoint is only useful if the code has to follow the design.

**How to fix it**
- Store the design's file list in a structured form.
- Block writes to files that are not in the plan, or at least show a big warning at Gate 3: "These files were changed but were not in the approved design".

---

## Problem 2.6: Requirements, design, code and tests are not linked together

**What is wrong**
Requirements are just free text. There are no IDs like `REQ-1`. So there is no way to answer simple questions like:

- "Which test checks requirement 3?"
- "Which part of the code was written for requirement 2?"
- "Is any requirement not tested?"

**How to fix it**
Give each requirement an ID. Ask the design, the tests, and the code changes to mention those IDs. Show a table in the dashboard: requirement, design part, code change, test, pass or fail.

---

## Problem 2.7: The automatic pipeline throws away the AI's real design

**What is wrong**
GateKeep has a second, automatic mode (called the "LangGraph pipeline") where GateKeep runs the AI itself. In this mode, the AI writes a design, but GateKeep **ignores it** and saves a simple design built by a basic rule instead.

**Why it matters**
The human approves a design that the AI never actually wrote.

**Where in the code**
`agents/app/graph.py` lines 285 to 290 and `_build_design` at lines 169 to 180.

---

## Problem 2.8: The two modes (robot-connected and automatic) behave differently

**What is wrong**
GateKeep has two ways of working:

1. **MCP mode**: an outside robot (Claude Desktop, Cursor) connects and does the work.
2. **Pipeline mode**: GateKeep runs the AI itself step by step.

They follow different rules:

| | Pipeline mode | MCP mode |
|---|---|---|
| Can send work back after rejection | Yes | No (run just stops) |
| Gate 3 | Exists (code step, Engineer) | Broken (see 2.2) |
| Security rules (policy engine) checked | **No** | Yes |
| Works with Claude (Anthropic) | **No**, writes fake placeholder code | Yes |

Also in pipeline mode:

- The "self-heal" feature (automatically fixing failed tests) is fake. It asks the AI for a fix and then ignores the answer.
- If the pipeline program restarts, it forgets all runs (they are kept only in memory). The backend then moves the run forward on its own, but no robot does the next step, so the run gets stuck.

**How to fix it**
Decide which mode is the main product. Make both follow the same rules, or remove the unfinished one.

**Where in the code**
`agents/app/graph.py` lines 399 to 408 and 483 to 489, `agents/app/llm.py` line 194, `agents/app/main.py` line 24.

---

# Part 3: Problems With Test Results

## Problem 3.1: "Passed" is shown even when no tests ran

**What is wrong**
GateKeep decides "Passed" with one simple rule: *"if the number of failed tests is 0, it passed"*.
It does **not** check the program's real exit code, even though the README says it does.

So all of these situations are shown as **Passed**:

| Situation | What really happened | What GateKeep shows |
|---|---|---|
| Docker is not running | Nothing ran | Passed |
| The test box image is missing | Nothing ran | Passed |
| Tests took too long and were stopped | Unknown | Passed |
| There were zero tests | Nothing was tested | Passed |
| The robot asked to only *list* tests (`--collect-only`) | Nothing was tested | Passed |

**Why it matters**
Stopping fake "all tests passed" claims is one of GateKeep's main promises. Right now GateKeep can make that mistake itself.

**How to fix it**
Say "Passed" only when **all three** are true: exit code is 0, it did not time out, and at least one test ran.

**Where in the code**
`agents/app/mcp/tools.py` line 366, `agents/app/sandbox.py` lines 20 to 26.

---

## Problem 3.2: Test counts can be faked by printing text

**What is wrong**
GateKeep finds the number of passed tests by searching the output for text like "5 passed". A test can simply print `999 passed`, and GateKeep will believe it.

**How to fix it**
Ask pytest to write results into a proper file (for example JUnit XML) and read that file instead of searching text.

---

## Problem 3.3: The robot writes its own tests and chooses which tests run

**What is wrong**
The robot writes the code **and** the tests **and** picks which test file to run. It can write a weak test that always passes.

**How to fix it**
- Always run the project's existing tests too, not only the robot's new ones.
- Show the human which tests are new and which already existed.
- Do not let the robot choose the test target freely.

---

## Problem 3.4: When tests take too long, the test box keeps running

**What is wrong**
On timeout GateKeep stops waiting, but the Docker container itself keeps running in the background, using CPU and memory.

**How to fix it**
Give each container a name and force-stop it on timeout. Also add `--cap-drop ALL` for extra safety.

**Where in the code**
`agents/app/sandbox.py` lines 59 to 80.

---

# Part 4: Problems With the Diary (Audit Log)

## Problem 4.1: It is not "HMAC" as the README says

**What is wrong**
The README says the diary uses "SHA-256 HMAC". HMAC means "a fingerprint made with a **secret key**". The code actually uses plain SHA-256 **without** a secret key. The code's own comment admits this.

**Example (simple)**
Think of each diary page having a stamp made from the page content plus the previous stamp.

- **With a secret key (HMAC):** only GateKeep can make valid stamps. If someone edits a page, they cannot make a new valid stamp.
- **Without a key (what GateKeep does now):** anyone who edits a page can simply **recalculate all the stamps** using the public code, and the diary looks perfect again.

So it catches careless edits, but not a smart attacker with database access.

**How to fix it**
Use HMAC with a secret key stored outside the database. Until then, change the README to say "SHA-256 hash chain (tamper-evident)".

**Where in the code**
`backend/src/audit/chain.js` lines 7 to 9 and 43 to 45.

---

## Problem 4.2: Anyone can write fake diary entries

**What is wrong**
There is an open endpoint that adds an entry to the diary. It accepts **any name** and **any date** from the caller.

**Example**
Someone adds "Gate 2 approved by Alice, yesterday at 10:00". It gets a valid stamp. It looks completely real.

**How to fix it**
Only the server itself should write diary entries. The name comes from the login. The date comes from the server clock.

**Where in the code**
`backend/src/routes/audit.js` line 15.

---

## Problem 4.3: The "tamper test" button really damages data, and it is always on

**What is wrong**
The dashboard has a "Simulate Tamper Test" button for demos. It really changes a diary entry in the database. This endpoint has no login and is turned on in production too.

**How to fix it**
Turn it on only in demo mode (for example with an environment setting), and move the button away from the "Approve" button.

**Where in the code**
`backend/src/routes/audit.js` lines 45 to 58, `src/components/CodeReview.jsx` around line 1420.

---

## Problem 4.4: Deleting the last diary entries is not detected

**What is wrong**
The checker only checks entries that exist. If someone deletes the last 3 entries (or all of them), the diary still says "valid".

Also, the run ID is not part of the stamp, so entries copied from one run to another can look valid.

**How to fix it**
Store the latest stamp somewhere separate and check against it. Include the run ID in each stamp.

**Where in the code**
`backend/src/audit/chain.js` lines 31 to 75.

---

## Problem 4.5: Sending a number instead of text breaks the diary forever

**What is wrong**
If someone adds an entry with a number (for example `event: 123`) instead of text, the stamp is calculated on the number, but the database stores it as text `"123"`. From then on, the check always says "broken".

**How to fix it**
Check that fields are text before saving them.

---

## Problem 4.6: Two things happening at the same time can lose diary entries

**What is wrong**
Adding an entry is done in two steps (read the last one, then add a new one) without locking. If two approvals happen at the same moment, one fails. Approval itself is also several separate database steps, so if one step fails in the middle, the run can be half-updated with no diary entry.

**How to fix it**
Do these steps inside a database **transaction** with a lock, so they all succeed or all fail together.

**Where in the code**
`backend/src/audit/service.js` lines 21 to 25, `backend/src/runs/service.js` lines 211 to 260.

---

## Problem 4.7: Some actions are never recorded

**What is wrong**
- When the security rules **block** the robot, nothing is written in the diary.
- If writing to the diary fails, GateKeep ignores the error but still performs the action. So a file can be changed with no record.
- The AI model name is whatever the robot says it is. By default it is a fixed name written in the code.

**How to fix it**
Record blocked actions. If the diary write fails, cancel the action.

---

# Part 5: Problems With the Dashboard (What the Human Sees)

## Problem 5.1: The dashboard shows fake success when something fails

**What is wrong**
When the dashboard cannot reach the server, instead of showing an error it **pretends** it worked and shows "approved (demo mode)". The same happens for creating runs, saving comments, and re-running tests.

**Example**
The Wi-Fi drops for a second. The reviewer clicks Approve. The screen says "approved". The server never received it. The reviewer goes home thinking the work is approved.

**How to fix it**
Remove all "demo mode" fallbacks. Show a clear red error message instead.

**Where in the code**
`src/App.jsx` lines 262 to 277, 289, 299, 319 to 345, 354 to 367.

---

## Problem 5.2: The test results page shows made-up numbers

**What is wrong**
If there are no real test results, the page shows **hardcoded** values: "14 / 14 Passed", "4m 27s", "exit code 0", "100% assertions passing". The result card is **always green**, even if tests failed.

**Why it matters**
The reviewer cannot tell real results from fake placeholders. This is exactly the "hallucinated test results" problem GateKeep is meant to solve.

**How to fix it**
Show "No test run yet" when there is no data. Show green only for a real pass, red for a real fail. Add a line like "Ran in sandbox at 14:02 on version abc123".

**Where in the code**
`src/components/views/TestResultsView.jsx` lines 38, 50, 64, 105.

---

## Problem 5.3: The code review page contains fake code and a fake rework message

**What is wrong**
- If a run has no files, the code review page shows about 270 lines of **made-up source code** that looks real.
- The "Request rework" card always sends the same hardcoded message: "Line 42: Rate limiter key should use hashed tenant ID...", no matter what the reviewer wanted.
- Adding a single line comment **immediately rejects the whole gate**, with no confirmation.
- The "Full Source" button shows only the changed lines, not the whole file.

**How to fix it**
Remove the fake code and the hardcoded message. Saving a comment should only save a comment. Rejecting should be a separate, deliberate button.

**Where in the code**
`src/components/CodeReview.jsx` lines 39 to 304, 566 to 573, 586 to 588.

---

## Problem 5.4: At Gate 3, the reviewer cannot see what was approved before

**What is wrong**
On the code review page the reviewer sees only the code changes. They do **not** see the approved requirements or the approved design next to the code. They have to switch tabs and remember.

Also, nothing highlights files that were changed but were **not** in the approved design.

**How to fix it**
Make the Gate 3 page a three-column view:

| Left | Middle | Right |
|---|---|---|
| Requirements checklist, each with its test and pass/fail | Code changes | Approved design with a "planned vs actually changed files" table and warnings |

**Where in the code**
`src/components/CodeReview.jsx` (never reads requirements or design), `src/components/views/SpecsDesignView.jsx` lines 478 to 536.

---

## Problem 5.5: It is not clear which checkpoint you are at and what you must do

**What is wrong**
- The "Approve Gate" button is the same on every tab. It does not say *which* gate.
- The Requirements and Design page (where Gate 1 and Gate 2 happen) has no approve or reject buttons at all.
- Some places say "Awaiting Planner", others say "Gate 1". The words do not match.
- You can click Approve while acting as the wrong role. The server refuses, but the button should be disabled with an explanation.
- The dashboard remembers the last tab you were on, so when you open a run you may land on the wrong page.

**How to fix it**
Add one clear banner on every page, for example:

> **Gate 2 of 3: Design review.** Waiting for: Engineer. You are: Engineer. [Approve] [Request changes]

---

## Problem 5.6: Rework feedback cannot go to a specific step

**What is wrong**
When the reviewer asks for changes, they cannot choose "go back to Design" or "go back to Code". The feedback box also collects **all** old comments from every step and sends them again, and it is not cleared after sending.

**How to fix it**
Let the reviewer pick which step to send the work back to. Send only the comments for that step. Clear the box after sending.

**Where in the code**
`src/components/ReworkModal.jsx` lines 41 to 43.

---

## Problem 5.7: Accessibility and small usability issues

**What is wrong**
- Pop-up windows cannot be closed with the Esc key (except one) and keyboard focus is not handled.
- Comment buttons on code lines are invisible until you hover with a mouse, so keyboard users cannot reach them.
- Icon-only buttons have no text label for screen readers.
- Text selection is turned off for the whole app, so you cannot copy run IDs, hashes or code.
- When the live connection drops, missed updates are lost. Every live update reloads everything, with no delay or cancelling.

**How to fix it**
Add proper dialog and button labels, make comment buttons always reachable, allow text selection, and reload data once after reconnecting.

---

# Part 6: Messy or Unnecessary Code

## Problem 6.1: Lots of code that is never used

About **700 lines** of dashboard code are never shown anywhere:
`Sidebar`, `ApprovalChain`, `ArtifactsView`, `ApprovalsView`, `RunSummary`, `NextSteps`, `VerificationCard`, `SummaryCard`, `RepositoryContext`, `Badge`, `StatusIndicator`, `lib/status.js`.

Also unused: `backend/src/mcp_schema.sql` (never loaded) and `check_phase_transition` in `policy.py` (written but never called, so the "no skipping steps" rule is not actually used).

**Why it matters**
Unused code confuses new developers and makes reviewers think features exist when they do not.

---

## Problem 6.2: Some files are far too big

| File | Lines | Problem |
|---|---|---|
| `src/components/CodeReview.jsx` | 1555 | Contains a file explorer, diff viewer, side panel, quick-open search and 270 lines of fake data all in one file |
| `src/components/views/SpecsDesignView.jsx` | 867 | Contains its own mini markdown parser |
| `src/App.jsx` | 853 | Header, menus, new-run form and download helpers all together |

**How to fix it**
Split each into smaller files with one job each.

---

## Problem 6.3: The same thing is written in several places

- Secret-file block list: written twice (Problem 1.9).
- Code that reads Git changes (diff parser): written twice (`mcp/tools.py` and `graph.py`).
- The workspaces folder path: defined three times.

When someone updates one copy and forgets the others, bugs appear.

---

## Problem 6.4: Too many services for one job

GateKeep has **three** running programs (Python robot server, Python pipeline, Node backend) that all try to manage the same run state. This is why they disagree with each other (Problem 2.8).

**How to fix it**
Make **one** program the only owner of run state (Node is the natural choice). The Python parts should only do work and report back, never decide state.

---

## Problem 6.5: Small technical issues in the Python server

- It prints warnings to the normal output. When a robot connects through "stdio" (Claude Desktop), that output is the communication channel, so the warnings **corrupt the messages**.
- Network calls and Docker runs block the server, so one slow call freezes everything.
- The "apply patch" tool can damage files that are not plain UTF-8 text, and an empty search text matches everywhere.
- Robot sessions are kept in memory, never expire, and on startup GateKeep attaches itself to a random run.

---

# Part 7: README Claims That Are Not Fully True

| README says | Reality |
|---|---|
| "SHA-256 HMAC" audit log | Plain SHA-256, no secret key (Problem 4.1) |
| "Mathematically impossible to alter past actions" | Possible with database access (Problem 4.1) |
| "Sensitive files 100% blocked" | Can be read through tests, shortcuts, `.git/config` (Problems 1.6 to 1.8) |
| "Pass/fail strictly by exit code" | Exit code is ignored (Problem 3.1) |
| "0% hallucinations" | GateKeep itself can show false passes (Problems 3.1, 5.2) |
| "68 tests (42 Python + 26 Node)" | 47 Python test functions + 26 Node tests |
| "20 governed MCP tools" | Some docs say 18, the code has 20. Docs disagree. |
| "Air-gapped" sandbox | It is "no network" (`--network none`), which is good, but not the same thing as air-gapped |
| `sandbox/` folder | It is a single file `sandbox.py` |
| Agent "cannot write code before Gate 2" | Mostly true through MCP, but the robot can use its own tools or the open backend (Problems 1.1, 2.1, 8.1) |

**How to fix it**
Until the code is fixed, update the README so it describes what the code really does. Honest claims are better than strong claims that a reviewer can disprove in five minutes.

---

# Part 8: GateKeep Compared to Claude Code, Codex and Cursor

## Problem 8.1: The robot can simply go around GateKeep

**What is wrong**
Claude Code and Cursor have their **own** built-in tools for editing files and running terminal commands. Connecting GateKeep does not remove those tools. So the robot can:

- Edit your files directly, without GateKeep.
- Run `curl` to press GateKeep's Approve button (because there is no login).

GateKeep only works if the robot is forced to use GateKeep's tools **only**.

**How to fix it**
Ship ready-made settings for each tool:
- For Claude Code: a settings file and a "PreToolUse hook" that blocks the built-in Edit and Bash tools for the project.
- For Cursor: project rules that do the same.

---

## What Claude Code, Codex and Cursor already have

| Feature | Claude Code / Codex / Cursor | GateKeep today |
|---|---|---|
| Plan before coding | Yes (plan mode) | Yes, with human gates |
| Ask permission before actions | Yes | Yes, but bypassable |
| Run code in a sandbox | Yes | Yes (Docker, no network) |
| Hooks to block actions | Yes (Claude Code) | Policy engine |
| Works for a **team**, with roles | No, one person | Planned, but no login yet |
| Permanent record of who approved what | No | Yes, but not yet trustworthy |
| Requirement to design to code to test tracking | No | Not yet |

## Where GateKeep can be truly better

Those tools are made for **one developer in one session**. They do not keep a team-level record. GateKeep can win by being the **team approval and audit system for AI-written code**. To get there:

1. **Approve exact versions.** Gate 3 approval should mean "I approve this exact code fingerprint and this exact test run". No changes allowed after.
2. **Design vs code check.** Automatically warn or block when the robot changes files that were not in the approved design.
3. **Requirement tracking.** `REQ-1` links to a design part, code change and test. Show a coverage table.
4. **Real team roles.** Login, roles, and the rule "the person who asked for the work cannot approve it".
5. **Rules in a file.** A `gatekeep.yaml` file in the project that says which files are protected, which tools are allowed, and who must approve.
6. **Close the side doors.** Ship the Claude Code and Cursor settings from Problem 8.1.
7. **Fit into normal work.** Create a GitHub Pull Request with the full approval history attached, and make GateKeep a required check before merging.
8. **Trustworthy diary.** HMAC with a secret key, include run ID, store the latest stamp separately.

---

# Part 9: What to Fix First

Fix these in order. The first three make GateKeep's main promises actually true.

| Order | What to do | Problems it fixes |
|---|---|---|
| 1 | Add login. Separate robot keys from human logins. Allow only the dashboard website. Turn off the tamper endpoint outside demo mode. | 1.1 to 1.4, 4.2, 4.3 |
| 2 | Make "decide" the only way to change steps. Add a real Gate 3. Send rejected work back to the right step. Deny when unsure instead of guessing. Use database transactions. | 2.1 to 2.3, 4.6 |
| 3 | "Passed" only when exit code is 0 and tests actually ran. Freeze the code after review is requested. Approve exact code versions. | 2.4, 3.1, 3.2 |
| 4 | Block `.git` and shortcuts. Hide secrets in all output, including test output. Remove the GitHub token from `.git/config`. Validate run IDs. | 1.5 to 1.11 |
| 5 | Remove all fake data and "demo mode" from the dashboard. Add the gate banner. Build the three-column Gate 3 page. | 5.1 to 5.6 |
| 6 | Update the README to match the real code. Delete unused code. Split the big files. | 6.1 to 6.3, Part 7 |
| 7 | Add the features that beat other tools: design vs code check, requirement tracking, `gatekeep.yaml`, Pull Request export. | 2.5, 2.6, Part 8 |

---

# Small Dictionary

| Word | Simple meaning |
|---|---|
| **Agent / robot** | The AI program that writes code (for example Claude or Cursor). |
| **Backend** | The server program that stores runs and approvals (here: Node.js). |
| **Dashboard / frontend** | The web page the human reviewer uses. |
| **Endpoint** | A specific address on the server that does one action, like "approve". |
| **Gate** | A checkpoint where a human must approve before the robot can continue. |
| **Phase / step** | One stage of the work: Requirements, Design, or Code. |
| **MCP** | Model Context Protocol. A standard way for AI robots to use tools. GateKeep offers its tools through MCP. |
| **Docker / sandbox / container** | A locked box where code runs without touching your real computer or the internet. |
| **Exit code** | A number a program returns when it finishes. 0 means success, anything else means failure. |
| **Hash** | A short fingerprint of some data. If the data changes, the fingerprint changes. |
| **HMAC** | A hash made with a secret key, so only someone with the key can make a valid one. |
| **Audit log / diary** | The list of everything that happened in a run, linked by hashes. |
| **CORS** | A browser rule that decides which websites may talk to a server. |
| **Symlink** | A shortcut file that points to another file. |
| **`.env` file** | A file where projects usually keep passwords and API keys. |
| **`.git` folder** | A hidden folder where Git stores history and settings for a project. |
| **Transaction** | A group of database changes that either all succeed or all fail together. |
| **Redact** | Hide secret values by replacing them, for example with `***`. |
| **Diff** | The list of lines that were added or removed in the code. |
| **LangGraph pipeline** | GateKeep's automatic mode, where GateKeep itself drives the AI through the steps. |
