"""
orchestrator/pipeline.py — LangGraph-powered Story Weaver pipeline.

The pipeline is modelled as a directed graph (StateGraph) with conditional
routing. Each node is a pure async function that receives the current
PipelineState and returns a partial dict merged back into state.

Graph topology:
  START
    └─▶ generate_text
          └─▶ safety_check
                ├─▶ (passed OR retries exhausted) generate_media
                │                                   └─▶ assemble ─▶ END
                └─▶ (failed, retries left) retry_text
                                             └─▶ safety_check (loop)

LangGraph concepts used:
  StateGraph         — typed DAG with merge-dict semantics per node
  TypedDict state    — every key update is shallow-merged, not replaced
  Conditional edge   — route_safety() inspects state to pick next node
  ainvoke()          — async graph execution for FastAPI compatibility
  @traceable         — applied to process_scene() (top level) for LangSmith
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
# Note: StoryState is stored as Any to avoid LangSmith's RunnableConfig
# collision (langsmith @traceable inspects the first arg with .get()).
# We cast it back to StoryState inside each node.

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
# (NOT decorated with @traceable — avoids LangSmith RunnableConfig collision.
#  Tracing happens at the process_scene() wrapper level instead.)
# ---------------------------------------------------------------------------

async def node_generate_text(state: PipelineState) -> dict:
    """Stage 1: Build prompt from StoryState, call OpenRouter, parse response."""
    ss: StoryState = state["story_state"]
    ss.status = StoryStatus.GENERATING_TEXT

    messages = build_prompt(
        config=ss.config,
        messages=ss.messages,
        step_number=ss.step_number,
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

    messages = build_prompt(
        config=ss.config,
        messages=ss.messages,
        step_number=ss.step_number,
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

    All narration audio, illustration, choice audio, and choice images
    are fired simultaneously — this is the critical latency optimization.
    """
    ss: StoryState = state["story_state"]
    ss.status = StoryStatus.GENERATING_MEDIA

    ref_b64 = ss.config.reference_image_b64
    narrative = state["narrative"]
    choices_raw = state["choices_raw"]
    voice = ss.config.voice

    # Create all tasks up front
    narration_audio_task = asyncio.create_task(
        generate_audio(narrative, voice=voice)
    )
    main_image_task = asyncio.create_task(
        generate_image(narrative, reference_image_b64=ref_b64)
    )
    choice_audio_tasks = [
        asyncio.create_task(generate_audio(c, voice=voice))
        for c in choices_raw
    ]
    choice_image_tasks = [
        asyncio.create_task(generate_image(c, reference_image_b64=ref_b64))
        for c in choices_raw
    ]

    # Fire all simultaneously
    await asyncio.gather(
        *([narration_audio_task, main_image_task] + choice_audio_tasks + choice_image_tasks),
        return_exceptions=True,
    )

    def _safe(task: asyncio.Task, default: bytes = b"") -> bytes:
        if task.cancelled():
            return default
        exc = task.exception()
        if exc:
            print(f"[pipeline] Media task error: {exc}")
            return default
        return task.result()

    return {
        "narration_audio_bytes": _safe(narration_audio_task),
        "main_image_bytes": _safe(main_image_task),
        "choice_audio_bytes": [_safe(t) for t in choice_audio_tasks],
        "choice_image_bytes": [_safe(t) for t in choice_image_tasks],
    }


async def node_assemble(state: PipelineState) -> dict:
    """Stage 4: Encode all media as base64, build SceneOutput, update StoryState."""
    ss: StoryState = state["story_state"]
    choices_raw = state["choices_raw"]
    safety: Optional[SafetyResult] = state["safety"]

    is_ending = (ss.step_number >= 8) or (not choices_raw)

    choices_out: list[Choice] = []
    for i, text in enumerate(choices_raw):
        a_bytes = state["choice_audio_bytes"][i] if i < len(state["choice_audio_bytes"]) else b""
        i_bytes = state["choice_image_bytes"][i] if i < len(state["choice_image_bytes"]) else b""
        choices_out.append(
            Choice(
                id=f"c{i + 1}_{uuid.uuid4().hex[:6]}",
                text=text,
                audio_b64=encode_b64(a_bytes),
                image_b64=encode_b64(i_bytes),
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
    """
    Routing function called after node_safety_check.

    Returns the name of the next node:
      "retry_text"     — content flagged, retry budget remaining
      "generate_media" — content safe OR retries exhausted (fail-open)
    """
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

    # Nodes
    g.add_node("generate_text",  node_generate_text)
    g.add_node("safety_check",   node_safety_check)
    g.add_node("retry_text",     node_retry_text)
    g.add_node("generate_media", node_generate_media)
    g.add_node("assemble",       node_assemble)

    # Entry
    g.set_entry_point("generate_text")

    # Static edges
    g.add_edge("generate_text",  "safety_check")
    g.add_edge("retry_text",     "safety_check")   # loop back after retry
    g.add_edge("generate_media", "assemble")
    g.add_edge("assemble",        END)

    # Conditional edge: safety_check outcome routes to retry or media
    g.add_conditional_edges(
        "safety_check",
        route_safety,
        {
            "retry_text":     "retry_text",
            "generate_media": "generate_media",
        },
    )

    return g


# Compiled once at import time — reused for every scene call
_compiled_graph = _build_graph().compile()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

@traceable(name="process_scene")
async def process_scene(story_state: StoryState) -> SceneOutput:
    """
    Run the LangGraph pipeline for one story scene.

    Mutates story_state.status and story_state.messages in place.
    Returns SceneOutput on success, or a safe fallback on any unhandled error.
    """
    initial = _initial_state(story_state)

    try:
        final: PipelineState = await _compiled_graph.ainvoke(initial)
        scene = final.get("scene_output")
        if scene is None:
            raise RuntimeError("Graph completed but scene_output is None")
        return scene

    except Exception as exc:
        print(f"[pipeline] Unhandled graph error for {story_state.session_id}: {exc}")
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
