"""
pipelines/tts.py — Text-to-speech pipeline for Story Weaver.

Functions:
  generate_audio()  — call OpenRouter TTS and return audio bytes
  encode_b64()      — base64-encode bytes to a string for JSON transport
"""

from __future__ import annotations

import base64
from pathlib import Path

import yaml

try:
    from langsmith import traceable
except ImportError:
    def traceable(*args, **kwargs):
        def decorator(fn):
            return fn
        return decorator if args and callable(args[0]) else decorator

from backend.pipelines.provider import get_client

_CONFIG_DIR = Path(__file__).parent.parent / "config"


def _get_models() -> dict:
    with open(_CONFIG_DIR / "models.yaml") as f:
        return yaml.safe_load(f)


async def generate_audio(text: str, voice: str = "onyx") -> bytes:
    """
    Call OpenRouter TTS and return raw audio bytes (mp3).

    Returns empty bytes b"" on any failure so the pipeline never crashes.
    The frontend gracefully handles missing audio.
    """
    if not text or not text.strip():
        return b""

    models = _get_models()
    tts_model = models["tts"]["model"]

    # Truncate very long texts to avoid TTS limits (~4096 chars)
    safe_text = text[:4096] if len(text) > 4096 else text

    try:
        client = get_client()
        # OpenAI TTS API — same interface via OpenRouter
        response = await client.audio.speech.create(
            model=tts_model,
            voice=voice,
            input=safe_text,
            response_format="mp3",
        )
        # AsyncOpenAI returns an AsyncHttpxBinaryResponseContent
        audio_bytes = await response.aread()
        return audio_bytes
    except Exception as exc:
        print(f"[tts.py] generate_audio error: {exc}")
        return b""


def encode_b64(data: bytes) -> str:
    """
    Base64-encode bytes to a UTF-8 string suitable for JSON transport.
    Returns empty string "" for empty/None input.
    """
    if not data:
        return ""
    return base64.b64encode(data).decode("utf-8")
