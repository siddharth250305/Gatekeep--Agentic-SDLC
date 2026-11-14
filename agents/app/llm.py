"""LLM abstraction with multi-provider support (Google Gemini, Anthropic, FakeLLM).
FakeLLM runs offline (deterministic tokens + canned artifacts) so the pipeline
is fully testable. A real Gemini or Anthropic model is used when GEMINI_API_KEY
or ANTHROPIC_API_KEY is set.

chat() takes one provider-neutral conversation, a list of turns:
  {"role": "user", "text": str}
  {"role": "assistant", "text": str, "tool_calls": [ToolCall], "raw": <provider content>}
  {"role": "tool", "results": [{"id": str, "name": str, "content": str}]}
Each model translates it to its own API. ``assistant_turn(result)`` builds the
assistant turn to append after a chat() call; "raw" carries the provider's own
content back unchanged (Gemini thought signatures, Claude thinking blocks).
"""

from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

log = logging.getLogger("gatekeep.llm")

# Canned agent outputs used by the fake model (kind -> artifact).
CANNED = {
    "requirements": (
        "Throttle the checkout webhook to 60 requests/min per merchant key. "
        "Return HTTP 429 with a Retry-After header when exceeded. Exempt "
        "internal reconciliation traffic by service token."
    ),
    "design": (
        "Token-bucket counter in Redis keyed by merchant. Enforced in a FastAPI "
        "dependency so every route inherits it. Limits and window come from env "
        "with safe defaults. Reconciliation token bypasses the bucket."
    ),
    "coding": (
        "Implemented app/middleware/throttle.py (Redis token bucket) and wired "
        "it into the webhook route. Added tests/test_throttle.py. 14 tests pass "
        "in the isolated sandbox after 2 self-heal iterations."
    ),
}


# The (tiny, real) module and tests the fake model writes with write_file in
# the coding step; they run for real in the sandbox.
CODE_FILES = {
    "throttle.py": (
        "def is_allowed(count, limit=60):\n"
        "    return count <= limit\n"
    ),
    "test_throttle.py": (
        "from throttle import is_allowed\n\n"
        "def test_under_limit():\n    assert is_allowed(1)\n\n"
        "def test_at_limit():\n    assert is_allowed(60)\n\n"
        "def test_over_limit():\n    assert not is_allowed(61)\n"
    ),
}


def load_dotenv(env_path: str | Path | None = None) -> None:
    """Lightweight zero-dependency .env loader."""
    candidates = [
        Path(env_path) if env_path else None,
        Path(__file__).resolve().parent.parent / ".env",
        Path(__file__).resolve().parent.parent.parent / ".env",
    ]
    for p in candidates:
        if p and p.is_file():
            try:
                for line in p.read_text().splitlines():
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    k, v = line.split("=", 1)
                    k, v = k.strip(), v.strip().strip("'\"")
                    if k and k not in os.environ:
                        os.environ[k] = v
            except OSError:
                pass
            break


@dataclass
class ToolCall:
    name: str
    args: dict
    id: str = ""
    raw_part: dict | None = None  # vendor-specific raw part (e.g. thoughtSignature)


@dataclass
class LLMResult:
    content: str
    input_tokens: int
    output_tokens: int
    model: str
    duration_ms: int
    tool_calls: list[ToolCall] | None = None
    raw_response: dict | None = None
    raw_content: Any = None  # the provider's own assistant content, echoed back on the next turn


def assistant_turn(result: LLMResult) -> dict:
    """The conversation turn that records a chat() result."""
    return {"role": "assistant", "text": result.content, "tool_calls": result.tool_calls or [],
            "raw": result.raw_content}


