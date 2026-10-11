"""Model price table + cost calculation. USD per 1M tokens (input, output)."""

PRICES = {
    "claude-sonnet-4": (3.0, 15.0),
    "claude-3-5-sonnet-20241022": (3.0, 15.0),
    "claude-3-7-sonnet-20250219": (3.0, 15.0),
    "claude-haiku-4": (0.80, 4.0),
    "claude-3-5-haiku-20241022": (0.80, 4.0),
    "gpt-4o": (2.50, 10.0),
    "gemini-1.5-pro": (1.25, 5.0),
    "gemini-3.5-flash": (0.10, 0.40),
    "gemini-3.8-flash": (0.10, 0.40),
    "gemini-3.5-flash-lite": (0.05, 0.20),
    "gemini-3.1-pro-preview": (1.25, 5.0),
    "fake": (1.0, 3.0),  # deterministic, for offline runs + tests
}


def cost_usd(model: str, input_tokens: int, output_tokens: int) -> float:
    p_in, p_out = PRICES.get(model, PRICES["fake"])
    return round(input_tokens / 1_000_000 * p_in + output_tokens / 1_000_000 * p_out, 6)

