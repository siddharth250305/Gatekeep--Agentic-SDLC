"""G9: Claude works natively in pipeline mode.

AnthropicLLM.chat() speaks the same provider-neutral conversation as
GeminiLLM.chat(): user turns, assistant turns with tool calls, and tool
results. The Anthropic client is replaced by a fake, so no key is needed."""

from __future__ import annotations

import sys
from types import SimpleNamespace

import pytest

from app import llm as llm_mod
from app.graph import build_pipeline
from app.llm import AnthropicLLM, GeminiLLM, ToolCall
from app.mcp.session import SessionManager
from app.mcp.tools import GateKeepTools
from app.reporter import HttpReporter
from app.repository.tools import WORKSPACE_TOOLS_SCHEMA
from app.sandbox import FakeRunner
from tests.conftest import BASE


def text(t):
    return SimpleNamespace(type="text", text=t)


def tool_use(id_, name, input_):
    return SimpleNamespace(type="tool_use", id=id_, name=name, input=input_)


def message(content, stop_reason, model="claude-opus-5-5"):
    return SimpleNamespace(content=content, stop_reason=stop_reason, model=model,
                           usage=SimpleNamespace(input_tokens=11, output_tokens=7))


class FakeMessages:
    def __init__(self, replies):
        self.replies = list(replies)
        self.requests: list[dict] = []

    def create(self, **kwargs):
        self.requests.append(kwargs)
        return self.replies.pop(0)


def fake_client(*replies):
    messages = FakeMessages(replies)
    return SimpleNamespace(beta=SimpleNamespace(messages=messages), messages=messages), messages


def test_claude_chat_returns_the_tool_calls_it_asked_for():
    client, sent = fake_client(message([text("Let me look."), tool_use("tu_1", "read_file", {"path": "a.py"})],
                                       "tool_use"))
    llm = AnthropicLLM("key", client=client)
    res = llm.chat([{"role": "user", "text": "fix a.py"}], tools_schema=WORKSPACE_TOOLS_SCHEMA, system="be careful")

    assert [(c.id, c.name, c.args) for c in res.tool_calls] == [("tu_1", "read_file", {"path": "a.py"})]
    assert res.content == "Let me look."
    assert (res.input_tokens, res.output_tokens, res.model) == (11, 7, "claude-opus-5-5")
    req = sent.requests[0]
    assert req["model"] == "claude-opus-5-5"
    assert req["system"] == "be careful"
    assert req["messages"] == [{"role": "user", "content": "fix a.py"}]
    read = next(t for t in req["tools"] if t["name"] == "read_file")
    # Gemini-style schema types become JSON Schema for Claude.
    assert read["input_schema"]["type"] == "object"
    assert read["input_schema"]["properties"]["path"]["type"] == "string"
    assert read["input_schema"]["required"] == ["path"]


def test_claude_chat_sends_back_its_own_turn_and_all_tool_results_in_one_message():
    first = message([tool_use("tu_1", "read_file", {"path": "a.py"}), tool_use("tu_2", "list_files", {})], "tool_use")
    client, sent = fake_client(first, message([text("All done.")], "end_turn"))
    llm = AnthropicLLM("key", client=client)
    convo = [{"role": "user", "text": "go"}]
    res = llm.chat(convo, tools_schema=WORKSPACE_TOOLS_SCHEMA)
    convo.append(llm.assistant_turn(res))
    convo.append({"role": "tool", "results": [
        {"id": "tu_1", "name": "read_file", "content": "x = 1"},
        {"id": "tu_2", "name": "list_files", "content": '["a.py"]'},
    ]})
    final = llm.chat(convo, tools_schema=WORKSPACE_TOOLS_SCHEMA)

    assert final.tool_calls is None and final.content == "All done."
    msgs = sent.requests[1]["messages"]
    assert msgs[1] == {"role": "assistant", "content": first.content}  # echoed unchanged
    assert msgs[2] == {"role": "user", "content": [
        {"type": "tool_result", "tool_use_id": "tu_1", "content": "x = 1"},
        {"type": "tool_result", "tool_use_id": "tu_2", "content": '["a.py"]'},
    ]}


def test_a_refusal_ends_the_turn_without_running_tools():
    client, _ = fake_client(message([tool_use("tu_1", "write_file", {"path": "a", "content": "b"})], "refusal"))
    res = AnthropicLLM("key", client=client).chat([{"role": "user", "text": "go"}])
    assert res.tool_calls is None


