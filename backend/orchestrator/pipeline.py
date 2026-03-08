"""
orchestrator/pipeline.py — LangGraph-powered Story Weaver pipeline.
"""

from __future__ import annotations

import asyncio
import os
import re
import time
import uuid
from datetime import datetime, timezone
from typing import Optional, TypedDict, Any

from langgraph.graph import StateGraph, END

try:
    from langsmith import traceable
except ImportError:
    def traceable(*args, **kwargs):
        def decorator(fn):
            return fn
        return decorator if args and callable(args[0]) else decorator

from backend.contracts import (
    Choice,
    SceneOutput,
    StoryState,
    StoryStatus,
    SafetyResult,
)
from backend.pipelines.text import build_prompt, generate_text, parse_response
from backend.pipelines.tts import generate_audio, encode_b64
from backend.pipelines.image import generate_image
from backend.safety.classifier import check_content_safety


# ---------------------------------------------------------------------------
# LangGraph State schema
# ---------------------------------------------------------------------------

class PipelineState(TypedDict):
    story_state: Any        # StoryState — typed as Any for LangGraph compat
    t_start: float

    raw_text: str
    narrative: str
    choices_raw: list

    safety: Optional[SafetyResult]
    safety_retry_count: int

    narration_audio_bytes: bytes
    main_image_bytes: bytes
    choice_audio_bytes: list   # list[bytes]
    choice_image_bytes: list   # list[bytes]

    scene_output: Optional[SceneOutput]


def _initial_state(story_state: StoryState) -> PipelineState:
    return PipelineState(
        story_state=story_state,
        t_start=time.monotonic(),
        raw_text="",
        narrative="",
        choices_raw=[],
        safety=None,
        safety_retry_count=0,
        narration_audio_bytes=b"",
        main_image_bytes=b"",
        choice_audio_bytes=[],
        choice_image_bytes=[],
        scene_output=None,
    )


# ---------------------------------------------------------------------------
# Graph Nodes
# ---------------------------------------------------------------------------

async def node_generate_text(state: PipelineState) -> dict:
    """Stage 1: Build prompt from StoryState, call OpenRouter, parse response."""
    ss: StoryState = state["story_state"]
    ss.status = StoryStatus.GENERATING_TEXT

    # --- FIXED HERE: Added story_idea argument ---
    messages = build_prompt(
        config=ss.config,
        messages=ss.messages,
        step_number=ss.step_number,
        story_idea=ss.story_idea,  # <--- PASSED FROM STATE
        rag_context=ss.rag_context,
    )
    
    raw_text = await generate_text(messages)
    narrative, choices_raw = parse_response(raw_text)

    return {
        "raw_text": raw_text,
        "narrative": narrative,
        "choices_raw": choices_raw,
    }


async def node_safety_check(state: PipelineState) -> dict:
    """Stage 2: Classify narrative for child-appropriateness via LLM."""
    ss: StoryState = state["story_state"]
    ss.status = StoryStatus.SAFETY_CHECK

    safety = await check_content_safety(state["narrative"])

    if not safety.passed:
        ss.safety_flags.extend(safety.flags)
        print(
            f"[pipeline] Safety FAILED session={ss.session_id} "
            f"step={ss.step_number} flags={safety.flags} "
            f"retry_count={state['safety_retry_count']}"
        )

    return {"safety": safety}


async def node_retry_text(state: PipelineState) -> dict:
    """Stage 2b: Re-generate text with a safety nudge after a failed check."""
    ss: StoryState = state["story_state"]
    ss.status = StoryStatus.GENERATING_TEXT

    # --- FIXED HERE: Added story_idea argument ---
    messages = build_prompt(
        config=ss.config,
        messages=ss.messages,
        step_number=ss.step_number,
        story_idea=ss.story_idea, # <--- PASSED FROM STATE
        rag_context=ss.rag_context,
    )

    messages.append({
        "role": "user",
        "content": (
            "Please rewrite the story scene. Keep it gentle, warm, and "
            "age-appropriate for young children ages 3-8. "
            "Avoid anything scary, sad, or violent."
        ),
    })

    raw_text = await generate_text(messages)
    narrative, choices_raw = parse_response(raw_text)

    return {
        "raw_text": raw_text,
        "narrative": narrative,
        "choices_raw": choices_raw,
        "safety_retry_count": state["safety_retry_count"] + 1,
    }


