"""
pipelines/tts.py — Audio generation using GPT-4o Audio Preview.
Includes an 'Expressive' mode that uses a cheaper LLM to add stage directions
before generation.
"""

from __future__ import annotations

import asyncio
import base64
import io
import wave
import yaml
from pathlib import Path

# We import the shared client provider
# Ensure this path matches your project structure (backend.pipelines.provider)
try:
    from backend.pipelines.provider import get_client
except ImportError:
    from pipelines.provider import get_client

_CONFIG_DIR = Path(__file__).parent.parent / "config"

# --- Configuration ---
_MAX_RETRIES = 3
_RETRY_BASE_DELAY = 2.0
_DIRECTOR_MODEL = "openai/gpt-4o-mini"   # Cheap, fast model for adding stage directions
_AUDIO_MODEL = "openai/gpt-4o-audio-preview"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _create_wav_container(pcm_data: bytes, sample_rate: int = 24000) -> bytes:
    """
    Wraps raw PCM16 data in a WAV container so it can be played by standard players.
    """
    with io.BytesIO() as wav_buffer:
        with wave.open(wav_buffer, 'wb') as wav_file:
            # 1 channel (mono), 2 bytes (16-bit), sample_rate
            wav_file.setnchannels(1)
            wav_file.setsampwidth(2)
            wav_file.setframerate(sample_rate)
            wav_file.writeframes(pcm_data)
        return wav_buffer.getvalue()

def _log_api_error(exc: Exception, attempt: int, model_name: str) -> bool:
    """Logs errors and returns True if retryable."""
    print(f"[tts] Error on attempt {attempt} ({model_name}): {exc}")
    return True  # Simplified: assume most network/API errors are worth 1 retry

# ---------------------------------------------------------------------------
# Core Functions
# ---------------------------------------------------------------------------

async def enrich_text_for_audio(text: str) -> str:
    """
    Uses a cheap, fast LLM to add stage directions and prosody cues to the text.
    Example input:  "The dragon woke up."
    Example output: "[low growl] The dragon woke up... [yawns loudly]"
    """
    client = get_client()
    
    system_prompt = (
        "You are an expert script doctor for audiobooks. "
        "Your task is to rewrite the user's input slightly to optimize it for "
        "dramatic text-to-speech performance.\n"
        "Rules:\n"
        "1. Insert stage directions in brackets, e.g., [sighs], [whispers], [laughs], [gasps].\n"
        "2. Use punctuation (ellipses '...', italics via caps) to guide pacing.\n"
        "3. DO NOT change the core meaning or words significantly, just enhance the delivery.\n"
        "4. Keep it subtle; don't overdo it."
    )

    try:
        response = await client.chat.completions.create(
            model=_DIRECTOR_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": text}
            ],
            temperature=0.7,
            max_tokens=1000  # Keep it short, usually input length + 20%
        )
        enriched_text = response.choices[0].message.content
        print(f"[tts] Enriched Text: {enriched_text}")
        return enriched_text
    except Exception as e:
        print(f"[tts] Warning: Text enrichment failed ({e}). Using raw text.")
        return text


async def generate_audio(
    text: str, 
    voice: str = "onyx", 
    expressive: bool = True
) -> bytes:
    """
    Generates audio from text.
    
    Args:
        text: The text to read.
        voice: The OpenAI voice ID (alloy, echo, fable, onyx, nova, shimmer).
        expressive: If True, first enriches text with stage directions using a cheap LLM.
    
    Returns:
        WAV-formatted audio bytes.
    """
    client = get_client()

    # 1. Enrich text if requested (The "Director" Step)
    final_text = text
    if expressive:
        print(f"[tts] enriching text for expressive audio...")
        final_text = await enrich_text_for_audio(text)

    # 2. Define System Prompt based on mode (The "Actor" Step)
    if expressive:
        sys_msg = (
            "You are a skilled voice actor performing a bedtime story. "
            "Follow all stage directions (like [laughs], [whispers], [sighs]) accurately. "
            "Use a warm, engaging, and expressive tone appropriate for children."
        )
    else:
        sys_msg = (
            "You are a professional narrator. Read the text exactly as written. "
            "Do not add fillers or non-verbal sounds unless explicitly written."
        )

    # 3. Call Audio Model with Retry Logic
    for attempt in range(1, _MAX_RETRIES + 1):
        try:
            print(f"[tts] Generating audio (attempt {attempt})...")
            
            stream = await client.chat.completions.create(
                model=_AUDIO_MODEL,
                modalities=["text", "audio"],
                audio={"voice": voice, "format": "pcm16"},
                messages=[
                    {"role": "system", "content": sys_msg},
                    {"role": "user", "content": f"Narrate this: {final_text}"}
                ],
                stream=True
            )

            full_audio_b64 = ""
            
            async for chunk in stream:
                if not chunk.choices: 
                    continue
                delta = chunk.choices[0].delta
                
                # Accumulate audio data
                if hasattr(delta, 'audio') and delta.audio and 'data' in delta.audio:
                    full_audio_b64 += delta.audio['data']

            if not full_audio_b64:
                print(f"[tts] Warning: Stream finished but no audio data found (attempt {attempt}).")
                # Basic backoff
                await asyncio.sleep(_RETRY_BASE_DELAY * attempt)
                continue

            # Decode and Wrap
            pcm_bytes = base64.b64decode(full_audio_b64)
            wav_bytes = _create_wav_container(pcm_bytes)
            
            print(f"[tts] Success. Generated {len(wav_bytes)} bytes of audio.")
            return wav_bytes

        except Exception as e:
            _log_api_error(e, attempt, _AUDIO_MODEL)
            if attempt < _MAX_RETRIES:
                await asyncio.sleep(_RETRY_BASE_DELAY * attempt)
            else:
                print("[tts] All attempts exhausted.")
                return b""

    return b""