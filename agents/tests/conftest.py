"""Shared test doubles for Milestone 5 (one core, two adapters).

FakeNodeBackend stands in for the Node API over httpx. It keeps run state the
way the backend does (step, artifacts, audit chain) and applies the same robot
moves and gate decisions as backend/src/runs/machine.js, so the MCP adapter and
the pipeline adapter can be driven through one shared run."""

from __future__ import annotations

import re

import httpx
import pytest

BASE = "http://fake-node"

# Robot moves (machine.js MOVES with by: ROBOT).
ROBOT_MOVES = {
    "submit_requirements": ("req", "g1", "requirements.submitted", ("requirements",)),
    "submit_design": ("design", "g2", "design.submitted", ("design",)),
    "request_review": ("code", "g3", "code.review_requested", ("files", "diff", "summary")),
}
# Human decisions: (gate, decision) -> next step.
DECISIONS = {
    ("g1", "approve"): "design", ("g1", "reject"): "req",
    ("g2", "approve"): "code", ("g2", "reject"): "design",
    ("g3", "approve"): "done",
}
KEYS = ["req", "g1", "design", "g2", "code", "g3", "done"]
GATE_ROLE = {"g1": "Planner", "g2": "Engineer", "g3": "Engineer"}


class FakeNodeBackend:
    def __init__(self):
        self.runs: dict[str, dict] = {}
        self.calls: list[tuple[str, str, dict | None]] = []
        self.phase_metrics: list[tuple[str, str, dict]] = []
        self.test_runs: list[dict] = []
        self.sessions: dict[str, dict] = {}
        self.down = False

    # ── run setup and human decisions (what the dashboard would do) ──────

    def add_run(self, run_id: str, *, step: str = "req", started: bool = True, brief: str = "add rate limiting",
                repo: str = "") -> dict:
        run = {"id": run_id, "brief": brief, "repo": repo, "branch": "", "commit": "", "step": step,
               "started": started, "requirements": None, "design": None, "files": None, "diff": None,
               "summary": None, "tests": None, "auditChain": [{"event": "run.created", "payload": {}}]}
        self.runs[run_id] = run
        return run

    def decide(self, run_id: str, decision: str, *, target: str | None = None, feedback: str = "") -> str:
        run = self.runs[run_id]
        gate = run["step"]
        to = target if (gate == "g3" and decision == "reject") else DECISIONS[(gate, decision)]
        payload = {"from": gate, "to": to}
        if feedback:
            payload["feedback"] = feedback
        run["step"] = to
        run["auditChain"].append({"event": f"{gate}.{'approved' if decision == 'approve' else 'rejected'}",
                                  "actor": "reviewer", "payload": payload})
        return to

    def cancel(self, run_id: str) -> None:
        run = self.runs[run_id]
        run["auditChain"].append({"event": "run.cancelled", "payload": {"from": run["step"], "to": "cancelled"}})
        run["step"] = "cancelled"

    def events(self, run_id: str) -> list[str]:
        return [e["event"] for e in self.runs[run_id]["auditChain"]]

    # ── the HTTP surface ─────────────────────────────────────────────────

    def view(self, run: dict) -> dict:
        step = run["step"]
        status = ("approved" if step == "done" else "cancelled" if step == "cancelled"
                  else "awaiting_gate" if step in GATE_ROLE else "running")
        steps = []
        for k in KEYS:
            state = "active" if k == step else (
                "approved" if step in KEYS and KEYS.index(k) < KEYS.index(step) else "pending")
            steps.append({"key": k, "state": state, "status": state.title()})
        return {**run, "status": status, "gate": GATE_ROLE.get(step), "awaiting": status == "awaiting_gate",
                "steps": steps}

    def respond(self, method: str, url: str, json=None, **_):
        if self.down:
            raise httpx.ConnectError("backend down", request=httpx.Request(method, url))
        path = url.removeprefix(BASE)
        self.calls.append((method, path, json))
        status, body = self._route(method, path, json or {})
        return httpx.Response(status, json=body, request=httpx.Request(method, url))

    def _route(self, method, path, body):
        if (method, path) == ("GET", "/runs"):
            return 200, [{"id": r["id"], "step": r["step"], "started": r["started"], "status": self.view(r)["status"]}
                         for r in self.runs.values()]
        if method in ("POST", "PATCH") and path.startswith("/mcp/sessions"):
            m = re.match(r"^/mcp/sessions(?:/([^/]+))?(/end)?$", path)
            sid = (m.group(1) if m else None) or body.get("session_id")
            if m and m.group(2):
                self.sessions.setdefault(sid, {})["status"] = "ended"
            else:
                self.sessions.setdefault(sid, {"status": "active"}).update(body)
            return 200, self.sessions[sid]
        m = re.match(r"^/runs/([^/]+)(/.*)?$", path)
        if not m or m.group(1) not in self.runs:
            return 404, {"error": "run not found"}
        run, rest = self.runs[m.group(1)], m.group(2) or ""
        if method == "GET" and rest == "":
            return 200, self.view(run)
        if method == "GET" and rest == "/audit":
            return 200, run["auditChain"]
        if method == "POST" and rest == "/audit":
            run["auditChain"].append({"event": body.get("event"), "actor": "agent:test", "payload": body.get("payload", {})})
            return 201, {"ok": True}
        if method == "PUT" and rest.startswith("/phases/"):
            self.phase_metrics.append((run["id"], rest.split("/")[-1], body))
            return 200, {"ok": True}
        if method == "POST" and rest == "/test-runs":
            tr = {**body, "id": f"tr-{len(self.test_runs) + 1}"}
            self.test_runs.append(tr)
            run["tests"] = tr
            return 201, tr
        if method in ("PUT", "POST") and rest in ("/context", "/event", "/artifacts"):
            return 200, {"ok": True}
        m2 = re.match(r"^/actions/([a-z_]+)$", rest)
        if method == "POST" and m2:
            return self._robot(run, m2.group(1), body)
        return 404, {"error": f"no route {method} {path}"}

    def _robot(self, run, action, body):
        if action not in ROBOT_MOVES:
            return 400, {"error": "unknown action", "reason": "bad_action"}
        frm, to, event, kinds = ROBOT_MOVES[action]
        if run["step"] == to:
            return 200, self.view(run)  # already happened: unchanged
        if run["step"] != frm:
            return 409, {"error": f"not allowed at {run['step']}", "reason": "not_allowed", "step": run["step"]}
        if action == "request_review" and not body.get("fingerprint"):
            return 400, {"error": "fingerprint required", "reason": "fingerprint_required"}
        for k in kinds:
            if k in (body.get("artifacts") or {}):
                run[k] = body["artifacts"][k]
        run["step"] = to
        run["auditChain"].append({"event": event, "actor": "agent:test",
                                  "payload": {"from": frm, "to": to, "fingerprint": body.get("fingerprint")}})
        return 200, self.view(run)


@pytest.fixture
def node(monkeypatch):
    """A fake Node backend behind httpx.get/post/put/patch."""
    fake = FakeNodeBackend()
    for name in ("get", "post", "put", "patch"):
        monkeypatch.setattr(httpx, name, lambda url, _m=name.upper(), **kw: fake.respond(_m, url, **kw))
    monkeypatch.setenv("GATEKEEP_API", BASE)
    return fake
