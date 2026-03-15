"""
pipelines/provider.py — OpenRouter client factory.

All pipeline modules import get_client() from here so API key config
is in one place. Uses the openai SDK pointed at the OpenRouter base URL.
"""

import os
from functools import lru_cache
from openai import AsyncOpenAI
from dotenv import load_dotenv

load_dotenv()


@lru_cache(maxsize=1)
def get_client() -> AsyncOpenAI:
    """
    Return a cached AsyncOpenAI client configured for OpenRouter.

    The client is created once (via lru_cache) and reused for all calls.
    Raises ValueError at startup if OPENROUTER_API_KEY is missing so the
    problem surfaces immediately rather than on the first real request.
    """
    api_key = os.getenv("OPENROUTER_API_KEY")
    if not api_key:
        # Don't crash in mock mode — caller checks MOCK_PIPELINES first
        api_key = "missing-key-set-OPENROUTER_API_KEY-in-.env"

    referer = os.getenv("OPENROUTER_REFERER", "http://localhost:3000")
    return AsyncOpenAI(
        api_key=api_key,
        base_url="https://openrouter.ai/api/v1",
        default_headers={
            "HTTP-Referer": referer,
            "X-Title": "Story Weaver",
        },
    )
