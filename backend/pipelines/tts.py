"""
pipelines/tts.py — Audio generation using GPT-4o Audio Preview.
Configuration (models & prompts) is loaded from YAML files to allow easy tuning.
"""

from __future__ import annotations

import asyncio
import base64
import io
import wave
import yaml
from pathlib import Path

# Import the shared client provider
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

def _load_config(filename: str) -> dict:
    """Loads a YAML configuration file from the config directory."""
    path = _CONFIG_DIR / filename
    if not path.exists():
        # Fallback for tests running in isolation where path might differ
        # or if the file is missing
        print(f"[tts] Warning: Config file {filename} not found at {path}")
        return {}
        
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)

def _create_wav_container(pcm_data: bytes, sample_rate: int = 24000) -> bytes:
    """Wraps raw PCM16 data in a WAV container."""
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
    return True

# ---------------------------------------------------------------------------
# Core Functions
# ---------------------------------------------------------------------------

async def enrich_text_for_audio(text: str) -> str:
    """
    Uses the 'Director' model (configured in models.yaml) to add stage directions.
    """
    client = get_client()
    
    # Load config
    models_cfg = _load_config("models.yaml")
    prompts_cfg = _load_config("prompts.yaml")

    # Safe access to config keys with defaults
    director_model = models_cfg.get("tts", {}).get("director", "openai/gpt-4o-mini")
    system_prompt = prompts_cfg.get("tts", {}).get(
        "enrichment_system", 
        "Add stage directions like [sighs] to the text."
    )

    try:
        response = await client.chat.completions.create(
            model=director_model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": text}
            ],
            temperature=0.7,
            max_tokens=1000
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
    Generates audio from text using the configured Audio model.
    """
    client = get_client()
    
    # Load config
    models_cfg = _load_config("models.yaml")
    prompts_cfg = _load_config("prompts.yaml")
    
    audio_model = models_cfg.get("tts", {}).get("audio_preview", "openai/gpt-4o-audio-preview")

    # 1. Enrich text if requested
    final_text = text
    if expressive:
        print(f"[tts] enriching text using director model...")
        final_text = await enrich_text_for_audio(text)

    # 2. Select System Prompt
    if expressive:
        sys_msg = prompts_cfg.get("tts", {}).get(
            "actor_system", 
            "You are a skilled voice actor. Follow stage directions."
        )
    else:
        sys_msg = prompts_cfg.get("tts", {}).get(
            "narrator_system", 
            "Read the text exactly as written."
        )

    # 3. Call Audio Model with Retry Logic
    for attempt in range(1, _MAX_RETRIES + 1):
        try:
            print(f"[tts] Generating audio (attempt {attempt})...")
            
            stream = await client.chat.completions.create(
                model=audio_model,
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
                
                if hasattr(delta, 'audio') and delta.audio and 'data' in delta.audio:
                    full_audio_b64 += delta.audio['data']

            if not full_audio_b64:
                print(f"[tts] Warning: No audio data received (attempt {attempt}).")
                await asyncio.sleep(_RETRY_BASE_DELAY * attempt)
                continue

            # Decode and Wrap
            pcm_bytes = base64.b64decode(full_audio_b64)
            wav_bytes = _create_wav_container(pcm_bytes)
            
            print(f"[tts] Success. Generated {len(wav_bytes)} bytes.")
            return wav_bytes

        except Exception as e:
            _log_api_error(e, attempt, audio_model)
            if attempt < _MAX_RETRIES:
                await asyncio.sleep(_RETRY_BASE_DELAY * attempt)
            else:
                print("[tts] All attempts exhausted.")
                return b""

    return b""