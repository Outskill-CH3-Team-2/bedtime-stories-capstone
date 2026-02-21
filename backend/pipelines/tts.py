"""
pipelines/tts.py — Audio generation using GPT-4o Audio Preview.
Implements the specific streaming + PCM16 logic from test_audio_v03.py.
"""

from __future__ import annotations

import base64
import io
import wave
import yaml
from pathlib import Path

from backend.pipelines.provider import get_client

_CONFIG_DIR = Path(__file__).parent.parent / "config"

def _get_models() -> dict:
    with open(_CONFIG_DIR / "models.yaml") as f:
        return yaml.safe_load(f)

def _create_wav_container(pcm_data: bytes, sample_rate: int = 24000) -> bytes:
    """
    Wraps raw PCM16 data in a WAV container so browsers/players can handle it.
    Parameters match test_audio_v03.py: Mono (1), 2 bytes (16-bit), 24kHz.
    """
    buffer = io.BytesIO()
    # (nchannels, sampwidth, framerate, nframes, comptype, compname)
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setparams((1, 2, sample_rate, 0, 'NONE', 'not compressed'))
        wav_file.writeframes(pcm_data)
    
    return buffer.getvalue()

async def generate_audio(text: str, voice: str = "onyx") -> bytes:
    """
    Generates audio using the streaming interface of gpt-4o-audio-preview.
    Accumulates chunks, decodes base64, and wraps in a WAV header.
    """
    if not text or not text.strip():
        return b""

    models = _get_models()
    model_name = models["tts"]["model"]
    sample_rate = models["tts"].get("sample_rate", 24000)

    # Use strict system message from the test
    messages = [
        {
            "role": "system", 
            "content": "You are a professional narrator. Your ONLY task is to read the provided text aloud. Do NOT add any introductory remarks, commentary, or conversational responses. Read the text exactly as written."
        },
        {
            "role": "user", 
            "content": f"Please narrate this text: {text}"
        }
    ]

    try:
        client = get_client()
        
        # Streaming call as per test_audio_v03.py
        stream = await client.chat.completions.create(
            model=model_name,
            modalities=["text", "audio"],
            audio={"voice": voice, "format": "pcm16"},
            messages=messages,
            stream=True
        )

        full_audio_base64 = ""
        
        async for chunk in stream:
            if not chunk.choices: 
                continue
            delta = chunk.choices[0].delta
            
            # Extract audio data from delta
            if hasattr(delta, 'audio') and delta.audio and 'data' in delta.audio:
                full_audio_base64 += delta.audio['data']

        if not full_audio_base64:
            print("[tts.py] No audio data received from stream.")
            return b""

        # Decode raw PCM data
        pcm_bytes = base64.b64decode(full_audio_base64)
        
        # Convert to WAV
        return _create_wav_container(pcm_bytes, sample_rate)

    except Exception as exc:
        print(f"[tts.py] generate_audio error: {exc}")
        return b""

def encode_b64(data: bytes) -> str:
    if not data:
        return ""
    return base64.b64encode(data).decode("utf-8")