import os
import pytest
import asyncio
import base64
import wave
import io
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime

# to run the test: pytest tests/test_tts_gen.py -v -m integration
# or pytest tests/test_tts_gen.py -v -m "not integration"
# or pytest tests/test_tts_gen.py -v
# or pytest tests/test_tts_gen.py -v -m integration -k "enrichment"
# Adjust the import based on your actual function name in pipelines/tts.py
# Assuming the main function is named 'generate_audio' or similar based on the context.
# If your function is named differently (e.g. 'generate_speech'), please update this import.
from backend.pipelines.tts import generate_audio, _create_wav_container

# -----------------------------------------------------------------------------
# Fixtures & Helpers
# -----------------------------------------------------------------------------

@pytest.fixture
def mock_openai_client():
    """
    Creates a mock AsyncOpenAI client with a mocked chat.completions.create method.
    """
    mock_client = AsyncMock()
    # Ensure the create method is an AsyncMock so we can await it
    mock_client.chat.completions.create = AsyncMock()
    return mock_client

def create_mock_chunk(audio_data_b64: str):
    """Helper to create a mock OpenAI API chunk object structure."""
    chunk = MagicMock()
    choice = MagicMock()
    choice.delta.audio = {'data': audio_data_b64}
    chunk.choices = [choice]
    return chunk

def is_valid_wav(audio_bytes: bytes) -> bool:
    """Checks if bytes start with RIFF and WAVE headers."""
    if len(audio_bytes) < 44:
        return False
    try:
        with io.BytesIO(audio_bytes) as f:
            with wave.open(f, 'rb') as wav_file:
                return wav_file.getnchannels() > 0
    except wave.Error:
        return False
    except Exception:
        return False

# -----------------------------------------------------------------------------
# Unit Tests (Mocked)
# -----------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_generate_audio_success(mock_openai_client):
    """
    Test successful audio generation where the API returns valid base64 PCM chunks.
    We mock the provider.get_client to return our mock_openai_client.
    """
    # 1. Prepare Mock Data
    # "UklGRg==" is "RIFF" in base64, just some dummy data to simulate PCM
    dummy_pcm_b64 = base64.b64encode(b"\x00\x00\x00\x00").decode("utf-8")
    
    # Setup the mock stream to yield chunks
    mock_stream = AsyncMock()
    mock_stream.__aiter__.return_value = [
        create_mock_chunk(dummy_pcm_b64),
        create_mock_chunk(dummy_pcm_b64)
    ]
    mock_openai_client.chat.completions.create.return_value = mock_stream

    # 2. Patch the get_client to return our mock
    with patch("backend.pipelines.tts.get_client", return_value=mock_openai_client):
        
        # 3. Call the function under test
        input_text = "Hello world"
        audio_bytes = await generate_audio(input_text)

        # 4. Assertions
        assert audio_bytes is not None
        assert len(audio_bytes) > 0
        # Check if it has a WAV header (RIFF...)
        assert audio_bytes.startswith(b"RIFF") 
        assert b"WAVE" in audio_bytes[:16]
        
        # TTS pipeline calls the API twice: once for the director (enrichment) and
        # once for the actor (narration). Verify both calls were made.
        assert mock_openai_client.chat.completions.create.await_count == 2
        # The final (actor) call uses the audio-preview model
        final_call_args = mock_openai_client.chat.completions.create.await_args[1]
        assert final_call_args["model"] == "openai/gpt-4o-audio-preview"

@pytest.mark.asyncio
async def test_generate_audio_handles_empty_stream(mock_openai_client):
    """
    Test behavior when the API returns a stream with no audio data (empty chunks).
    Should handle gracefully (likely return empty bytes or raise specific error).
    """
    mock_stream = AsyncMock()
    mock_stream.__aiter__.return_value = [] # No chunks
    mock_openai_client.chat.completions.create.return_value = mock_stream

    with patch("backend.pipelines.tts.get_client", return_value=mock_openai_client):
        # We expect it might return empty bytes or print an error and return b"" 
        # based on the tts.py snippet provided (retry logic).
        # To speed up test, we might want to mock the sleep or max_retries, 
        # but here we assume it eventually returns empty bytes.
        with patch("asyncio.sleep", return_value=None): # Skip sleep delays
            audio_bytes = await generate_audio("Text causing empty response")
            
            # Implementation specific: typically returns empty bytes on total failure
            assert audio_bytes == b""

@pytest.mark.asyncio
async def test_wav_container_creation():
    """
    Unit test strictly for the helper function _create_wav_container 
    to ensure it writes valid headers.
    """
    # 1 second of silence at 24kHz (2 bytes per sample * 24000 samples)
    dummy_pcm = b'\x00\x00' * 24000 
    
    wav_bytes = _create_wav_container(dummy_pcm, sample_rate=24000)
    
    assert len(wav_bytes) > len(dummy_pcm) # Header adds size
    
    # Read back with standard library to verify validity
    with io.BytesIO(wav_bytes) as f:
        with wave.open(f, 'rb') as wav:
            assert wav.getnchannels() == 1
            assert wav.getsampwidth() == 2
            assert wav.getframerate() == 24000
            assert wav.getnframes() == 24000

# -----------------------------------------------------------------------------
# Integration Test (Requires API Key)
# -----------------------------------------------------------------------------

