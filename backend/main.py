import io
import os
import base64
import requests
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, BackgroundTasks, HTTPException, Request, UploadFile, File
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel as _BaseModel
from backend.contracts import (
    StoryState, StoryStatus,
    GenerateRequest, GenerateResponse,
    CharacterRef, AddCharacterRequest,
    AvatarRequest, AvatarResponse,
    ChildConfig, SceneOutput, Choice,
)
from backend.orchestrator.pipeline import process_scene
from backend.pipelines.provider import set_api_key_override
from backend.session_store import session_store, job_store
from backend.safety.filters import sanitize_input
from backend.rag import get_store
from backend.rag.ingest import extract_text_from_pdf
from backend.export_pdf import generate_story_pdf
from utils.download_assets import download_if_missing

# ---------------------------------------------------------------------------
# Mock mode — set MOCK_PIPELINES=true to skip real AI calls (useful for tests)
# ---------------------------------------------------------------------------

MOCK_PIPELINES = os.getenv("MOCK_PIPELINES", "false").lower() == "true"

# Maps session_id → latest job_id so callers can poll status by session_id
_session_to_job: dict[str, str] = {}


class StoryChooseRequest(_BaseModel):
    session_id: str
    choice_id: str = ""
    choice_text: str


# Resolve paths relative to project root (one level above this file's package)
_PROJECT_ROOT   = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_PUBLIC_DIR     = os.path.join(_PROJECT_ROOT, "frontend", "public")
_PUBLIC_PROPS   = os.path.join(_PUBLIC_DIR, "binaries.properties")
_CHILD_PHOTO    = os.path.join(_PUBLIC_DIR, "child_photo_01.png")

# Loaded once at startup; injected into every new session (never sent to client)
_protagonist_image_b64: str | None = None


def _load_protagonist_image() -> str | None:
    if not os.path.exists(_CHILD_PHOTO):
        print(f"[startup] child_photo_01.png not found at {_CHILD_PHOTO} — images will have no reference")
        return None
    with open(_CHILD_PHOTO, "rb") as f:
        data = base64.b64encode(f.read()).decode()
    print(f"[startup] Protagonist reference image loaded ({len(data)} chars base64)")
    return f"data:image/png;base64,{data}"


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _protagonist_image_b64
    # 1. Download any missing public-folder assets (intro video, child photo, etc.)
    if os.path.exists(_PUBLIC_PROPS):
        print("[startup] Checking public assets...")
        download_if_missing(_PUBLIC_PROPS, _PUBLIC_DIR)
    # 2. Load protagonist reference image into memory once
    _protagonist_image_b64 = _load_protagonist_image()
    yield

