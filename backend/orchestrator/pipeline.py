"""
orchestrator/pipeline.py — LangGraph-powered Story Weaver pipeline.
"""

from __future__ import annotations

import asyncio
import time
import uuid
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
    """
    ss: StoryState = state["story_state"]
    ss.status = StoryStatus.GENERATING_MEDIA

    narrative = state["narrative"]
    choices_raw = state["choices_raw"]
    voice = ss.config.voice

    # Collect character refs from session: protagonist first, then side characters.
    # Protagonist always goes first so the model prompt attribution is consistent.
    characters = sorted(
        ss.characters.values(),
        key=lambda c: (0 if c.role == "protagonist" else 1, c.name),
    )

    # Create all tasks up front
    # 1. Narration
    narration_audio_task = asyncio.create_task(
        generate_audio(narrative, voice=voice)
    )
    # 2. Main Illustration — pass character refs, not a raw b64 string
    main_image_task = asyncio.create_task(
        generate_image(narrative, characters=characters or None)
    )
    
    # We skip choice media for this iteration to save tokens/time, 
    # but the logic remains if needed later.
    choice_audio_tasks = []
    choice_image_tasks = []

    # Fire all simultaneously
    await asyncio.gather(
        *([narration_audio_task, main_image_task] + choice_audio_tasks + choice_image_tasks),
        return_exceptions=True,
    )

    def _safe(task: asyncio.Task, default: bytes = b"") -> bytes:
        if task.cancelled(): return default
        exc = task.exception()
        if exc:
            print(f"[pipeline] Media task error: {exc}")
            return default
        return task.result()

    return {
        "narration_audio_bytes": _safe(narration_audio_task),
        "main_image_bytes": _safe(main_image_task),
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

    scene = SceneOutput(
        session_id=ss.session_id,
        step_number=ss.step_number,
        is_ending=is_ending,
        story_text=state["narrative"],
        narration_audio_b64=encode_b64(state["narration_audio_bytes"]),
        illustration_b64=encode_b64(state["main_image_bytes"]),
        choices=choices_out,
        generation_time_ms=elapsed_ms,
        safety_passed=safety.passed if safety else True,
    )

    # Persist conversation history in StoryState for next turn
    ss.messages.append({"role": "assistant", "content": state["raw_text"]})
    ss.status = StoryStatus.COMPLETE

    print(
        f"[pipeline] DONE session={ss.session_id} step={ss.step_number} "
        f"time={elapsed_ms}ms safety={'OK' if (not safety or safety.passed) else 'FLAGGED'} "
        f"retries={state['safety_retry_count']}"
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