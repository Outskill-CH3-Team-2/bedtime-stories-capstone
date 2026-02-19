"""
pipelines/image.py — Image generation pipeline for Story Weaver.

generate_image() currently returns a colored placeholder image.
Tamas will wire the real Gemini image generation in a follow-up PR.
The placeholder keeps the pipeline runnable end-to-end immediately.

When real image gen is ready, swap the body of generate_image()
without changing its signature.
"""

from __future__ import annotations

import hashlib
import io
from pathlib import Path
from typing import Optional

import yaml

try:
    from PIL import Image, ImageDraw, ImageFont
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False

try:
    from langsmith import traceable
except ImportError:
    def traceable(*args, **kwargs):
        def decorator(fn):
            return fn
        return decorator if args and callable(args[0]) else decorator

_CONFIG_DIR = Path(__file__).parent.parent / "config"

# Palette of gentle pastel colors used for placeholders
_PALETTE = [
    (255, 220, 180),  # peach
    (180, 220, 255),  # sky blue
    (200, 255, 200),  # mint
    (255, 200, 230),  # rose
    (220, 200, 255),  # lavender
    (255, 245, 180),  # butter yellow
]


def _get_models() -> dict:
    with open(_CONFIG_DIR / "models.yaml") as f:
        return yaml.safe_load(f)


def _make_placeholder(text: str, width: int = 512, height: int = 512) -> bytes:
    """
    Generate a soft pastel placeholder image with the scene description text.
    Uses PIL when available; falls back to a tiny 1×1 PNG if PIL is missing.
    """
    if not PIL_AVAILABLE:
        # 1×1 transparent PNG — zero-dependency absolute fallback
        import base64
        tiny_png = base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk"
            "YPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
        )
        return tiny_png

    # Pick a colour deterministically from the text so the same scene always
    # gets the same colour (stable across retries).
    color_idx = int(hashlib.md5(text.encode()).hexdigest(), 16) % len(_PALETTE)
    bg_color = _PALETTE[color_idx]

    img = Image.new("RGB", (width, height), color=bg_color)
    draw = ImageDraw.Draw(img)

    # Draw a subtle border
    border = 12
    draw.rectangle(
        [border, border, width - border, height - border],
        outline=(max(0, bg_color[0] - 40), max(0, bg_color[1] - 40), max(0, bg_color[2] - 40)),
        width=3,
    )

    # Wrap and center the scene description text
    max_chars = 35
    words = text.split()
    lines = []
    current = ""
    for word in words:
        if len(current) + len(word) + 1 <= max_chars:
            current = (current + " " + word).strip()
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    lines = lines[:8]  # max 8 lines

    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 22)
        small_font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 14)
    except Exception:
        font = ImageFont.load_default()
        small_font = font

    # Draw watermark label at top
    draw.text((width // 2, 30), "✨ Story Weaver ✨", fill=(100, 100, 100), font=small_font, anchor="mm")

    # Draw scene description centered
    line_height = 30
    total_h = len(lines) * line_height
    y_start = (height - total_h) // 2
    for i, line in enumerate(lines):
        draw.text(
            (width // 2, y_start + i * line_height),
            line,
            fill=(60, 60, 60),
            font=font,
            anchor="mm",
        )

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


async def generate_image(
    prompt: str,
    reference_image_b64: Optional[str] = None,
) -> bytes:
    """
    Generate an illustration for the given scene prompt.

    CURRENT BEHAVIOUR: Returns a placeholder pastel image with the prompt text.
    TODO (Tamas): Replace the body below with the real Gemini call.
    The signature must not change — the orchestrator depends on it.

    On any failure, returns placeholder bytes (never raises).
    """
    models = _get_models()
    width = models["image"]["placeholder_width"]
    height = models["image"]["placeholder_height"]

    try:
        # ---------------------------------------------------------------
        # TODO: Replace this block with real Gemini image generation.
        # Example structure (Tamas to implement):
        #
        # client = get_client()
        # resp = await client.images.generate(
        #     model=models["image"]["model"],
        #     prompt=_build_image_prompt(prompt, reference_image_b64),
        #     size=models["image"]["size"],
        #     n=1,
        # )
        # image_url = resp.data[0].url
        # async with httpx.AsyncClient() as http:
        #     raw = await http.get(image_url)
        # return raw.content
        # ---------------------------------------------------------------

        return _make_placeholder(prompt, width, height)

    except Exception as exc:
        print(f"[image.py] generate_image error: {exc}")
        return _make_placeholder(f"[image unavailable] {prompt[:80]}", width, height)