async def node_generate_media(state: PipelineState) -> dict:
    """
    Stage 3: Parallel media generation using asyncio.gather.
    Skips TTS and/or image generation when the corresponding VITE_TEST_*
    env vars are set — the frontend will substitute local test assets instead,
    saving API costs during development.
    """
    ss: StoryState = state["story_state"]
    ss.status = StoryStatus.GENERATING_MEDIA

    narrative = state["narrative"]
    voice = ss.config.voice

    skip_audio = bool(os.getenv("VITE_TEST_AUDIO", "").strip())
    skip_image = bool(os.getenv("VITE_TEST_IMAGE", "").strip())

    # Strip choice-question lines before TTS — the LLM sometimes appends
    # "Where should Arlo go? / Should he..." directly into the narrative prose,
    # which causes the narrator to read the option text aloud.
    tts_narrative = _narrative_for_tts(narrative)

    print(
        f"[pipeline] Generating media  job={ss.job_id}  session={ss.session_id}  step={ss.step_number}\n"
        f"  skip_audio={skip_audio}  skip_image={skip_image}\n"
        f"  narrative(120)    : {narrative[:120]!r}\n"
        f"  tts_narrative(120): {tts_narrative[:120]!r}"
    )

    # Build only the tasks we actually need
    narration_audio_task: Optional[asyncio.Task] = None
    main_image_task: Optional[asyncio.Task] = None

    if skip_audio:
        print(f"[pipeline] SKIPPING TTS GENERATION (VITE_TEST_AUDIO is set)")
    else:
        narration_audio_task = asyncio.create_task(
            generate_audio(tts_narrative, voice=voice)
        )

    if skip_image:
        print(f"[pipeline] SKIPPING IMAGE GENERATION (VITE_TEST_IMAGE is set)")
    else:
        # Collect character refs: protagonist first, then side characters.
        characters = sorted(
            ss.characters.values(),
            key=lambda c: (0 if c.role == "protagonist" else 1, c.name),
        )
        main_image_task = asyncio.create_task(
            generate_image(narrative, characters=characters or None)
        )

    active_tasks = [t for t in (narration_audio_task, main_image_task) if t is not None]
    if active_tasks:
        await asyncio.gather(*active_tasks, return_exceptions=True)

    def _safe(task: Optional[asyncio.Task], label: str, default: bytes = b"") -> bytes:
        if task is None:
            return default
        if task.cancelled():
            print(f"[pipeline] job={ss.job_id} {label} task was CANCELLED")
            return default
        exc = task.exception()
        if exc:
            print(f"[pipeline] job={ss.job_id} {label} task raised: {type(exc).__name__}: {exc}")
            return default
        result = task.result()
        if not result:
            print(f"[pipeline] job={ss.job_id} {label} returned EMPTY bytes — generation failed (see above logs)")
        else:
            print(f"[pipeline] job={ss.job_id} {label} OK  size={len(result)} bytes")
        return result

    audio_bytes = _safe(narration_audio_task, "AUDIO")
    image_bytes = _safe(main_image_task, "IMAGE")

    return {
        "narration_audio_bytes": audio_bytes,
        "main_image_bytes": image_bytes,
        "choice_audio_bytes": [],
        "choice_image_bytes": [],
    }


