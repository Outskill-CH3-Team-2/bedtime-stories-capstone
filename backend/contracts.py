"""
backend/contracts.py — Shared data models.
"""

from pydantic import BaseModel, Field
from typing import Optional, List, Dict
from enum import Enum
import uuid

# --- Core Configuration Models ---

class Personalization(BaseModel):
    favourite_colour: str = ""
    favourite_animal: str = ""
    favourite_food: str = ""
    favourite_activities: List[str] = []
    pet_name: str = ""
    pet_type: str = ""
    place_to_visit: str = ""

class ChildConfig(BaseModel):
    child_name: str = Field(..., max_length=30)
    child_age: int = Field(..., ge=3, le=8)
    voice: str = "onyx"
    personalization: Personalization = Personalization()


class CharacterRef(BaseModel):
    """
    A reference image for a named character (child protagonist or side character).
    Stored only in server-side session memory — never persisted to disk or cloud.

    role: "protagonist" for the main child, "side" for recurring side characters.
    image_b64: full data-URI or raw base64 string.
    description: optional one-liner ("brown curly hair, blue eyes") used to reinforce
                 the reference in the image prompt.
    """
    name: str
    role: str = "protagonist"   # "protagonist" | "side"
    image_b64: str              # data:image/...;base64,... OR raw base64
    description: str = ""

# --- API Request Models ---

class StoryStartRequest(BaseModel):
    config: ChildConfig
    story_idea: str                         # e.g. "Going to the dentist"
    protagonist_image_b64: Optional[str] = None  # child photo, sent once at story start

class ChoiceRequest(BaseModel):
    session_id: str
    choice_text: str

class AddCharacterRequest(BaseModel):
    """Add a side-character reference to an existing session."""
    session_id: str
    character: CharacterRef

# --- Pipeline State Models ---

class StoryStatus(str, Enum):
    PENDING = "pending"
    GENERATING_TEXT = "generating_text"
    SAFETY_CHECK = "safety_check"
    GENERATING_MEDIA = "generating_media"
    COMPLETE = "complete"
    FAILED = "failed"

class Choice(BaseModel):
    id: str
    text: str
    audio_b64: str = ""
    image_b64: str = ""

class SceneOutput(BaseModel):
    session_id: str
    step_number: int
    is_ending: bool = False
    story_text: str = ""
    narration_audio_b64: str = ""
    illustration_b64: str = ""
    choices: List[Choice] = []
    generation_time_ms: int = 0
    safety_passed: bool = True

class SafetyResult(BaseModel):
    passed: bool = True
    reason: str = ""
    flags: List[str] = []

class StoryState(BaseModel):
    session_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    step_number: int = 0
    status: StoryStatus = StoryStatus.PENDING
    config: ChildConfig
    story_idea: str = ""
    messages: List[Dict] = []
    safety_flags: List[str] = []
    rag_context: Optional[str] = None
    last_result: Optional[SceneOutput] = None
    # Per-session character registry — stored in server memory only, never sent to client.
    # Key = character name (lowercase), value = CharacterRef with reference image.
    characters: Dict[str, CharacterRef] = {}