@pytest.mark.integration
@pytest.mark.asyncio
async def test_generate_audio_e2e_integration():
    """
    REAL API CALL.
    Run this only when explicitly requested to verify integration with OpenRouter/OpenAI.
    Usage: pytest -m integration
    """
    input_text = "This is a brief integration test."
    
    # This will use the real get_client and real environment variables
    try:
        audio_bytes = await generate_audio(input_text)
        
        assert len(audio_bytes) > 1000 # Expecting significant data
        assert is_valid_wav(audio_bytes)
        print(f"Integration success: Generated {len(audio_bytes)} bytes.")
        
    except Exception as e:
        pytest.fail(f"Integration test failed: {e}")
        
# -----------------------------------------------------------------------------
# Expressive Audio Tests (Saves files for listening)
# -----------------------------------------------------------------------------

@pytest.mark.integration
@pytest.mark.parametrize("emotion, text_prompt", [
    ("neutral", "This is a standard reading test to establish a baseline."),
    ("happy_giggle", "Oh my gosh! [giggles] I can't believe that actually worked!"),
    ("sad_sigh", "[sighs] It has been such a long, hard day... I just want to rest."),
    ("whisper", "[whispering] Shhh. Keep your voice down. They might hear us."),
    ("excited", "Hurry! Look at that! It's amazing! [gasps]"),
])
@pytest.mark.asyncio
async def test_generate_expressive_samples(emotion, text_prompt):
    """
    Generates audio with specific emotional cues and saves them to 'tests/artifacts'.
    Open the .wav files to hear if the model obeyed the stage directions.
    """
    # 1. Create artifacts directory if it doesn't exist
    output_dir = os.path.join(os.path.dirname(__file__), "artifacts")
    os.makedirs(output_dir, exist_ok=True)

    print(f"\n[Audio] Generating '{emotion}' sample...")

    # 2. Call your real pipeline (Make sure to use the patch fix from before if needed, 
    #    but since this is integration, we want the REAL generate_audio)
    try:
        from backend.pipelines.tts import generate_audio
    except ImportError:
        from pipelines.tts import generate_audio

    # 3. Generate Audio
    audio_bytes = await generate_audio(text_prompt)
    
    # 4. Save to file
    timestamp = datetime.now().strftime("%H%M%S")
    filename = f"tts_{emotion}_{timestamp}.wav"
    filepath = os.path.join(output_dir, filename)

    with open(filepath, "wb") as f:
        f.write(audio_bytes)

    # 5. Verify and Log
    assert len(audio_bytes) > 0, "Audio should not be empty"
    assert audio_bytes.startswith(b"RIFF"), "Should be a valid WAV file"
    
    print(f"   -> Saved to: {filepath}")
    print(f"   -> Size: {len(audio_bytes)/1024:.1f} KB")    
    
@pytest.mark.integration
@pytest.mark.asyncio
async def test_auto_enrichment():
    """
    Test that plain text gets automatically expanded with stage directions 
    and saves the audio so you can hear the difference.
    """
    # 1. Setup paths
    output_dir = os.path.join(os.path.dirname(__file__), "artifacts")
    os.makedirs(output_dir, exist_ok=True)
    
    # 2. Input: A sentence that begs for emotion but has none written
    plain_text = "I am so scared of the dark, please don't leave me alone here."
    
    print(f"\n[Audio] Testing Auto-Enrichment on: '{plain_text}'")

    # 3. Call with expressive=True to trigger the "Director" LLM
    #    (Make sure you have the patch/import logic from before if needed, 
    #     but for integration tests, direct import is best)
 
    from backend.pipelines.tts import generate_audio


    audio_bytes = await generate_audio(plain_text, expressive=True)
    
    # 4. Save to file
    timestamp = datetime.now().strftime("%H%M%S")
    filename = f"tts_auto_enriched_{timestamp}.wav"
    filepath = os.path.join(output_dir, filename)

    with open(filepath, "wb") as f:
        f.write(audio_bytes)

    # 5. Verification
    assert len(audio_bytes) > 0
    print(f"   -> Saved to: {filepath}")
    print(f"   -> Listen to hear if it added [trembling] or [whispering]!")
    
@pytest.mark.integration
@pytest.mark.asyncio
async def test_actor_mimic_sfx():
    """
    Test the 'One-Shot' SFX approach where the model mimics sounds itself.
    We explicitly ask for non-verbal sounds in the text.
    """
    # 1. Setup paths
    output_dir = os.path.join(os.path.dirname(__file__), "artifacts")
    os.makedirs(output_dir, exist_ok=True)
    
    # 2. Input: A script requiring vocal sound effects
    # We use phonetic spelling + stage directions to help the model.
    sfx_script = (
        "The old house was silent. [wind howling] Whooooo... Whooooo... "
        "Suddenly, the floorboards groaned. [creaking sound] Creeeeaaaaak. "
        "I froze. [heart beating loudly] Thump-thump. Thump-thump. "
        "Then, from the darkness... [evil laughter] Mwahahahaha!"
    )
    
    print(f"\n[Audio] Testing Actor Mimicry on: '{sfx_script[:50]}...'")

    try:
        from backend.pipelines.tts import generate_audio
    except ImportError:
        from pipelines.tts import generate_audio

    # 3. Generate (expressive=True allows the system prompt to enforce acting)
    audio_bytes = await generate_audio(sfx_script, expressive=True)
    
    # 4. Save to file
    timestamp = datetime.now().strftime("%H%M%S")
    filename = f"tts_mimic_sfx_{timestamp}.wav"
    filepath = os.path.join(output_dir, filename)

    with open(filepath, "wb") as f:
        f.write(audio_bytes)

    assert len(audio_bytes) > 0
    print(f"   -> Saved to: {filepath}")
    print(f"   -> Listen to verify if the model 'became' the wind and the door!")    