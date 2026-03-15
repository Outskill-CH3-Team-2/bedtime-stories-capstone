"""
pipelines/tts.py — Expressive Audio Generation
Uses a 'Director' LLM to add stage directions, then an 'Actor' LLM to perform them.
"""

from __future__ import annotations

import asyncio
import base64
import io
import wave
import yaml
from functools import lru_cache
from pathlib import Path

# Import your shared client provider
try:
    from backend.pipelines.provider import get_client
except ImportError:
    from pipelines.provider import get_client

_CONFIG_DIR = Path(__file__).parent.parent / "config"
_MAX_RETRIES = 3
_RETRY_BASE_DELAY = 2.0

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def _load_models_cfg() -> dict:
    path = _CONFIG_DIR / "models.yaml"
    return yaml.safe_load(path.read_text(encoding="utf-8")) if path.exists() else {}

@lru_cache(maxsize=1)
def _load_prompts_cfg() -> dict:
    path = _CONFIG_DIR / "prompts.yaml"
    return yaml.safe_load(path.read_text(encoding="utf-8")) if path.exists() else {}

def _create_wav_container(pcm_data: bytes, sample_rate: int = 24000) -> bytes:
    """Wraps raw PCM16 data in a WAV container."""
    with io.BytesIO() as wav_buffer:
        with wave.open(wav_buffer, 'wb') as wav_file:
            wav_file.setnchannels(1)
            wav_file.setsampwidth(2)
            wav_file.setframerate(sample_rate)
            wav_file.writeframes(pcm_data)
        return wav_buffer.getvalue()

def _log_api_error(exc: Exception, attempt: int, model_name: str) -> bool:
    print(f"[tts] Error on attempt {attempt} ({model_name}): {exc}")
    return True

def encode_b64(data: bytes) -> str:
    """Helper to convert bytes to a base64 string."""
    return base64.b64encode(data).decode("utf-8")

# ---------------------------------------------------------------------------
# Core Logic
# ---------------------------------------------------------------------------

async def enrich_text_for_audio(text: str) -> str:
    """
    Uses the 'Director' model to add [stage directions] and [sfx cues] to plain text.
    """
    client = get_client()
    models_cfg = _load_models_cfg()
    prompts_cfg = _load_prompts_cfg()

    director_model = models_cfg.get("tts", {}).get("director", "openai/gpt-4o-mini")
    
    # Default prompt fallback if yaml is missing
    default_prompt = (
        "Rewrite the text for a dramatic reading. "
        "Add stage directions in brackets like [whispers] or [laughs]."
    )
    system_prompt = prompts_cfg.get("tts", {}).get("enrichment_system", default_prompt)

    try:
        response = await client.chat.completions.create(
            model=director_model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": text}
            ],
            temperature=0.7,
            max_tokens=1000,
            timeout=30,
        )
        enriched_text = response.choices[0].message.content
        print(f"[tts] Enriched Text: {enriched_text}")
        return enriched_text
    except Exception as e:
        print(f"[tts] Warning: Enrichment failed ({e}). Using raw text.")
        return text

async def generate_audio(
    text: str,
    voice: str = "onyx",
    expressive: bool = True
) -> bytes:
    """
    Generates audio using OpenAI TTS (tts-1) via the standard speech endpoint.
    If expressive=True, a Director LLM first adds stage-direction cues to the text.
    Uses OPENAI_API_KEY directly — OpenRouter does not proxy the audio speech endpoint.
    """
    import os
    from openai import AsyncOpenAI as _AsyncOpenAI

    api_key = os.getenv("OPENAI_API_KEY", "")
    if not api_key:
        print("[tts] OPENAI_API_KEY not set — skipping audio generation")
        return b""

    # Optional enrichment step (non-critical — falls back to raw text on failure)
    final_text = text
    if expressive:
        print("[tts] Director is analyzing script...")
        final_text = await enrich_text_for_audio(text)

    # Direct OpenAI client — the audio.speech endpoint is not available via OpenRouter
    direct_client = _AsyncOpenAI(api_key=api_key)

    for attempt in range(1, _MAX_RETRIES + 1):
        try:
            print(f"[tts] Generating audio via OpenAI TTS (attempt {attempt})...")
            response = await direct_client.audio.speech.create(
                model="tts-1",
                voice=voice,
                input=final_text,
                response_format="wav",
                timeout=60,
            )
            audio_bytes = response.read()
            if not audio_bytes:
                print(f"[tts] Warning: Empty audio response (attempt {attempt}).")
                await asyncio.sleep(_RETRY_BASE_DELAY * attempt)
                continue
            print(f"[tts] Success. Generated {len(audio_bytes)} bytes.")
            return audio_bytes

        except Exception as e:
            _log_api_error(e, attempt, "tts-1")
            if attempt < _MAX_RETRIES:
                await asyncio.sleep(_RETRY_BASE_DELAY * attempt)

    return b""