def test_get_llm_picks_claude_when_only_an_anthropic_key_is_set(monkeypatch):
    monkeypatch.setattr(llm_mod, "load_dotenv", lambda *a, **k: None)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_MODEL", raising=False)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setitem(sys.modules, "anthropic", SimpleNamespace(Anthropic=lambda api_key: SimpleNamespace()))
    chosen = llm_mod.get_llm()
    assert isinstance(chosen, AnthropicLLM)
    assert chosen.model == "claude-opus-5-5"


def test_gemini_chat_translates_the_same_conversation(monkeypatch):
    llm = GeminiLLM("key")
    payloads = []
    raw_parts = [{"functionCall": {"name": "read_file", "args": {"path": "a.py"}}, "thoughtSignature": "sig"}]

    def call_api(model, payload, timeout=45.0):
        payloads.append(payload)
        return {"candidates": [{"content": {"parts": raw_parts}}],
                "usageMetadata": {"promptTokenCount": 3, "candidatesTokenCount": 2}}

    monkeypatch.setattr(llm, "_call_api", call_api)
    convo = [{"role": "user", "text": "go"}]
    res = llm.chat(convo, tools_schema=WORKSPACE_TOOLS_SCHEMA, system="sys")
    assert [(c.name, c.args) for c in res.tool_calls] == [("read_file", {"path": "a.py"})]
    convo.append(llm.assistant_turn(res))
    convo.append({"role": "tool", "results": [{"id": "", "name": "read_file", "content": "x = 1"}]})
    llm.chat(convo, tools_schema=WORKSPACE_TOOLS_SCHEMA, system="sys")
    assert payloads[1]["contents"] == [
        {"role": "user", "parts": [{"text": "go"}]},
        {"role": "model", "parts": raw_parts},  # thought signature kept
        {"role": "user", "parts": [{"functionResponse": {"name": "read_file", "response": {"result": "x = 1"}}}]},
    ]


def test_claude_writes_the_code_in_pipeline_mode_through_gatekeep_tools(node, tmp_path):
    """Before: AnthropicLLM had no chat(), so pipeline mode wrote placeholder code."""
    client, _ = fake_client(
        message([tool_use("tu_1", "write_file", {"path": "limiter.py", "content": "LIMIT = 60\n"}),
                 tool_use("tu_2", "write_file", {"path": "test_limiter.py",
                                                 "content": "from limiter import LIMIT\n\n\ndef test_limit():\n"
                                                            "    assert LIMIT == 60\n"})], "tool_use"),
        message([text("Added limiter.py with a test.")], "end_turn"),
    )
    node.add_run("RUN-C", step="code")
    core = GateKeepTools(SessionManager(base_url=BASE), base_url=BASE, runner=FakeRunner(), workspaces=tmp_path)
    out = build_pipeline(AnthropicLLM("key", client=client), core, HttpReporter(base=BASE)).work("RUN-C")

    assert out["did"] == "code"
    assert (tmp_path / "RUN-C" / "limiter.py").read_text() == "LIMIT = 60\n"
    assert not (tmp_path / "RUN-C" / "throttle.py").exists()  # no canned stand-in
    assert node.runs["RUN-C"]["step"] == "g3"
    (_, key, metrics), = [m for m in node.phase_metrics if m[1] == "code"]
    assert metrics["model"] == "claude-opus-5-5" and metrics["input_tokens"] == 22


@pytest.mark.parametrize("bad", [None, "not-a-dict"])
def test_tool_calls_with_bad_arguments_are_answered_with_an_error(node, tmp_path, bad):
    class OddLLM(llm_mod.FakeLLM):
        def chat(self, messages, tools_schema=None, system=None):
            if messages[-1]["role"] == "tool":
                self.seen = messages[-1]["results"][0]["content"]
                return llm_mod.LLMResult("done", 1, 1, "fake", 1)
            return llm_mod.LLMResult("", 1, 1, "fake", 1, tool_calls=[ToolCall("write_file", bad, id="x")])

    node.add_run("RUN-O", step="code")
    odd = OddLLM()
    core = GateKeepTools(SessionManager(base_url=BASE), base_url=BASE, runner=FakeRunner(), workspaces=tmp_path)
    build_pipeline(odd, core, HttpReporter(base=BASE)).work("RUN-O")
    assert "error" in odd.seen.lower()
