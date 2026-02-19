"""
safety/filters.py — Input sanitization for ChildConfig.

sanitize_input() strips HTML tags, enforces field length limits, and
blocks prompt injection patterns before config data touches any LLM prompt.
"""

from __future__ import annotations

import re
from copy import deepcopy

from backend.contracts import ChildConfig, Personalization

# ---------------------------------------------------------------------------
# Injection pattern detection
# ---------------------------------------------------------------------------

# Patterns commonly used to hijack LLM system prompts
_INJECTION_PATTERNS = [
    r"ignore\s+(all\s+)?previous\s+instructions?",
    r"disregard\s+(all\s+)?previous",
    r"forget\s+(all\s+)?previous",
    r"you\s+are\s+now",
    r"act\s+as\s+(?:if\s+)?(?:a|an|the)\s+\w+",
    r"pretend\s+(?:you\s+are|to\s+be)",
    r"your\s+new\s+(role|persona|instructions?)",
    r"<\s*system\s*>",
    r"\[\s*system\s*\]",
    r"jailbreak",
    r"dan\s+mode",
    r"developer\s+mode",
]

_INJECTION_RE = re.compile(
    "|".join(_INJECTION_PATTERNS),
    flags=re.IGNORECASE,
)

# HTML tag pattern
_HTML_RE = re.compile(r"<[^>]+>")

# Control characters (except normal whitespace)
_CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def _clean_str(value: str, max_len: int) -> str:
    """
    Strip HTML tags, control characters, and enforce max length.
    Returns empty string for None.
    """
    if not value:
        return ""
    # Remove HTML
    value = _HTML_RE.sub("", value)
    # Remove control characters
    value = _CONTROL_RE.sub("", value)
    # Normalise whitespace
    value = " ".join(value.split())
    # Enforce length limit
    return value[:max_len]


def _has_injection(value: str) -> bool:
    return bool(_INJECTION_RE.search(value))


def _safe_str(value: str, max_len: int, field_name: str) -> str:
    cleaned = _clean_str(value, max_len)
    if _has_injection(cleaned):
        print(f"[filters.py] Injection pattern detected in '{field_name}' — clearing field.")
        return ""
    return cleaned


def sanitize_input(config: ChildConfig) -> ChildConfig:
    """
    Return a sanitized copy of ChildConfig.

    Applies to all string fields:
      - Strip HTML tags
      - Remove control characters
      - Normalise whitespace
      - Block prompt injection patterns (field is cleared if detected)
      - Enforce max lengths

    Numeric fields (child_age) are clamped to valid range by Pydantic validators.
    The reference_image_b64 field is left untouched (binary data, not used in prompts).
    """
    # Work on a deep copy so the original is unchanged
    data = config.model_dump()

    # child_name: max 30 chars (matches Field constraint)
    data["child_name"] = _safe_str(data["child_name"], 30, "child_name")
    if not data["child_name"]:
        data["child_name"] = "Friend"  # Safe fallback

    # voice: whitelist of valid OpenAI TTS voices
    valid_voices = {"alloy", "echo", "fable", "onyx", "nova", "shimmer"}
    if data["voice"] not in valid_voices:
        data["voice"] = "onyx"

    # Personalization fields
    p = data["personalization"]
    p["favourite_colour"] = _safe_str(p.get("favourite_colour", ""), 30, "favourite_colour")
    p["favourite_animal"] = _safe_str(p.get("favourite_animal", ""), 30, "favourite_animal")
    p["favourite_food"] = _safe_str(p.get("favourite_food", ""), 30, "favourite_food")
    p["pet_name"] = _safe_str(p.get("pet_name", ""), 30, "pet_name")
    p["pet_type"] = _safe_str(p.get("pet_type", ""), 30, "pet_type")

    # Activities list: sanitize each item, limit to 5 activities, max 40 chars each
    raw_activities = p.get("favourite_activities", [])
    if isinstance(raw_activities, list):
        cleaned_activities = [
            _safe_str(a, 40, "activity")
            for a in raw_activities[:5]
            if isinstance(a, str)
        ]
        p["favourite_activities"] = [a for a in cleaned_activities if a]
    else:
        p["favourite_activities"] = []

    data["personalization"] = p

    return ChildConfig(**data)