async def node_assemble(state: PipelineState) -> dict:
    """Stage 4: Encode all media as base64, build SceneOutput, update StoryState."""
    ss: StoryState = state["story_state"]
    choices_raw = state["choices_raw"]
    safety: Optional[SafetyResult] = state["safety"]

    is_ending = (ss.step_number >= 8) or (not choices_raw)

    choices_out: list[Choice] = []
    for i, text in enumerate(choices_raw):
        choices_out.append(
            Choice(
                id=f"c{i + 1}_{uuid.uuid4().hex[:6]}",
                text=text,
                audio_b64="", # Skipped for speed
                image_b64="", # Skipped for speed
            )
        )

    elapsed_ms = int((time.monotonic() - state["t_start"]) * 1000)

    # Use the same stripped narrative that TTS used, so displayed text matches audio exactly.
    display_text = _narrative_for_tts(state["narrative"])

    scene = SceneOutput(
        session_id=ss.session_id,
        step_number=ss.step_number,
        is_ending=is_ending,
        story_text=display_text,
        narration_audio_b64=encode_b64(state["narration_audio_bytes"]),
        illustration_b64=encode_b64(state["main_image_bytes"]),
        choices=choices_out,
        generation_time_ms=elapsed_ms,
        safety_passed=safety.passed if safety else True,
    )

    # Persist conversation history in StoryState for next turn
    ss.messages.append({"role": "assistant", "content": state["raw_text"]})
    ss.status = StoryStatus.COMPLETE

    audio_bytes = state["narration_audio_bytes"]
    image_bytes = state["main_image_bytes"]

    print(
        f"\n{'='*60}\n"
        f"[pipeline] JOB DUMP  job={ss.job_id}  session={ss.session_id}  step={ss.step_number}\n"
        f"  time        : {elapsed_ms}ms\n"
        f"  safety      : {'OK' if (not safety or safety.passed) else 'FLAGGED'}  retries={state['safety_retry_count']}\n"
        f"  display_text: {display_text[:300]!r}\n"
        f"  audio_bytes : {len(audio_bytes)} bytes {'OK' if audio_bytes else 'EMPTY!'}\n"
        f"  image_bytes : {len(image_bytes)} bytes {'OK' if image_bytes else 'EMPTY!'}\n"
        f"  choices     : {[c.text for c in choices_out]}\n"
        f"{'='*60}\n"
    )

    # ── Write debug artefacts to disk (only when DEBUG=true) ─────────────────
    if os.getenv("DEBUG", "").lower() == "true":
        _write_debug_artefacts(
            job_id=ss.job_id,
            session_id=ss.session_id,
            step=ss.step_number,
            text=display_text,
            audio_bytes=audio_bytes,
            image_bytes=image_bytes,
        )

    return {"scene_output": scene}


# ---------------------------------------------------------------------------
# Conditional Edge Router
# ---------------------------------------------------------------------------

MAX_SAFETY_RETRIES = 1

def route_safety(state: PipelineState) -> str:
    safety: SafetyResult = state["safety"]
    retries: int = state["safety_retry_count"]

    if safety.passed:
        return "generate_media"

    if retries < MAX_SAFETY_RETRIES:
        return "retry_text"

    print(
        f"[pipeline] Safety retries exhausted (max={MAX_SAFETY_RETRIES}) "
        "— proceeding fail-open to preserve UX."
    )
    return "generate_media"


# ---------------------------------------------------------------------------
# Graph Construction
# ---------------------------------------------------------------------------

def _build_graph() -> StateGraph:
    g = StateGraph(PipelineState)

    g.add_node("generate_text",  node_generate_text)
    g.add_node("safety_check",   node_safety_check)
    g.add_node("retry_text",     node_retry_text)
    g.add_node("generate_media", node_generate_media)
    g.add_node("assemble",       node_assemble)

    g.set_entry_point("generate_text")

    g.add_edge("generate_text",  "safety_check")
    g.add_edge("retry_text",     "safety_check")
    g.add_edge("generate_media", "assemble")
    g.add_edge("assemble",        END)

    g.add_conditional_edges(
        "safety_check",
        route_safety,
        {
            "retry_text":     "retry_text",
            "generate_media": "generate_media",
        },
    )

    return g


_compiled_graph = _build_graph().compile()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Directory where debug artefacts (text / audio / image) are written.
_DEBUG_OUTPUT_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "backend", "debug_output",
)


