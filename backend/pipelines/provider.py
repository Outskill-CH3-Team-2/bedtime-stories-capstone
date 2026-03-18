"""
pipelines/provider.py — OpenRouter client factory.

All pipeline modules import get_client() from here so API key config
is in one place. Uses the openai SDK pointed at the OpenRouter base URL.

Supports per-request API key overrides via contextvars — set by the
API layer when a user provides their own OpenRouter key.
"""

import os
from contextvars import ContextVar
from functools import lru_cache
from openai import AsyncOpenAI
from dotenv import load_dotenv

load_dotenv()

# Per-request API key override (set by main.py before pipeline runs)
_api_key_override: ContextVar[str | None] = ContextVar("_api_key_override", default=None)


def set_api_key_override(key: str | None) -> None:
    """Set a per-request OpenRouter API key (called from the API layer)."""
    _api_key_override.set(key)


@lru_cache(maxsize=1)
def _get_default_client() -> AsyncOpenAI:
    """Return the server-default cached client from env vars."""
    api_key = os.getenv("OPENROUTER_API_KEY")
    if not api_key:
        api_key = "missing-key-set-OPENROUTER_API_KEY-in-.env"

    return AsyncOpenAI(
        api_key=api_key,
        base_url="https://openrouter.ai/api/v1",
        default_headers={
            "HTTP-Referer": "http://localhost:3000",
            "X-Title": "Story Weaver",
        },
    )


def get_client() -> AsyncOpenAI:
    """
    Return an AsyncOpenAI client configured for OpenRouter.

    If a per-request API key override is active (user provided their own key),
    returns a fresh client with that key. Otherwise returns the cached default.
    """
    override = _api_key_override.get()
    if override:
        return AsyncOpenAI(
            api_key=override,
            base_url="https://openrouter.ai/api/v1",
            default_headers={
                "HTTP-Referer": "http://localhost:3000",
                "X-Title": "Story Weaver",
            },
        )
    return _get_default_client()
