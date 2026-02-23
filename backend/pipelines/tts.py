"""
pipelines/tts.py — Audio generation using GPT-4o Audio Preview.
Implements the specific streaming + PCM16 logic from test_audio_v03.py.

Error handling
--------------
  - APIStatusError 429 / 5xx  → retryable, exponential backoff
  - APIStatusError 400 / 401  → fatal, logged and empty bytes returned
  - APITimeoutError / APIConnectionError → retryable
  - Stream yields no audio data → logged + retried (model sometimes returns
    only text even when audio is requested)
"""

from __future__ import annotations

import asyncio
import base64
import io
import json
import traceback
import wave
import yaml
from pathlib import Path

from openai import APIStatusError, APITimeoutError, APIConnectionError

from backend.pipelines.provider import get_client

_CONFIG_DIR = Path(__file__).parent.parent / "config"

_MAX_RETRIES = 3
_RETRY_BASE_DELAY = 2.0   # seconds — doubles each attempt
_RETRYABLE_STATUS = {429, 500, 502, 503, 504}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_models() -> dict:
    with open(_CONFIG_DIR / "models.yaml") as f:
        return yaml.safe_load(f)


def _create_wav_container(pcm_data: bytes, sample_rate: int = 24000) -> bytes:
    """
    Wraps raw PCM16 data in a WAV container so browsers/players can handle it.
    Parameters match test_audio_v03.py: Mono (1), 2 bytes (16-bit), 24 kHz.
    """
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setparams((1, 2, sample_rate, 0, "NONE", "not compressed"))
        wav_file.writeframes(pcm_data)
    return buffer.getvalue()


def _log_api_error(exc: Exception, attempt: int, model: str) -> bool:
    """Log the error and return True if it is retryable."""
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
            provider_msg = str(getattr(exc, "message", exc))[:300]

        retryable = status in _RETRYABLE_STATUS
        label = "RATE_LIMIT" if status == 429 else ("SERVER_ERROR" if status >= 500 else "CLIENT_ERROR")
        print(
            f"[tts] {label} (attempt {attempt}/{_MAX_RETRIES})\n"
            f"  model    : {model}\n"
            f"  status   : {status}\n"
            f"  message  : {provider_msg}\n"
            f"  retryable: {retryable}"
        )
        return retryable

    if isinstance(exc, (APITimeoutError, APIConnectionError)):
        print(
            f"[tts] NETWORK_ERROR (attempt {attempt}/{_MAX_RETRIES})\n"
            f"  type     : {type(exc).__name__}\n"
            f"  detail   : {exc}\n"
            f"  retryable: True"
        )
        return True

    print(
        f"[tts] UNEXPECTED_ERROR (attempt {attempt}/{_MAX_RETRIES})\n"
        f"  type     : {type(exc).__name__}\n"
        f"  detail   : {exc}\n"
        f"  retryable: False"
    )
    traceback.print_exc()
    return False


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def generate_audio(text: str, voice: str = "onyx") -> bytes:
    """
    Generate narration audio for the given text.

    Streams PCM16 chunks from gpt-4o-audio-preview, accumulates them, and
    wraps the result in a WAV container.

    Retries up to _MAX_RETRIES times on transient errors or when the stream
    yields no audio data at all (model text-only fallback).

    Returns:
        WAV bytes, or b"" on failure.
    """
    if not text or not text.strip():
        print("[tts] Empty text — skipping audio generation.")
        return b""

    models = _get_models()
    model_name = models["tts"]["model"]
    sample_rate = models["tts"].get("sample_rate", 24000)

    print(
        f"[tts] INPUT TEXT ({len(text)} chars):\n"
        f"  >>> {text!r}"
    )

    messages = [
        {
            "role": "system",
            "content": (
                "You are a professional audiobook narrator for children's bedtime stories. "
                "Read the user's message aloud exactly as written — word for word. "
                "Do NOT add any introduction, greeting, acknowledgement, or commentary. "
                "Begin speaking the text immediately."
            ),
        },
        {
            "role": "user",
            "content": f"Please narrate this text: {text}",
        },
    ]

    client = get_client()

    for attempt in range(1, _MAX_RETRIES + 1):
        try:
            print(f"[tts] Attempt {attempt}/{_MAX_RETRIES}  model={model_name}  voice={voice}")

            stream = await client.chat.completions.create(
                model=model_name,
                modalities=["text", "audio"],
                audio={"voice": voice, "format": "pcm16"},
                messages=messages,
                stream=True,
            )

            full_audio_b64 = ""
            chunk_count = 0
            audio_chunk_count = 0
            finish_reason = None

            async for chunk in stream:
                chunk_count += 1
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta
                fr = chunk.choices[0].finish_reason
                if fr:
                    finish_reason = fr

                # Extract audio data — delta.audio may be a dict or object
                audio_obj = getattr(delta, "audio", None)
                if audio_obj:
                    # SDK may give us a dict or a typed object
                    data = (
                        audio_obj.get("data")
                        if isinstance(audio_obj, dict)
                        else getattr(audio_obj, "data", None)
                    )
                    if data:
                        full_audio_b64 += data
                        audio_chunk_count += 1

            print(
                f"[tts] Stream finished  chunks={chunk_count}  "
                f"audio_chunks={audio_chunk_count}  finish={finish_reason!r}  "
                f"b64_len={len(full_audio_b64)}"
            )

            if not full_audio_b64:
                print(
                    f"[tts] NO_AUDIO_DATA (attempt {attempt}/{_MAX_RETRIES}) — "
                    f"stream yielded {chunk_count} chunks but no audio data.  "
                    f"finish_reason={finish_reason!r}\n"
                    f"  → Model may have returned text-only; retrying."
                )
                if attempt < _MAX_RETRIES:
                    delay = _RETRY_BASE_DELAY * attempt
                    print(f"[tts] Retrying in {delay:.1f}s...")
                    await asyncio.sleep(delay)
                continue

            pcm_bytes = base64.b64decode(full_audio_b64)
            wav_bytes = _create_wav_container(pcm_bytes, sample_rate)
            print(
                f"[tts] Success  pcm={len(pcm_bytes)} bytes  "
                f"wav={len(wav_bytes)} bytes  attempt={attempt}"
            )
            return wav_bytes

        except Exception as exc:
            retryable = _log_api_error(exc, attempt, model_name)
            if not retryable or attempt == _MAX_RETRIES:
                print(f"[tts] Giving up after attempt {attempt}.")
                return b""
            delay = _RETRY_BASE_DELAY * attempt
            print(f"[tts] Retrying in {delay:.1f}s...")
            await asyncio.sleep(delay)

    print(f"[tts] All {_MAX_RETRIES} attempts exhausted — returning empty.")
    return b""


def encode_b64(data: bytes) -> str:
    if not data:
        return ""
    return base64.b64encode(data).decode("utf-8")
