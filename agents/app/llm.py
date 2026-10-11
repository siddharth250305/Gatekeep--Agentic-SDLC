"""LLM abstraction with multi-provider support (Google Gemini, Anthropic, FakeLLM).
FakeLLM runs offline (deterministic tokens + canned artifacts) so the pipeline
is fully testable. A real Gemini or Anthropic model is used when GEMINI_API_KEY
or ANTHROPIC_API_KEY is set.
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass
from pathlib import Path

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
            except Exception:
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

    def chat(self, contents: list[dict], tools_schema: list[dict] | None = None, system: str | None = None) -> LLMResult:
        return self.generate("fake chat", kind="coding", system=system)


class GeminiLLM:
    """Google Gemini model via REST API using httpx."""

    def __init__(self, api_key: str, model: str = "gemini-3.5-flash", fallback_model: str = "gemini-3.5-flash-lite"):
        self.api_key = api_key
        self.model = model
        self.fallback_model = fallback_model
        self.base_url = "https://generativelanguage.googleapis.com/v1beta/models"

    def _call_api(self, model: str, payload: dict, timeout: float = 45.0) -> dict:
        import httpx

        url = f"{self.base_url}/{model}:generateContent?key={self.api_key}"
        with httpx.Client(timeout=timeout) as client:
            resp = client.post(url, json=payload)
            if resp.status_code in (429, 503):
                # High demand / rate limit: wait and try fallback if available
                time.sleep(1.5)
                if model != self.fallback_model:
                    fallback_url = f"{self.base_url}/{self.fallback_model}:generateContent?key={self.api_key}"
                    resp2 = client.post(fallback_url, json=payload)
                    if resp2.status_code == 200:
                        return resp2.json()
                resp = client.post(url, json=payload)
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

    def chat(self, contents: list[dict], tools_schema: list[dict] | None = None, system: str | None = None) -> LLMResult:
        started = time.perf_counter()
        payload: dict = {"contents": contents}
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
        )


class AnthropicLLM:
    """Real model. Reads exact token usage from the API response."""

    def __init__(self, api_key: str, model: str = "claude-3-5-sonnet-20241022"):
        import anthropic  # imported lazily so the dep is optional

        self.client = anthropic.Anthropic(api_key=api_key)
        self.model = model

    def generate(self, prompt: str, kind: str = "", system: str | None = None) -> LLMResult:
        started = time.perf_counter()
        kwargs: dict = {
            "model": self.model,
            "max_tokens": 2048,
            "messages": [{"role": "user", "content": prompt}],
        }
        if system:
            kwargs["system"] = system

        msg = self.client.messages.create(**kwargs)
        content = "".join(getattr(b, "text", "") for b in msg.content)
        return LLMResult(
            content=content,
            input_tokens=msg.usage.input_tokens,
            output_tokens=msg.usage.output_tokens,
            model=self.model,
            duration_ms=int((time.perf_counter() - started) * 1000),
        )


def get_llm():
    load_dotenv()
    gemini_key = os.getenv("GEMINI_API_KEY")
    if gemini_key:
        model = os.getenv("GEMINI_MODEL", "gemini-3.5-flash")
        try:
            return GeminiLLM(gemini_key, model=model)
        except Exception:
            pass

    anthropic_key = os.getenv("ANTHROPIC_API_KEY")
    if anthropic_key:
        model = os.getenv("ANTHROPIC_MODEL", "claude-3-5-sonnet-20241022")
        try:
            return AnthropicLLM(anthropic_key, model=model)
        except Exception:
            pass

    return FakeLLM()