FRONTEND_URL = os.getenv(
    "FRONTEND_URL", 
    f"http://localhost:{os.getenv('FRONTEND_PORT', '3000')}"
)
app = FastAPI(title="Story Weaver API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_URL], # NOTE: Update to specific domain for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Background task
# ---------------------------------------------------------------------------

async def run_pipeline_task(job_id: str, session_id: str, choice_text: str = "", api_key: str | None = None):
    """
    Run the pipeline for one job.
    """
    # Apply user-provided API key if present
    if api_key:
        set_api_key_override(api_key)

    job = job_store.get(job_id)
    state = session_store.get(session_id)
    if not job or not state:
        return

    # Snapshot: deep-copy so parallel jobs don't race on ss.messages / ss.status
    state_snapshot = state.model_copy(deep=True)
    state_snapshot.job_id = job_id   # tag snapshot so pipeline logs show which job = which artefact

    # Append this branch's choice to the snapshot (not the live session)
    if choice_text:
        state_snapshot.step_number += 1
        state_snapshot.messages.append({
            "role": "user",
            "content": f"[Scene {state_snapshot.step_number}] {choice_text}",
        })

    try:
        scene_result = await process_scene(state_snapshot)
        job.status = StoryStatus.COMPLETE
        job.result = scene_result
        # Store the assistant response so it can be committed to the live session
        # when the user selects this branch.
        last_msg = state_snapshot.messages[-1] if state_snapshot.messages else {}
        if last_msg.get("role") == "assistant":
            job.raw_text = last_msg["content"]

    except Exception as e:
        print(f"[API] Pipeline failed for job={job_id} session={session_id}: {e}")
        job.status = StoryStatus.FAILED
    finally:
        job_store.update(job)


# ---------------------------------------------------------------------------
# Mock pipeline (used when MOCK_PIPELINES=true)
# ---------------------------------------------------------------------------

async def _mock_pipeline_task(job_id: str, session_id: str) -> None:
    """Return synthetic scene data without calling any AI APIs."""
    import asyncio
    await asyncio.sleep(0.1)

    job = job_store.get(job_id)
    state = session_store.get(session_id)
    if not job or not state:
        return

    scene = SceneOutput(
        session_id=session_id,
        step_number=state.step_number,
        is_ending=False,
        story_text=f"{state.config.child_name} went on a magical adventure!",
        choices=[
            Choice(id="c1_mock", text="Follow the glowing path"),
            Choice(id="c2_mock", text="Stay and explore here"),
        ],
    )
    job.status = StoryStatus.COMPLETE
    job.result = scene
    job_store.update(job)
    state.status = StoryStatus.COMPLETE
    state.messages.append({"role": "assistant", "content": scene.story_text})
    session_store.set(session_id, state)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/")
async def root():
    # In production (STATIC_DIR set), serve the frontend; otherwise return API status
    static_dir = os.getenv("STATIC_DIR", "")
    if static_dir:
        index = os.path.join(static_dir, "index.html")
        if os.path.isfile(index):
            from fastapi.responses import FileResponse
            return FileResponse(index)
    return {"status": "ok", "service": "Story Weaver API", "version": "1.0", "mock_mode": MOCK_PIPELINES}

@app.post("/story/validate-key")
async def validate_key(req: Request):
    """Lightweight check to ensure API key works before saving in frontend state."""
    # ADD .strip() right here!
    user_api_key = req.headers.get("x-openrouter-key", "").strip()
    if not user_api_key:
        raise HTTPException(status_code=400, detail="No API Key provided")
    
    def _check_key():
        return requests.get(
            "https://openrouter.ai/api/v1/auth/key", 
            headers={"Authorization": f"Bearer {user_api_key}"}
        )
    
    try:
        res = await asyncio.to_thread(_check_key)
        if res.status_code == 200:
            return {"valid": True}
        else:
            raise HTTPException(status_code=401, detail="Invalid API Key")
    except Exception as e:
        print(f"[API] Key validation network error: {e}")
        raise HTTPException(status_code=500, detail="Could not connect to OpenRouter")

@app.post("/story/start")
async def story_start(config: ChildConfig, background_tasks: BackgroundTasks, req: Request):
    """Simple story-start endpoint: accepts ChildConfig, returns session_id + job_id."""
    user_api_key = req.headers.get("x-openrouter-key")
    safe_config = sanitize_input(config)
    state = StoryState(config=safe_config)
    session_store.set(state.session_id, state)

    job = job_store.create(state.session_id)
    _session_to_job[state.session_id] = job.job_id

    if MOCK_PIPELINES:
        background_tasks.add_task(_mock_pipeline_task, job.job_id, state.session_id)
    else:
        background_tasks.add_task(run_pipeline_task, job.job_id, state.session_id, "", user_api_key)

    return {"session_id": state.session_id, "job_id": job.job_id, "step_number": state.step_number}


@app.post("/story/choose")
async def story_choose(request: StoryChooseRequest, background_tasks: BackgroundTasks, req: Request):
    """Advance the story by committing a choice and firing the next generation."""
    user_api_key = req.headers.get("x-openrouter-key")
    state = session_store.get(request.session_id)
    if not state:
        raise HTTPException(status_code=404, detail="Session not found")

    state.step_number += 1
    state.messages.append({"role": "user", "content": request.choice_text})
    session_store.set(request.session_id, state)

    job = job_store.create(state.session_id)
    _session_to_job[state.session_id] = job.job_id

    if MOCK_PIPELINES:
        background_tasks.add_task(_mock_pipeline_task, job.job_id, request.session_id)
    else:
        background_tasks.add_task(run_pipeline_task, job.job_id, request.session_id, request.choice_text, user_api_key)

    return {"step_number": state.step_number, "session_id": request.session_id, "job_id": job.job_id}


# ---------------------------------------------------------------------------
# Legacy endpoints (/generate/*)
# ---------------------------------------------------------------------------

@app.post("/generate/start")
async def legacy_generate_start(background_tasks: BackgroundTasks):
    """Legacy stub: creates a default session and fires a generation job."""
    config = ChildConfig(child_name="Friend", child_age=5)
    state = StoryState(config=config)
    session_store.set(state.session_id, state)

    job = job_store.create(state.session_id)
    _session_to_job[state.session_id] = job.job_id

    if MOCK_PIPELINES:
        background_tasks.add_task(_mock_pipeline_task, job.job_id, state.session_id)
    else:
        background_tasks.add_task(run_pipeline_task, job.job_id, state.session_id, "")

    return {"session_id": state.session_id, "job_id": job.job_id}


@app.get("/generate/status/{id}")
async def legacy_get_status(id: str):
    """Legacy status endpoint: accepts either job_id or session_id."""
    job = job_store.get(id)
    if not job:
        job_id = _session_to_job.get(id)
        if job_id:
            job = job_store.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return {"status": job.status, "job_id": job.job_id}


@app.post("/story/generate", response_model=GenerateResponse)
async def generate(request: GenerateRequest, background_tasks: BackgroundTasks, req: Request = None):
    """
    Unified generate endpoint for first chapter AND subsequent chapters.
    """
    user_api_key = req.headers.get("x-openrouter-key") if req else None
    if user_api_key:
        set_api_key_override(user_api_key)

    if not request.session_id:
        # ── First chapter ──────────────────────────────────────────────────
        if not request.config or not request.story_idea:
            raise HTTPException(status_code=422, detail="config and story_idea required for first chapter")

        safe_config = sanitize_input(request.config)

        # RAG: search for relevant context from uploaded stories/documents
        rag_context = None
        try:
            store = get_store()
            if store.index.ntotal > 0:
                rag_context = await store.search(request.story_idea, k=3)
                if rag_context:
                    print(f"[API] RAG context found ({len(rag_context)} chars) for idea: {request.story_idea[:60]}")
        except Exception as e:
            print(f"[API] RAG search failed (non-blocking): {e}")

        state = StoryState(
            config=safe_config,
            story_idea=request.story_idea,
            rag_context=rag_context or None,
            messages=[{"role": "user", "content": f"The story idea is: {request.story_idea}"}],
        )

        # Register protagonist: frontend-uploaded photo > server dev fixture > nothing
        ref_image = request.protagonist_image_b64 or _protagonist_image_b64
        if ref_image:
            state.characters[safe_config.child_name.lower()] = CharacterRef(
                name=safe_config.child_name,
                role="protagonist",
                image_b64=ref_image,
            )
            print(f"[API] Protagonist registered for session {state.session_id} ({safe_config.child_name})")
        else:
            print(f"[API] No protagonist image — session {state.session_id} will generate without reference")

        session_store.set(state.session_id, state)

    else:
        # ── Next chapter ───────────────────────────────────────────────────
        if not request.choice_text:
            raise HTTPException(status_code=422, detail="choice_text required for next chapter")

        state = session_store.get(request.session_id)
        if not state:
            raise HTTPException(status_code=404, detail="Session not found")

        if request.prev_job_id and request.prev_job_id != state.last_committed_job_id:
            prev_job = job_store.get(request.prev_job_id)
            if prev_job and prev_job.status == StoryStatus.COMPLETE and prev_job.raw_text:
                # Commit: user choice + assistant response from the selected job
                state.step_number += 1
                state.messages.append({"role": "user", "content": f"[Scene {state.step_number}] {request.prev_choice_text or ''}"})
                state.messages.append({"role": "assistant", "content": prev_job.raw_text})
                state.last_committed_job_id = request.prev_job_id
                session_store.set(state.session_id, state)
                print(f"[API] Committed job {request.prev_job_id} history to session {state.session_id} step={state.step_number}")
            elif prev_job and prev_job.status == StoryStatus.COMPLETE and not prev_job.raw_text:
                print(f"[API] prev_job {request.prev_job_id} has no raw_text — history not committed")
        elif request.prev_job_id and request.prev_job_id == state.last_committed_job_id:
            print(f"[API] Skipping duplicate commit of job {request.prev_job_id} for session {state.session_id}")

    # ── Create job and fire ────────────────────────────────────────────────
    job = job_store.create(state.session_id)
    branch_choice = request.choice_text or ""
    background_tasks.add_task(run_pipeline_task, job.job_id, state.session_id, branch_choice, user_api_key)

    print(f"[API] Job {job.job_id} queued for session {state.session_id} step={state.step_number} choice='{branch_choice[:40]}'")
    return GenerateResponse(session_id=state.session_id, job_id=job.job_id)


@app.post("/story/character")
async def add_character(request: AddCharacterRequest):
    """
    Add or update a side-character reference image for an existing session.
    The image is stored only in server memory for the lifetime of the session.
    """
    state = session_store.get(request.session_id)
    if not state:
        raise HTTPException(status_code=404, detail="Session not found")

    char = request.character
    state.characters[char.name.lower()] = char
    session_store.set(request.session_id, state)
    print(f"[API] Character '{char.name}' ({char.role}) added to session {request.session_id}")
    return {"status": "ok", "character": char.name}


@app.post("/story/avatar", response_model=AvatarResponse)
async def generate_avatar(request: AvatarRequest, req: Request = None):
    """
    Generate a storybook portrait for a named side character.
    """
    from backend.pipelines.image import generate_image
    import base64

    # Apply user API key override if provided
    user_api_key = req.headers.get("x-openrouter-key") if req else None
    if user_api_key:
        set_api_key_override(user_api_key)

    name     = request.name.strip()[:30] or "Character"
    relation = request.relation.strip()[:30]
    desc     = request.description.strip()[:80]

    relation_clause = f", who is {relation} in the family" if relation else ""
    desc_clause     = f" {desc}" if desc else ""

    prompt = (
        f"Children's storybook portrait illustration of a character named {name}"
        f"{relation_clause}.{desc_clause} "
        f"Show just the face and upper body, warm friendly expression. "
        f"Style: soft watercolor children's book illustration, no background text."
    )

    image_bytes = await generate_image(prompt, characters=None)
    if not image_bytes:
        raise HTTPException(status_code=500, detail="Avatar generation failed — please try again.")

    b64 = base64.b64encode(image_bytes).decode()
    return AvatarResponse(image_b64=f"data:image/png;base64,{b64}")


def _resolve_job(id: str):
    """Look up a job by job_id, or fall back to the latest job for a session_id."""
    job = job_store.get(id)
    if not job:
        job_id = _session_to_job.get(id)
        if job_id:
            job = job_store.get(job_id)
    return job


@app.get("/story/status/{id}")
async def get_status(id: str):
    job = _resolve_job(id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return {"status": job.status, "job_id": job.job_id, "session_id": job.session_id}


@app.get("/story/result/{id}")
async def get_result(id: str):
    job = _resolve_job(id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.status == StoryStatus.FAILED:
        raise HTTPException(status_code=500, detail="Story generation failed")

    if job.status != StoryStatus.COMPLETE:
        raise HTTPException(status_code=400, detail="Result not ready")

    return job.result


# ---------------------------------------------------------------------------
# RAG: Document upload, library management, story memory
# ---------------------------------------------------------------------------

@app.post("/story/upload")
async def upload_document(request: Request, file: UploadFile = File(...), source_type: str = "upload"):
    """
    Upload a PDF document for RAG context.
    """
    user_api_key = request.headers.get("x-openrouter-key")
    if user_api_key:
        set_api_key_override(user_api_key)
        
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")

    pdf_bytes = await file.read()
    if len(pdf_bytes) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 10MB).")

    text = extract_text_from_pdf(pdf_bytes)
    if not text.strip():
        raise HTTPException(status_code=400, detail="No text found in PDF.")

    store = get_store()
    chunk_count = await store.add_document(text, file.filename, source_type)

    return {
        "status": "ok",
        "filename": file.filename,
        "source_type": source_type,
        "chunks_added": chunk_count,
        "total_vectors": store.index.ntotal,
    }


@app.get("/story/library")
async def list_library():
    """List all uploaded documents in the RAG store."""
    store = get_store()
    return {
        "files": store.list_files(),
        "total_vectors": store.index.ntotal,
    }


@app.delete("/story/library/{filename}")
async def delete_document(filename: str):
    """Remove a document and its chunks from the RAG store."""
    store = get_store()
    deleted = await store.delete_file(filename)
    if not deleted:
        raise HTTPException(status_code=404, detail="File not found in library.")
    return {"status": "ok", "filename": filename, "total_vectors": store.index.ntotal}


@app.post("/story/memory")
async def save_story_memory(payload: dict, req: Request):
    """
    Save a completed story summary to RAG for cross-session memory.
    """
    user_api_key = req.headers.get("x-openrouter-key")
    if user_api_key:
        set_api_key_override(user_api_key)
        
    summary = payload.get("summary", "")
    child_name = payload.get("child_name", "unknown")
    session_id = payload.get("session_id", "")

    if not summary.strip():
        raise HTTPException(status_code=400, detail="Summary is required.")

    filename = f"story_memory_{child_name}_{session_id[:8]}.txt"
    store = get_store()
    chunk_count = await store.add_document(summary, filename, source_type="story_memory")

    return {"status": "ok", "filename": filename, "chunks_added": chunk_count}


# ---------------------------------------------------------------------------
# PDF Export
# ---------------------------------------------------------------------------

@app.post("/story/export")
async def export_story_pdf(request: dict):
    """
    Generate a PDF booklet from a completed story asynchronously to avoid blocking.
    """
    child_name = request.get("child_name", "Child")
    story_idea = request.get("story_idea", "a bedtime adventure")
    scenes = request.get("scenes", [])

    if not scenes:
        raise HTTPException(status_code=400, detail="No scenes provided.")

    # Run the CPU-bound PDF generation in a separate thread
    pdf_bytes = await asyncio.to_thread(generate_story_pdf, child_name, story_idea, scenes)

    # Stream the bytes back to the client
    return StreamingResponse(
        iter([pdf_bytes]),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="story_{child_name.lower().replace(" ", "_")}.pdf"'
        },
    )


# ---------------------------------------------------------------------------
# SPA Static File Serving (production Docker deployment only)
# Must be LAST — catches all unmatched GET routes and serves frontend.
# ---------------------------------------------------------------------------

_STATIC_DIR = os.getenv("STATIC_DIR", "")
if _STATIC_DIR and os.path.isdir(_STATIC_DIR):
    from fastapi.responses import FileResponse

    @app.get("/{full_path:path}", include_in_schema=False)
    async def _serve_spa(full_path: str):
        file_path = os.path.join(_STATIC_DIR, full_path)
        if full_path and os.path.isfile(file_path):
            return FileResponse(file_path)
        index = os.path.join(_STATIC_DIR, "index.html")
        if os.path.isfile(index):
            return FileResponse(index)
        raise HTTPException(status_code=404)