def _write_debug_artefacts(
    *,
    job_id: str,
    session_id: str,
    step: int,
    text: str,
    audio_bytes: bytes,
    image_bytes: bytes,
) -> None:
    """
    Write text / audio / image artefacts to backend/debug_output/.
    File names: {timestamp}_{job_id}_step{step}.{ext}
    """
    try:
        os.makedirs(_DEBUG_OUTPUT_DIR, exist_ok=True)
        ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        stem = f"{ts}_{job_id}_step{step}"

        txt_path   = os.path.join(_DEBUG_OUTPUT_DIR, f"{stem}.txt")
        audio_path = os.path.join(_DEBUG_OUTPUT_DIR, f"{stem}.wav")
        image_path = os.path.join(_DEBUG_OUTPUT_DIR, f"{stem}.png")

        with open(txt_path, "w", encoding="utf-8") as f:
            f.write(f"job_id    : {job_id}\n")
            f.write(f"session_id: {session_id}\n")
            f.write(f"step      : {step}\n")
            f.write(f"timestamp : {ts}\n")
            f.write(f"\n{text}\n")

        if audio_bytes:
            with open(audio_path, "wb") as f:
                f.write(audio_bytes)

        if image_bytes:
            with open(image_path, "wb") as f:
                f.write(image_bytes)

        print(
            f"[pipeline] debug artefacts written → {stem}  "
            f"txt={os.path.getsize(txt_path)}B  "
            f"audio={len(audio_bytes)}B  "
            f"image={len(image_bytes)}B"
        )
    except Exception as exc:
        print(f"[pipeline] WARNING: failed to write debug artefacts: {exc}")


# Patterns that signal the start of the "choice question" section in the narrative.
# Everything from the first match onward is stripped before TTS so the narrator
# only reads the story prose, not the choice options.
_CHOICE_QUESTION_RE = re.compile(
    r"(\n\s*\n"                               # blank line separator
    r"(?:"
    r"(?:where|what|which|how|who)\s+(?:does|should|will|would|can|do|did|is)\b"
    r"|"
    r"(?:should\s+(?:he|she|they|arlo)\b)"
    r"|"
    r"(?:or\s+(?:perhaps|maybe)\b)"
    r"|"
    r"\[choice"
    r"))",
    re.IGNORECASE,
)


def _narrative_for_tts(narrative: str) -> str:
    """
    Return only the story prose portion of the narrative, stripping any
    choice-question lines that the LLM sometimes embeds at the end.

    Example input:
        "Arlo walked into the forest...  \\n\\nWhere should Arlo go next?\\nShould he..."
    Example output:
        "Arlo walked into the forest..."
    """
    m = _CHOICE_QUESTION_RE.search(narrative)
    if m:
        trimmed = narrative[: m.start()].strip()
        if trimmed:
            print(f"[pipeline] TTS: stripped {len(narrative) - len(trimmed)} chars of choice-question from narrative")
            return trimmed
    return narrative


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

@traceable(name="process_scene")
async def process_scene(story_state: StoryState) -> SceneOutput:
    """
    Run the LangGraph pipeline for one story scene.
    """
    initial = _initial_state(story_state)

    try:
        final: PipelineState = await _compiled_graph.ainvoke(initial)
        scene = final.get("scene_output")
        if scene is None:
            raise RuntimeError("Graph completed but scene_output is None")
        return scene

    except Exception as exc:
        import traceback
        print("\n" + "!"*50)
        print(f"CRITICAL PIPELINE ERROR for session {story_state.session_id}")
        print(f"Error: {exc}")
        traceback.print_exc()
        print("!"*50 + "\n")
        
        story_state.status = StoryStatus.FAILED
        return SceneOutput(
            session_id=story_state.session_id,
            step_number=story_state.step_number,
            is_ending=False,
            story_text="The story is taking a moment to load — please try again!",
            choices=[
                Choice(id="c1_fallback", text="Continue the adventure"),
                Choice(id="c2_fallback", text="Start a new story"),
            ],
            generation_time_ms=0,
            safety_passed=True,
        )