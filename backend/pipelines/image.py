"""
backend/pipelines/image.py — Storybook illustration generation via Gemini / OpenRouter.

generate_image(prompt, characters) accepts a list of CharacterRef objects so that
the protagonist photo AND any side-character reference images are all passed to the
model in a single multimodal call — exactly the same pattern that works in
tests/test_image_gen.py.

Reference images are NEVER written to disk or returned to the client.
They live only in the per-session StoryState.characters dict (server memory).
"""
from __future__ import annotations

import base64
import re
import yaml
from pathlib import Path
from typing import List, Optional

from backend.contracts import CharacterRef
from backend.pipelines.provider import get_client

_CONFIG_DIR = Path(__file__).parent.parent / "config"


def _get_model() -> str:
    with open(_CONFIG_DIR / "models.yaml") as f:
        cfg = yaml.safe_load(f)
    return cfg["image"]["model"]


# ---------------------------------------------------------------------------
# Prompt builder
# ---------------------------------------------------------------------------

def _build_image_prompt(narrative: str, characters: List[CharacterRef]) -> str:
    style = (
        "Children's storybook illustration, warm painterly style, "
        "vibrant colours, soft lighting, highly detailed, whimsical."
    )

    if not characters:
        return (
            f"Create a storybook illustration for the following scene.\n\n"
            f"Scene: {narrative}\n\n"
            f"Style: {style}"
        )

    # Build a per-character instruction so the model knows which image is which
    char_lines = []
    for c in characters:
        if c.role == "protagonist":
            line = (
                f"- The MAIN CHILD CHARACTER must look exactly like the child "
                f"in the first reference photo (same face, hair, features"
                + (f": {c.description}" if c.description else "")
                + ")."
            )
        else:
            line = (
                f"- The character named '{c.name}' must match their reference photo"
                + (f" ({c.description})" if c.description else "")
                + ". Only include this character if they appear in the scene."
            )
        char_lines.append(line)

    char_block = "\n".join(char_lines)

    return (
        f"Create a storybook illustration for the following scene.\n\n"
        f"Character consistency rules (reference photos are attached in order):\n"
        f"{char_block}\n\n"
        f"Scene: {narrative}\n\n"
        f"Style: {style}"
    )


# ---------------------------------------------------------------------------
# Response parser
# ---------------------------------------------------------------------------

def _normalise_b64(raw: str) -> str:
    """Ensure the string is a proper data-URI."""
    if raw.startswith("data:image"):
        return raw
    return f"data:image/png;base64,{raw}"


def _extract_image_bytes(resp_dict: dict) -> Optional[bytes]:
    """
    Extract image bytes from an OpenRouter/Gemini response.
    Handles three known shapes:
      1. message.images[0].url  (standard OpenRouter image output)
      2. message.content as list of content-part dicts  (type=image_url)
      3. message.content as plain string containing a URL  (rare fallback)
    """
    for choice in resp_dict.get("choices", []):
        message = choice.get("message", {})

        # Shape 1: message has an 'images' list
        for img in message.get("images") or []:
            url = img.get("url") or (img.get("image_url") or {}).get("url", "")
            if url and "base64," in url:
                return base64.b64decode(url.split("base64,")[1])
            if url and url.startswith("http"):
                return url  # type: ignore[return-value]  caller downloads

        # Shape 2: message.content is a list of content-part objects
        content = message.get("content")
        if isinstance(content, list):
            for part in content:
                if part.get("type") == "image_url":
                    url = (part.get("image_url") or {}).get("url", "")
                    if url and "base64," in url:
                        return base64.b64decode(url.split("base64,")[1])
                    if url and url.startswith("http"):
                        return url  # type: ignore[return-value]

        # Shape 3: plain-string content with a URL
        if isinstance(content, str) and "http" in content:
            m = re.search(r"(https?://\S+)", content)
            if m:
                return m.group(1)  # type: ignore[return-value]

    # Nothing found — log what was actually present for diagnostics
    choices = resp_dict.get("choices") or []
    msg_keys = list((choices[0].get("message", {}) if choices else {}).keys())
    print(f"[image_gen] No image in response. message keys: {msg_keys}")
    return None


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def generate_image(
    prompt: str,
    characters: Optional[List[CharacterRef]] = None,
) -> bytes:
    """
    Generate a storybook illustration.

    Args:
        prompt:     The narrative scene text.
        characters: List of CharacterRef objects whose reference images should
                    guide character appearance.  Protagonist first, then side
                    characters.  Pass None / [] for no reference images.

    Returns:
        Raw PNG bytes, or b"" on failure.
    """
    chars = characters or []
    model_name = _get_model()
    client = get_client()

    image_prompt = _build_image_prompt(prompt, chars)

    # Build multimodal content: text instruction first, then reference images in order
    content: list = [{"type": "text", "text": image_prompt}]
    for c in chars:
        data_uri = _normalise_b64(c.image_b64)
        content.append({"type": "image_url", "image_url": {"url": data_uri}})

    try:
        response = await client.chat.completions.create(
            model=model_name,
            messages=[{"role": "user", "content": content}],
            modalities=["image"],
        )

        resp_dict = response.model_dump()
        result = _extract_image_bytes(resp_dict)

        if result is None:
            return b""

        # If result is a URL string, download it
        if isinstance(result, str):
            import httpx
            async with httpx.AsyncClient(timeout=30) as http:
                r = await http.get(result)
                return r.content

        return result

    except Exception as e:
        print(f"[image_gen] Error: {e}")
        return b""