def _approx_tokens(text: str) -> int:
    # ~4 characters per token, minimum 1.
    return max(1, len(text) // 4)


class FakeLLM:
    """Deterministic model: token counts derive from prompt/output length."""

    model = "fake"

    def generate(self, prompt: str, kind: str = "", system: str | None = None) -> LLMResult:
        out = CANNED.get(kind, "ok")
        inp = _approx_tokens(prompt)
        return LLMResult(
            content=out,
            input_tokens=inp,
            output_tokens=_approx_tokens(out),
            model=self.model,
            duration_ms=40 + inp,  # deterministic, non-zero
        )

    assistant_turn = staticmethod(assistant_turn)

    def chat(self, messages: list[dict], tools_schema: list[dict] | None = None,
             system: str | None = None) -> LLMResult:
        """First turn: write the canned module and its tests through the tools.
        After the tool results come back: a short summary, no more calls."""
        prompt = messages[0].get("text", "") if messages else ""
        res = self.generate(prompt, kind="coding", system=system)
        if messages and messages[-1].get("role") == "tool":
            return res
        calls = [ToolCall(name="write_file", args={"path": path, "content": src}, id=f"fake-{i}")
                 for i, (path, src) in enumerate(CODE_FILES.items(), 1)]
        return LLMResult(content="", input_tokens=res.input_tokens, output_tokens=res.output_tokens,
                         model=self.model, duration_ms=res.duration_ms, tool_calls=calls)


class GeminiLLM:
    """Google Gemini model via REST API using httpx."""

    def __init__(self, api_key: str, model: str = "gemini-3.5-flash", fallback_model: str = "gemini-3.5-flash-lite"):
        self.api_key = api_key
        self.model = model
        self.fallback_model = fallback_model
        self.base_url = "https://generativelanguage.googleapis.com/v1beta/models"

    def _call_api(self, model: str, payload: dict, timeout: float = 45.0) -> dict:
        import httpx

        # The key goes in a header, never in the URL: an HTTP error message
        # quotes the URL, and error text ends up in logs and the audit log.
        headers = {"x-goog-api-key": self.api_key}
        url = f"{self.base_url}/{model}:generateContent"
        with httpx.Client(timeout=timeout) as client:
            resp = client.post(url, json=payload, headers=headers)
            if resp.status_code in (429, 503):
                # High demand / rate limit: wait and try fallback if available
                time.sleep(1.5)
                if model != self.fallback_model:
                    fallback_url = f"{self.base_url}/{self.fallback_model}:generateContent"
                    resp2 = client.post(fallback_url, json=payload, headers=headers)
                    if resp2.status_code == 200:
                        return resp2.json()
                resp = client.post(url, json=payload, headers=headers)
            resp.raise_for_status()
            return resp.json()

    def generate(self, prompt: str, kind: str = "", system: str | None = None) -> LLMResult:
        started = time.perf_counter()
        payload: dict = {
            "contents": [{"parts": [{"text": prompt}]}]
        }
        if system:
            payload["system_instruction"] = {"parts": [{"text": system}]}

        data = self._call_api(self.model, payload)
        candidate = data.get("candidates", [{}])[0]
        content_parts = candidate.get("content", {}).get("parts", [])
        content = "".join(p.get("text", "") for p in content_parts if "text" in p)

        usage = data.get("usageMetadata", {})
        inp_tokens = usage.get("promptTokenCount", _approx_tokens(prompt))
        out_tokens = usage.get("candidatesTokenCount", _approx_tokens(content))

        return LLMResult(
            content=content,
            input_tokens=inp_tokens,
            output_tokens=out_tokens,
            model=self.model,
            duration_ms=int((time.perf_counter() - started) * 1000),
            raw_response=data,
        )

    assistant_turn = staticmethod(assistant_turn)

    @staticmethod
    def _contents(messages: list[dict]) -> list[dict]:
        """The neutral conversation as Gemini contents."""
        contents: list[dict] = []
        for m in messages:
            if m["role"] == "user":
                contents.append({"role": "user", "parts": [{"text": m["text"]}]})
            elif m["role"] == "assistant":
                parts = m.get("raw") or (
                    ([{"text": m["text"]}] if m.get("text") else [])
                    + [{"functionCall": {"name": c.name, "args": c.args}} for c in m.get("tool_calls") or []])
                contents.append({"role": "model", "parts": parts})
            elif m["role"] == "tool":
                contents.append({"role": "user", "parts": [
                    {"functionResponse": {"name": r["name"], "response": {"result": r["content"]}}}
                    for r in m["results"]]})
        return contents

    def chat(self, messages: list[dict], tools_schema: list[dict] | None = None,
             system: str | None = None) -> LLMResult:
        started = time.perf_counter()
        payload: dict = {"contents": self._contents(messages)}
        if system:
            payload["system_instruction"] = {"parts": [{"text": system}]}
        if tools_schema:
            payload["tools"] = [{"function_declarations": tools_schema}]

        data = self._call_api(self.model, payload)
        candidate = data.get("candidates", [{}])[0]
        content_obj = candidate.get("content", {})
        parts = content_obj.get("parts", [])

        text_content = "".join(p.get("text", "") for p in parts if "text" in p)
        tool_calls: list[ToolCall] = []
        for p in parts:
            if "functionCall" in p:
                fn = p["functionCall"]
                tool_calls.append(ToolCall(
                    name=fn.get("name", ""),
                    args=fn.get("args", {}),
                    id=fn.get("id", ""),
                    raw_part=p,
                ))

        usage = data.get("usageMetadata", {})
        inp_tokens = usage.get("promptTokenCount", 0)
        out_tokens = usage.get("candidatesTokenCount", 0)

        return LLMResult(
            content=text_content,
            input_tokens=inp_tokens,
            output_tokens=out_tokens,
            model=self.model,
            duration_ms=int((time.perf_counter() - started) * 1000),
            tool_calls=tool_calls if tool_calls else None,
            raw_response=data,
            raw_content=parts,
        )


def _json_schema(schema: Any) -> Any:
    """Gemini-style schema (type "OBJECT", "STRING") as JSON Schema for Claude."""
    if isinstance(schema, dict):
        return {k: (v.lower() if k == "type" and isinstance(v, str) else _json_schema(v)) for k, v in schema.items()}
    if isinstance(schema, list):
        return [_json_schema(v) for v in schema]
    return schema


# Claude model used when ANTHROPIC_MODEL is not set.
DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5"


class AnthropicLLM:
    """Claude through the official SDK. Reads exact token usage from the response.

    Requests go through the beta Messages endpoint with server-side refusal
    fallbacks enabled ("default" routing), so a declined request is retried on
    a fallback model inside the same call."""

    FALLBACK_BETA = "server-side-fallback-2026-07-01"

    def __init__(self, api_key: str, model: str = DEFAULT_ANTHROPIC_MODEL, client: Any = None,
                 max_tokens: int = 16000):
        if client is None:
            import anthropic  # pyright: ignore[reportMissingImports]  # optional dependency, imported lazily

            client = anthropic.Anthropic(api_key=api_key)
        self.client = client
        self.model = model
        self.max_tokens = max_tokens

    assistant_turn = staticmethod(assistant_turn)

    def _create(self, **kwargs: Any) -> Any:
        return self.client.beta.messages.create(
            model=self.model, max_tokens=self.max_tokens,
            betas=[self.FALLBACK_BETA], fallbacks="default", **kwargs)

    def generate(self, prompt: str, kind: str = "", system: str | None = None) -> LLMResult:
        started = time.perf_counter()
        kwargs: dict = {"messages": [{"role": "user", "content": prompt}]}
        if system:
            kwargs["system"] = system
        msg = self._create(**kwargs)
        content = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")
        return LLMResult(
            content=content,
            input_tokens=msg.usage.input_tokens,
            output_tokens=msg.usage.output_tokens,
            model=getattr(msg, "model", None) or self.model,
            duration_ms=int((time.perf_counter() - started) * 1000),
        )

    @staticmethod
    def _messages(messages: list[dict]) -> list[dict]:
        """The neutral conversation as Claude messages. An assistant turn is
        sent back exactly as Claude returned it; all tool results of one turn
        go in a single user message."""
        out: list[dict] = []
        for m in messages:
            if m["role"] == "user":
                out.append({"role": "user", "content": m["text"]})
            elif m["role"] == "assistant":
                content = m.get("raw")
                if content is None:
                    content = ([{"type": "text", "text": m["text"]}] if m.get("text") else []) + [
                        {"type": "tool_use", "id": c.id, "name": c.name, "input": c.args}
                        for c in m.get("tool_calls") or []]
                out.append({"role": "assistant", "content": content})
            elif m["role"] == "tool":
                out.append({"role": "user", "content": [
                    {"type": "tool_result", "tool_use_id": r["id"], "content": r["content"]}
                    for r in m["results"]]})
        return out

    def chat(self, messages: list[dict], tools_schema: list[dict] | None = None,
             system: str | None = None) -> LLMResult:
        started = time.perf_counter()
        kwargs: dict = {"messages": self._messages(messages)}
        if system:
            kwargs["system"] = system
        if tools_schema:
            kwargs["tools"] = [{"name": t["name"], "description": t.get("description", ""),
                                "input_schema": _json_schema(t.get("parameters") or {"type": "object"})}
                               for t in tools_schema]
        msg = self._create(**kwargs)
        text = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")
        # Tools run only when Claude stopped to call them; a refusal or a cut-off
        # answer (max_tokens) never runs a half-formed call.
        calls = [ToolCall(name=b.name, args=b.input, id=b.id)
                 for b in msg.content if getattr(b, "type", "") == "tool_use"] if msg.stop_reason == "tool_use" else []
        return LLMResult(
            content=text,
            input_tokens=msg.usage.input_tokens,
            output_tokens=msg.usage.output_tokens,
            model=getattr(msg, "model", None) or self.model,
            duration_ms=int((time.perf_counter() - started) * 1000),
            tool_calls=calls or None,
            raw_content=msg.content,
        )


def get_llm():
    load_dotenv()
    gemini_key = os.getenv("GEMINI_API_KEY")
    if gemini_key:
        model = os.getenv("GEMINI_MODEL", "gemini-3.5-flash")
        return GeminiLLM(gemini_key, model=model)

    anthropic_key = os.getenv("ANTHROPIC_API_KEY")
    if anthropic_key:
        model = os.getenv("ANTHROPIC_MODEL", DEFAULT_ANTHROPIC_MODEL)
        try:
            return AnthropicLLM(anthropic_key, model=model)
        except ImportError:
            log.warning("ANTHROPIC_API_KEY is set but the anthropic package is not installed "
                        "(pip install anthropic); falling back to the offline fake model")

    return FakeLLM()
