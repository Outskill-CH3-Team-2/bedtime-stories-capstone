"""
backend/pipelines/text.py — Handles prompt construction and LLM calls.
"""
from __future__ import annotations
import yaml
from pathlib import Path
from backend.contracts import ChildConfig
from backend.pipelines.provider import get_client

_CONFIG_DIR = Path(__file__).parent.parent / "config"

def _get_prompts() -> dict:
    with open(_CONFIG_DIR / "prompts.yaml") as f:
        return yaml.safe_load(f)

def _get_models() -> dict:
    with open(_CONFIG_DIR / "models.yaml") as f:
        return yaml.safe_load(f)

def build_prompt(config: ChildConfig, messages: list[dict], step_number: int, story_idea: str = "", rag_context: str = None) -> list[dict]:
    prompts = _get_prompts()
    
    # Format personalization
    p = config.personalization
    details = f"Loves {p.favourite_animal}, color {p.favourite_colour}, food {p.favourite_food}."
    if p.place_to_visit:
        details += f" Dreams of visiting {p.place_to_visit}."

    # 1. System Prompt
    system_text = prompts["story_system_prompt"].format(
        name=config.child_name,
        age=config.child_age,
        details=details
    )

    # 2. RAG context injection
    if rag_context:
        system_text += "\n\n" + prompts["rag_injection"].format(rag_context=rag_context)

    # 3. Pacing / Ending Injection
    if step_number >= 8:
        system_text += "\n\n" + prompts["forced_ending_instruction"].format(name=config.child_name)
    elif step_number >= 6:
        system_text += "\n\n" + prompts["ending_instruction"].format(name=config.child_name, step=step_number, age=config.child_age)

    msgs = [{"role": "system", "content": system_text}]
    msgs.extend(messages)

    # 4. Inject the "Story Idea" if this is the very first turn (no history)
    if not messages:
        msgs.append({
            "role": "user", 
            "content": f"Let's start the story! The idea is: '{story_idea}'. Set the scene."
        })

    return msgs

async def generate_text(messages: list[dict]) -> str:
    models = _get_models()
    client = get_client()
    try:
        response = await client.chat.completions.create(
            model=models["text"]["model"],
            messages=messages,
            max_tokens=models["text"]["max_tokens"],
            temperature=models["text"]["temperature"]
        )
        return response.choices[0].message.content
    except Exception as e:
        print(f"Text Gen Error: {e}")
        return "The story is taking a nap... [Try again]"

def parse_response(text: str):
    """
    Extract (narrative, choices) from the raw LLM output.

    The LLM uses several formats depending on which prompt version ran:
      [Choice A: go left]  [Choice B: go right]   ← old v01 prompt
      [Choice 1] [Choice 2]                        ← current prompt (label only, text inline)
      [go left] [go right]                         ← bare brackets
      1. Go left\n2. Go right                      ← numbered list (NO brackets at all)
      1) Go left\n2) Go right                      ← numbered list with parens

    Strategy
    --------
    1. Try to extract choices from ANY bracket style.
    2. If that fails, try numbered lists.
    3. Strip every extracted choice line from the narrative before returning.
    """
    import re

    # ── 1. Bracket-based extraction ──────────────────────────────────────────
    # Matches:
    #   [Choice A: text]   [Choice A text]   [Choice 1: text]   [Choice 1 text]   [bare text]
    bracketed = re.findall(
        r"\[(?:Choice\s+[\w]+[:\.]?\s*)?(.+?)\]",
        text,
        re.IGNORECASE,
    )
    # Filter out very short noise matches (single words that are just labels like "1")
    bracketed = [c.strip() for c in bracketed if len(c.strip()) > 3]

    if bracketed:
        narrative = re.sub(r"\[.*?\]", "", text).strip()
        # Clean up leftover blank lines
        narrative = re.sub(r"\n{3,}", "\n\n", narrative).strip()
        print(f"[parse_response] bracket mode: {len(bracketed)} choices extracted")
        return narrative, bracketed

    # ── 2. Numbered-list extraction ───────────────────────────────────────────
    # Matches lines like: "1. text", "2) text", "Option 1: text"
    numbered = re.findall(
        r"^\s*(?:Option\s+)?(?:\d+)[.):\-]\s*(.+)$",
        text,
        re.MULTILINE | re.IGNORECASE,
    )
    numbered = [c.strip() for c in numbered if len(c.strip()) > 3]

    if numbered:
        # Strip the numbered-list lines from the narrative
        narrative = re.sub(
            r"^\s*(?:Option\s+)?(?:\d+)[.):\-]\s*.+$", "", text, flags=re.MULTILINE
        ).strip()
        narrative = re.sub(r"\n{3,}", "\n\n", narrative).strip()
        print(f"[parse_response] numbered-list mode: {len(numbered)} choices extracted")
        return narrative, numbered

    # ── 3. No choices found ───────────────────────────────────────────────────
    print(f"[parse_response] no choices found — returning full text as narrative")
    return text.strip(), []