"""
backend/pipelines/image.py — Storybook illustration generation via Gemini / OpenRouter.

generate_image(prompt, characters) accepts a list of CharacterRef objects so that
the protagonist photo AND any side-character reference images are all passed to the
model in a single multimodal call — exactly the same pattern that works in
tests/test_image_gen.py.

Reference images are NEVER written to disk or returned to the client.
They live only in the per-session StoryState.characters dict (server memory).

KEY NOTES on response parsing
-------------------------------
The OpenAI SDK (v2.x) uses Pydantic with extra="allow", so unknown fields from
OpenRouter (like `message.images`) land in model_extra rather than named attributes.
We therefore read the raw response in two ways:
  1. response.choices[i].message.model_extra.get("images") — Pydantic extra fields
  2. response.model_dump() — Pydantic serialised dict (includes extras in v2)
  3. response.model_extra — top-level extras if choices are wrapped differently

If the model returns only text (it sometimes "describes" the image instead of
generating one), we log a clear TEXT_FALLBACK warning and retry.
"""
from __future__ import annotations

import asyncio
import base64
import json
import re
import traceback
import yaml
from functools import lru_cache
from pathlib import Path
from typing import List, Optional

import httpx
from openai import APIStatusError, APITimeoutError, APIConnectionError

from backend.contracts import CharacterRef
from backend.pipelines.provider import get_client

_CONFIG_DIR = Path(__file__).parent.parent / "config"

# ---------------------------------------------------------------------------
# Retry configuration
# ---------------------------------------------------------------------------

_MAX_RETRIES = 3
_RETRY_BASE_DELAY = 2.0   # seconds — doubles each attempt

# HTTP status codes we consider transient (worth retrying)
_RETRYABLE_STATUS = {429, 500, 502, 503, 504}


# ---------------------------------------------------------------------------
# Model config
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def _get_model() -> str:
    with open(_CONFIG_DIR / "models.yaml") as f:
        cfg = yaml.safe_load(f)
    return cfg["image"]["model"]


# ---------------------------------------------------------------------------
# Prompt builder
# ---------------------------------------------------------------------------

def _build_image_prompt(narrative: str, characters: List[CharacterRef]) -> str:
    style = (
        """Children's storybook illustration, a picture that looks like a child drawings, 
        do not generate text on the picture"""
    )

    if not characters:
        return (
            f"Create a storybook illustration for the following scene.\n\n"
            f"Scene: {narrative}\n\n"
            f"Style: {style}"
        )

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


def _extract_image_from_response(response) -> Optional[bytes | str]:
    """
    Extract image bytes (or a URL to download) from the SDK response object.

    We try four strategies in order, because OpenRouter may put the image in
    different places depending on the model version:

      A) message.model_extra["images"]   — Pydantic extras (most reliable)
      B) message.model_extra["content"]  list of image_url parts
      C) model_dump() dict traversal     — full serialised form
      D) plain-string URL in content     — fallback regex

    Returns:
        bytes  — raw PNG/JPEG bytes decoded from base64
        str    — HTTPS URL the caller should download
        None   — nothing found (caller logs and retries)
    """
    for choice in (response.choices or []):
        msg = choice.message

        # ----------------------------------------------------------------
        # Strategy A: model_extra["images"] list (OpenRouter extension)
        # ----------------------------------------------------------------
        extras = getattr(msg, "model_extra", None) or {}
        images_list = extras.get("images") or []
        for img in images_list:
            url = img.get("url") or (img.get("image_url") or {}).get("url", "")
            if url and "base64," in url:
                return base64.b64decode(url.split("base64,")[1])
            if url and url.startswith("http"):
                return url

        # ----------------------------------------------------------------
        # Strategy B: model_extra["content"] as list of parts
        # ----------------------------------------------------------------
        extra_content = extras.get("content")
        if isinstance(extra_content, list):
            for part in extra_content:
                if isinstance(part, dict) and part.get("type") == "image_url":
                    url = (part.get("image_url") or {}).get("url", "")
                    if url and "base64," in url:
                        return base64.b64decode(url.split("base64,")[1])
                    if url and url.startswith("http"):
                        return url

        # ----------------------------------------------------------------
        # Strategy C: model_dump() — full dict including extras
        # ----------------------------------------------------------------
        try:
            msg_dict = msg.model_dump()
        except Exception:
            msg_dict = {}

        for img in (msg_dict.get("images") or []):
            url = img.get("url") or (img.get("image_url") or {}).get("url", "")
            if url and "base64," in url:
                return base64.b64decode(url.split("base64,")[1])
            if url and url.startswith("http"):
                return url

        if isinstance(msg_dict.get("content"), list):
            for part in msg_dict["content"]:
                if isinstance(part, dict) and part.get("type") == "image_url":
                    url = (part.get("image_url") or {}).get("url", "")
                    if url and "base64," in url:
                        return base64.b64decode(url.split("base64,")[1])
                    if url and url.startswith("http"):
                        return url

        # ----------------------------------------------------------------
        # Strategy D: plain string content — regex for URL or base64 blob
        # ----------------------------------------------------------------
        content_str = msg.content or ""
        if isinstance(content_str, str) and "http" in content_str:
            m = re.search(r"(https?://\S+)", content_str)
            if m:
                return m.group(1)

    return None


