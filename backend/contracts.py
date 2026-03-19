"""
backend/contracts.py — Shared data models.
"""

from pydantic import BaseModel, Field
from typing import Optional, List, Dict
from enum import Enum
import uuid

# --- Core Configuration Models ---

class FamilyMemberInfo(BaseModel):
    name: str = ""
    relation: str = ""

class Personalization(BaseModel):
    favourite_colour: str = ""
    favourite_animal: str = ""
    favourite_food: str = ""
    favourite_activity: str = ""          # single activity from frontend
    favourite_activities: List[str] = []  # legacy list form
    pet_name: str = ""
    pet_type: str = ""
    place_to_visit: str = ""
    friend_name: str = ""
    companions: List[FamilyMemberInfo] = []  # pets, friends, etc. with actual roles
    siblings: List[FamilyMemberInfo] = []
    parents: List[FamilyMemberInfo] = []
    grandparents: List[FamilyMemberInfo] = []

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

# --- API Request/Response Models ---

class GenerateRequest(BaseModel):
    """
    Unified generate endpoint — first chapter or next chapter.

    First chapter:  session_id=None, config+story_idea required.
    Next chapter:   session_id set, choice_text set (the branch to pre-generate).

    Pre-generation: fire one request per available choice immediately after
    displaying a scene — all branches generate in parallel.

    Committing selected history: on the NEXT round of pre-generation, pass
    prev_job_id + prev_choice_text so the backend can commit the selected
    branch's conversation history before snapshotting for new jobs.

    Returns job_id immediately; poll /story/status/{job_id} then
    fetch /story/result/{job_id}.
    """
    # --- first chapter only ---
    config: Optional[ChildConfig] = None
    story_idea: Optional[str] = None
    protagonist_image_b64: Optional[str] = None

    # --- next chapter only ---
    session_id: Optional[str] = None
    choice_text: Optional[str] = None      # branch to generate for this job

    # --- history commit (next chapter only, first call of a new round) ---
    prev_job_id: Optional[str] = None      # job_id the user selected last round
    prev_choice_text: Optional[str] = None # choice text they selected (for history)

class GenerateResponse(BaseModel):
    session_id: str
    job_id: str

class AddCharacterRequest(BaseModel):
    """Add a side-character reference to an existing session."""
    session_id: str
    character: CharacterRef

class AvatarRequest(BaseModel):
    """Generate a storybook portrait for a named character."""
    name: str
    relation: str = ""
    description: str = ""    # optional appearance hints

class AvatarResponse(BaseModel):
    image_b64: str            # data:image/png;base64,... URI

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

class JobState(BaseModel):
    """Tracks a single generation job (one chapter for one choice branch)."""
    job_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    session_id: str
    status: StoryStatus = StoryStatus.PENDING
    result: Optional[SceneOutput] = None  # filled when COMPLETE
    raw_text: str = ""                    # LLM raw response — committed to session on user selection

class SafetyResult(BaseModel):
    passed: bool = True
    reason: str = ""
    flags: List[str] = []

class StoryState(BaseModel):
    session_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    job_id: str = ""          # set by main.py so pipeline logs can tag which job produced each artefact
    step_number: int = 0
    status: StoryStatus = StoryStatus.PENDING
    config: ChildConfig
    story_idea: str = ""
    messages: List[Dict] = []
    safety_flags: List[str] = []
    rag_context: Optional[str] = None
    # Tracks which prev_job_id has already been committed so duplicate prefire
    # calls (one per choice) don't double-append the same history turn.
    last_committed_job_id: str = ""
    # Per-session character registry — stored in server memory only, never sent to client.
    # Key = character name (lowercase), value = CharacterRef with reference image.
    characters: Dict[str, CharacterRef] = {}
    # User-provided OpenRouter API key (stored in session memory only, never persisted)
    #api_key_override: Optional[str] = None