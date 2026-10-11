from app.pricing import cost_usd
from app.llm import FakeLLM


def test_cost_math():
    # fake = ($1 in, $3 out) per 1M tokens
    assert cost_usd("fake", 1_000_000, 1_000_000) == 4.0
    assert cost_usd("fake", 0, 0) == 0.0
    assert cost_usd("claude-sonnet-4", 1_000_000, 0) == 3.0
    assert cost_usd("claude-sonnet-4", 0, 1_000_000) == 15.0


def test_unknown_model_falls_back_to_fake_price():
    assert cost_usd("mystery", 1_000_000, 0) == 1.0


def test_fake_llm_meters_deterministically():
    llm = FakeLLM()
    a = llm.generate("write requirements for a rate limiter", "requirements")
    b = llm.generate("write requirements for a rate limiter", "requirements")
    assert a.input_tokens == b.input_tokens > 0
    assert a.output_tokens > 0
    assert a.model == "fake"
    assert a.duration_ms > 0
