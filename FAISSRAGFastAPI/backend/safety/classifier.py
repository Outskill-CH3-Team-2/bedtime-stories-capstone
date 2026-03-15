"""
safety/classifier.py — LLM-based content safety classifier.

check_content_safety() calls gpt-4o-mini via OpenRouter to screen
story text for age-inappropriate content before media generation.

On any API failure it defaults to passed=True (fail-open) so the
pipeline never blocks a story due to a transient network error.
"""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path

import yaml

try:
    from langsmith import traceable
except ImportError:
    def traceable(*args, **kwargs):
        def decorator(fn):
            return fn
        return decorator if args and callable(args[0]) else decorator

from backend.contracts import SafetyResult
from backend.pipelines.provider import get_client

_CONFIG_DIR = Path(__file__).parent.parent / "config"


@lru_cache(maxsize=1)
def _get_prompts() -> dict:
    with open(_CONFIG_DIR / "prompts.yaml") as f:
        return yaml.safe_load(f)


@lru_cache(maxsize=1)
def _get_models() -> dict:
    with open(_CONFIG_DIR / "models.yaml") as f:
        return yaml.safe_load(f)


async def check_content_safety(text: str) -> SafetyResult:
    """
    Run the safety classifier on story text.

    Returns:
      SafetyResult(passed=True)  — content is appropriate
      SafetyResult(passed=False, reason="...", flags=[...])  — content flagged

    Defaults to passed=True on any API error.
    """
    if not text or not text.strip():
        return SafetyResult(passed=True)

    prompts = _get_prompts()
    models = _get_models()

    safety_prompt = prompts["safety_check_prompt"].format(text=text)
    model = models["safety"]["model"]
    max_tokens = models["safety"]["max_tokens"]
    temperature = models["safety"]["temperature"]

    try:
        client = get_client()
        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "user", "content": safety_prompt}
            ],
            max_tokens=max_tokens,
            temperature=temperature,
            timeout=20,
        )

        raw = response.choices[0].message.content or "{}"
        # Strip markdown fences if the model wrapped the JSON (e.g. ```json ... ```)
        raw = re.sub(r"^```[a-z]*\s*|\s*```$", "", raw.strip(), flags=re.DOTALL).strip()

        data = json.loads(raw)
        return SafetyResult(
            passed=bool(data.get("passed", True)),
            reason=str(data.get("reason", "")),
            flags=[str(f) for f in data.get("flags", [])],
        )

    except json.JSONDecodeError as exc:
        print(f"[classifier.py] JSON parse error: {exc} — raw: {raw!r}")
        # Default to pass on parse error
        return SafetyResult(passed=True)

    except Exception as exc:
        print(f"[classifier.py] API error: {exc} — defaulting to passed=True")
        return SafetyResult(passed=True)
