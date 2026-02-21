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

def build_prompt(config: ChildConfig, messages: list[dict], step_number: int, story_idea: str, rag_context: str = None) -> list[dict]:
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

    # 2. Pacing / Ending Injection
    if step_number >= 8:
        system_text += "\n\n" + prompts["forced_ending_instruction"].format(name=config.child_name)
    elif step_number >= 6:
        system_text += "\n\n" + prompts["ending_instruction"].format(name=config.child_name, step=step_number, age=config.child_age)

    msgs = [{"role": "system", "content": system_text}]
    msgs.extend(messages)

    # 3. Inject the "Story Idea" if this is the very first turn (no history)
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
    # (Same parsing logic as before - kept brief for display)
    import re
    choices = []
    # Pattern: [Choice A: text]
    bracketed = re.findall(r"\[(?:Choice\s+[A-Za-z]:\s*)?(.+?)\]", text, re.IGNORECASE)
    if bracketed:
        narrative = re.sub(r"\[.*?\]", "", text).strip()
        return narrative, bracketed
    return text.strip(), []