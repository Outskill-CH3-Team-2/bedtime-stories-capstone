"""
pipelines/text.py — Text generation pipeline for Story Weaver.

Functions:
  build_prompt()    — construct the message list for the LLM
  generate_text()   — call OpenRouter and return raw text
  parse_response()  — extract narrative + choices from LLM output

All functions are decorated with @traceable for LangSmith observability.
"""

from __future__ import annotations

import re
import os
from pathlib import Path
from typing import Optional

import yaml

try:
    from langsmith import traceable
except ImportError:
    # Graceful fallback if langsmith not installed
    def traceable(*args, **kwargs):
        def decorator(fn):
            return fn
        return decorator if args and callable(args[0]) else decorator


from backend.contracts import ChildConfig
from backend.pipelines.provider import get_client

# ---------------------------------------------------------------------------
# Config loading (cached at module level)
# ---------------------------------------------------------------------------

_CONFIG_DIR = Path(__file__).parent.parent / "config"


def _load_yaml(filename: str) -> dict:
    path = _CONFIG_DIR / filename
    with open(path, "r") as f:
        return yaml.safe_load(f)


_prompts: dict = {}
_models: dict = {}


def _get_prompts() -> dict:
    global _prompts
    if not _prompts:
        _prompts = _load_yaml("prompts.yaml")
    return _prompts


def _get_models() -> dict:
    global _models
    if not _models:
        _models = _load_yaml("models.yaml")
    return _models


# ---------------------------------------------------------------------------
# Public functions
# ---------------------------------------------------------------------------


def build_prompt(
    config: ChildConfig,
    messages: list[dict],
    step_number: int,
    rag_context: Optional[str] = None,
) -> list[dict]:
    """
    Construct the full message list for the LLM.

    - Builds a system prompt from the template, filled with child info.
    - Appends ending/forced-ending instructions at steps 6+ / 8+.
    - Injects RAG context into the system prompt if provided.
    - Appends the existing conversation history.
    """
    prompts = _get_prompts()

    # Build details string from personalization
    p = config.personalization
    details_parts = []
    if p.favourite_colour:
        details_parts.append(f"favourite colour is {p.favourite_colour}")
    if p.favourite_animal:
        details_parts.append(f"loves {p.favourite_animal}s")
    if p.favourite_food:
        details_parts.append(f"favourite food is {p.favourite_food}")
    if p.favourite_activities:
        details_parts.append(f"enjoys {', '.join(p.favourite_activities)}")
    if p.pet_name and p.pet_type:
        details_parts.append(f"has a {p.pet_type} named {p.pet_name}")
    details = "; ".join(details_parts) if details_parts else "loves adventure"

    # Fill system prompt template
    system_text = prompts["story_system_prompt"].format(
        name=config.child_name,
        age=config.child_age,
        details=details,
    )

    # Inject RAG context if available
    if rag_context:
        rag_block = prompts["rag_injection"].format(rag_context=rag_context)
        system_text = system_text + "\n\n" + rag_block

    # Append pacing instruction near the end
    if step_number >= 8:
        ending_block = prompts["forced_ending_instruction"].format(
            name=config.child_name,
            age=config.child_age,
        )
        system_text = system_text + "\n\n" + ending_block
    elif step_number >= 6:
        ending_block = prompts["ending_instruction"].format(
            name=config.child_name,
            age=config.child_age,
            step=step_number,
        )
        system_text = system_text + "\n\n" + ending_block

    result_messages: list[dict] = [{"role": "system", "content": system_text}]

    # Append existing conversation history (already formatted role/content dicts)
    result_messages.extend(messages)

    # If no user turn yet, add the opening prompt
    if not messages:
        result_messages.append(
            {
                "role": "user",
                "content": (
                    f"Start the story! {config.child_name} is {config.child_age} years old "
                    f"and is about to begin a magical adventure. Set the scene and give "
                    f"two exciting choices."
                ),
            }
        )

    return result_messages


async def generate_text(messages: list[dict]) -> str:
    """
    Call OpenRouter with the prepared message list and return the raw text response.
    Falls back to a safe placeholder string on any error.
    """
    models = _get_models()
    model = models["text"]["model"]
    max_tokens = models["text"]["max_tokens"]
    temperature = models["text"]["temperature"]

    try:
        client = get_client()
        response = await client.chat.completions.create(
            model=model,
            messages=messages,
            max_tokens=max_tokens,
            temperature=temperature,
        )
        return response.choices[0].message.content or ""
    except Exception as exc:
        print(f"[text.py] generate_text error ({model}): {exc}")
        # Try fallback model
        try:
            fallback = models["text"].get("fallback_model", "openai/gpt-4o-mini")
            client = get_client()
            response = await client.chat.completions.create(
                model=fallback,
                messages=messages,
                max_tokens=max_tokens,
                temperature=temperature,
            )
            return response.choices[0].message.content or ""
        except Exception as exc2:
            print(f"[text.py] fallback also failed: {exc2}")
            return (
                "Once upon a time, our hero set off on a wonderful adventure. "
                "The path ahead was filled with mystery and magic. "
                "Two roads appeared before them, each leading somewhere special.\n"
                "[Choice A: Take the sunlit forest path]\n"
                "[Choice B: Follow the sparkling stream]"
            )


def parse_response(text: str) -> tuple[str, list[str]]:
    """
    Parse the LLM response into (narrative, choices_list).

    Handles two choice formats:
      - Bracketed:  [Choice A: text]  or  [text]
      - Numbered:   1. text  /  2. text

    Returns:
      narrative     — story text with choice lines removed
      choices_list  — list of choice strings (2–3 items, or [] for ending scenes)
    """
    if not text:
        return "", []

    choices: list[str] = []
    narrative_lines: list[str] = []

    # --- Pattern 1: [Choice A: text] or [Choice B: text] or [text]
    bracketed = re.findall(r"\[(?:Choice\s+[A-Za-z]:\s*)?(.+?)\]", text, re.IGNORECASE)
    if bracketed:
        choices = [c.strip() for c in bracketed if c.strip()]
        # Remove all bracketed choice lines from narrative
        narrative = re.sub(r"\[(?:Choice\s+[A-Za-z]:\s*)?.+?\]", "", text, flags=re.IGNORECASE)
        narrative = narrative.strip()
        return narrative, choices

    # --- Pattern 2: Numbered list  (1. text / 2. text)
    lines = text.split("\n")
    for line in lines:
        stripped = line.strip()
        numbered_match = re.match(r"^[1-3][.)]\s+(.+)$", stripped)
        if numbered_match:
            choices.append(numbered_match.group(1).strip())
        else:
            narrative_lines.append(line)

    if choices:
        narrative = "\n".join(narrative_lines).strip()
        return narrative, choices

    # --- No choices found → this is an ending scene
    return text.strip(), []