def _log_parse_fail(response, attempt: int) -> None:
    """
    Log a rich diagnostic when no image was found in the response.
    Distinguishes between text-only fallback and a genuinely unexpected shape.
    """
    choices = response.choices or []
    if not choices:
        # Try the raw dict for top-level shape issues
        try:
            raw = response.model_dump()
        except Exception:
            raw = {}
        print(
            f"[image_gen] PARSE_FAIL (attempt {attempt}) — no 'choices' in response.\n"
            f"  top-level keys: {list(raw.keys())}\n"
            f"  preview       : {json.dumps(raw)[:500]!r}"
        )
        return

    msg = choices[0].message
    finish = choices[0].finish_reason
    extras = getattr(msg, "model_extra", None) or {}
    content_str = str(msg.content or "")[:400]

    # Detect text-only fallback: model wrote prose instead of generating an image
    text_fallback = bool(content_str.strip()) and not extras.get("images")

    if text_fallback:
        print(
            f"[image_gen] TEXT_FALLBACK (attempt {attempt}) — model returned text "
            f"instead of an image.  finish_reason={finish!r}\n"
            f"  content(400) : {content_str!r}\n"
            f"  extras keys  : {list(extras.keys())}\n"
            f"  → This is a model-side failure; retrying may help."
        )
    else:
        try:
            msg_dump = msg.model_dump()
        except Exception:
            msg_dump = {}
        print(
            f"[image_gen] PARSE_FAIL (attempt {attempt}) — unexpected response shape.\n"
            f"  finish_reason : {finish!r}\n"
            f"  message keys  : {list(msg_dump.keys())}\n"
            f"  extras keys   : {list(extras.keys())}\n"
            f"  content(400)  : {content_str!r}\n"
            f"  images (extra): {extras.get('images')}"
        )


def _log_api_error(exc: Exception, attempt: int, model: str) -> bool:
    """
    Log a structured error and return True if the error is retryable.
    """
    if isinstance(exc, APIStatusError):
        status = exc.status_code
        try:
            body = exc.response.json()
            provider_msg = (
                body.get("error", {}).get("message")
                or body.get("message")
                or json.dumps(body)[:300]
            )
        except Exception:
            provider_msg = str(exc.message)[:300]

        retryable = status in _RETRYABLE_STATUS
        label = "RATE_LIMIT" if status == 429 else ("SERVER_ERROR" if status >= 500 else "CLIENT_ERROR")
        print(
            f"[image_gen] {label} (attempt {attempt}/{_MAX_RETRIES})\n"
            f"  model    : {model}\n"
            f"  status   : {status}\n"
            f"  message  : {provider_msg}\n"
            f"  retryable: {retryable}"
        )
        return retryable

    if isinstance(exc, (APITimeoutError, APIConnectionError)):
        print(
            f"[image_gen] NETWORK_ERROR (attempt {attempt}/{_MAX_RETRIES})\n"
            f"  type     : {type(exc).__name__}\n"
            f"  detail   : {exc}\n"
            f"  retryable: True"
        )
        return True

    print(
        f"[image_gen] UNEXPECTED_ERROR (attempt {attempt}/{_MAX_RETRIES})\n"
        f"  type     : {type(exc).__name__}\n"
        f"  detail   : {exc}\n"
        f"  retryable: False"
    )
    traceback.print_exc()
    return False


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def generate_image(
    prompt: str,
    characters: Optional[List[CharacterRef]] = None,
) -> bytes:
    """
    Generate a storybook illustration using DALL-E 3 via the OpenAI images endpoint.
    Uses OPENAI_API_KEY directly — the modalities["image"] chat approach is not
    supported on OpenRouter for image generation output.

    Args:
        prompt:     The narrative scene text.
        characters: Character refs whose descriptions guide the illustration style.
                    (Reference images are not passed to DALL-E; only text descriptions.)

    Returns:
        Raw PNG bytes, or b"" on failure.
    """
    import os
    from openai import AsyncOpenAI as _AsyncOpenAI

    api_key = os.getenv("OPENAI_API_KEY", "")
    if not api_key:
        print("[image_gen] OPENAI_API_KEY not configured — skipping image generation")
        return b""

    chars = characters or []
    # DALL-E 3 enforces a 4000-character prompt limit
    image_prompt = _build_image_prompt(prompt, chars)[:4000]

    direct_client = _AsyncOpenAI(api_key=api_key)

    for attempt in range(1, _MAX_RETRIES + 1):
        try:
            print(f"[image_gen] Attempt {attempt}/{_MAX_RETRIES}  model=dall-e-3")
            response = await direct_client.images.generate(
                model="dall-e-3",
                prompt=image_prompt,
                size="1024x1024",
                quality="standard",
                n=1,
                response_format="b64_json",
                timeout=90,
            )
            img_b64 = response.data[0].b64_json if response.data else None
            if not img_b64:
                print(f"[image_gen] No image data in response (attempt {attempt}).")
                if attempt < _MAX_RETRIES:
                    await asyncio.sleep(_RETRY_BASE_DELAY * attempt)
                continue
            img_bytes = base64.b64decode(img_b64)
            print(f"[image_gen] Success  size={len(img_bytes)} bytes  attempt={attempt}")
            return img_bytes

        except Exception as exc:
            retryable = _log_api_error(exc, attempt, "dall-e-3")
            if not retryable or attempt == _MAX_RETRIES:
                print(f"[image_gen] Giving up after attempt {attempt}.")
                return b""
            delay = _RETRY_BASE_DELAY * (2 ** (attempt - 1))   # true exponential: 2s, 4s, 8s
            print(f"[image_gen] Retrying in {delay:.1f}s...")
            await asyncio.sleep(delay)

    print(f"[image_gen] All {_MAX_RETRIES} attempts exhausted — returning empty.")
    return b""
