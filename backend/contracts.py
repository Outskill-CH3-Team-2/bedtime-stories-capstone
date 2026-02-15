"""
contracts.py — Pydantic models shared across all Story Weaver pipeline modules.
These are the single source of truth for data shapes; import from here everywhere.
"""

from pydantic import BaseModel, Field
from typing import Optional
from enum import Enum
import uuid


class Personalization(BaseModel):
    favourite_colour: str = ""
    favourite_animal: str = ""
    favourite_food: str = ""
    favourite_activities: list[str] = []
    pet_name: str = ""
    pet_type: str = ""


class ChildConfig(BaseModel):
    child_name: str = Field(..., max_length=30)
    child_age: int = Field(..., ge=3, le=8)
    voice: str = "onyx"
    reference_image_b64: Optional[str] = None
    personalization: Personalization = Personalization()


class StoryStatus(str, Enum):
    PENDING = "pending"
    GENERATING_TEXT = "generating_text"
    SAFETY_CHECK = "safety_check"
    GENERATING_MEDIA = "generating_media"
    COMPLETE = "complete"
    FAILED = "failed"


class SafetyResult(BaseModel):
    passed: bool = True
    reason: str = ""
    flags: list[str] = []


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
    choices: list[Choice] = []
    generation_time_ms: int = 0
    safety_passed: bool = True


class StoryState(BaseModel):
    session_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    step_number: int = 0
    status: StoryStatus = StoryStatus.PENDING
    config: ChildConfig
    messages: list[dict] = []
    safety_flags: list[str] = []
    rag_context: Optional[str] = None
