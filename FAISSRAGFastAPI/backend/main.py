import asyncio
import io
import os
import re
import base64
import uuid
import json
import logging
import shutil
import threading
from pathlib import Path
from datetime import datetime, timezone
from typing import Any, Optional, Annotated
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, UploadFile, File, Depends
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel as _BaseModel, Field


from backend.contracts import (
    StoryState, StoryStatus,
    GenerateRequest, GenerateResponse,
    CharacterRef, AddCharacterRequest,
    ChildConfig, SceneOutput, Choice,
)
from backend.orchestrator.pipeline import process_scene
from backend.session_store import session_store, job_store
from backend.safety.filters import sanitize_input, sanitize_text_field
from utils.download_assets import download_if_missing

try:
    import numpy as np
    import fitz  # PyMuPDF
    import faiss
    import ebooklib
    from ebooklib import epub
    from bs4 import BeautifulSoup
    from sentence_transformers import SentenceTransformer
    from langchain_text_splitters import RecursiveCharacterTextSplitter
    _RAG_IMPORT_ERROR: Exception | None = None
except Exception as e:
    np = None  # type: ignore[assignment]
    fitz = None  # type: ignore[assignment]
    faiss = None  # type: ignore[assignment]
    ebooklib = None  # type: ignore[assignment]
    epub = None  # type: ignore[assignment]
    BeautifulSoup = None  # type: ignore[assignment]
    SentenceTransformer = None  # type: ignore[assignment]
    RecursiveCharacterTextSplitter = None  # type: ignore[assignment]
    _RAG_IMPORT_ERROR = e

# ---------------------------------------------------------------------------
# Mock mode — set MOCK_PIPELINES=true to skip real AI calls (useful for tests)
# ---------------------------------------------------------------------------

MOCK_PIPELINES = os.getenv("MOCK_PIPELINES", "false").lower() == "true"

# ---------------------------------------------------------------------------
# RAG configuration
# ---------------------------------------------------------------------------
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("story-api")

OPENAI_API_KEY       = os.getenv("OPENAI_API_KEY", "")
EMBEDDING_MODEL_NAME = os.getenv("EMBEDDING_MODEL", "all-MiniLM-L6-v2")
UPLOAD_DIR           = Path("uploads")
FAISS_STORE_DIR      = Path("faiss_store")
STORY_WORD_COUNTS    = {"5_minutes": 700, "10_minutes": 1400, "15_minutes": 2100}
MAX_UPLOAD_BYTES     = int(os.getenv("MAX_UPLOAD_MB", "50")) * 1024 * 1024
MAX_AUDIO_B64_CHARS  = 10_000_000   # ~7.5 MB of raw audio

# Maps age_group string from StoryRequest → ChildConfig.child_age (int)
_AGE_GROUP_MAP: dict[str, int] = {
    "3-5": 4, "4-6": 5, "5-7": 6, "6-8": 7,
    "3":   3, "4":   4, "5":   5, "6":   6, "7": 7, "8": 8,
}

_vs_instance: Optional["FAISSVectorStoreManager"] = None

# Maximum messages kept in a live session's history.
# Each step adds ~2 messages (user choice + assistant story); 8 steps = 16 msgs.
# Capping at 24 prevents unbounded growth for unusually long sessions.
_MAX_HISTORY_MESSAGES = 24


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


class FAISSVectorStoreManager:
    def __init__(self, store_dir: Path, model_name: str):
        if _RAG_IMPORT_ERROR is not None:
            raise RuntimeError(f"RAG dependencies unavailable: {_RAG_IMPORT_ERROR}")

        self.store_dir = store_dir
        self.store_dir.mkdir(parents=True, exist_ok=True)
        self.lock = threading.Lock()
        self.model_status = "loading"

        try:
            logger.info(f"Initializing SentenceTransformer: {model_name}")
            assert SentenceTransformer is not None  # guarded by _RAG_IMPORT_ERROR check above
            self.encoder = SentenceTransformer(model_name)
            self.dim = self.encoder.get_sentence_embedding_dimension()
            self.model_status = "ready"
        except Exception as e:
            self.model_status = f"error: {str(e)}"
            logger.critical(f"Encoder Load Failed: {e}")
            raise

        self.index = faiss.IndexFlatL2(self.dim)
        self.metadata: list[dict[str, Any]] = []
        self.files_registry: dict[str, dict[str, Any]] = {}
        self.load()

    def persist(self) -> None:
        with self.lock:
            try:
                faiss.write_index(self.index, str(self.store_dir / "index.faiss"))
                with open(self.store_dir / "store_data.json", "w") as f:
                    json.dump({"metadata": self.metadata, "registry": self.files_registry}, f, indent=2)
            except Exception as e:
                logger.error(f"Persistence Failed: {e}")

    def load(self) -> None:
        idx_path  = self.store_dir / "index.faiss"
        meta_path = self.store_dir / "store_data.json"
        if idx_path.exists() and meta_path.exists() and idx_path.stat().st_size > 0:
            try:
                self.index = faiss.read_index(str(idx_path))
                with open(meta_path, "r") as f:
                    data = json.load(f)
                    self.metadata       = data.get("metadata", [])
                    self.files_registry = data.get("registry", {})
                logger.info(f"Loaded {self.index.ntotal} vectors.")
            except Exception as e:
                logger.error(f"Corruption during load: {e}. Starting fresh.")

    def add_documents(self, chunks: list[str], metas: list[dict[str, Any]]) -> int:
        embeddings = self.encoder.encode(chunks, convert_to_numpy=True).astype(np.float32)
        with self.lock:
            self.index.add(embeddings)
            for i, text in enumerate(chunks):
                metas[i]["content"] = text
                self.metadata.append(metas[i])
        self.persist()
        return len(chunks)

    def remove_file(self, file_id: str) -> int:
        """
        Remove all chunks belonging to file_id from the index and metadata.
        Rebuilds the FAISS index from the remaining vectors.
        Returns the number of chunks removed.
        """
        with self.lock:
            keep_indices = [i for i, m in enumerate(self.metadata) if m.get("file_id") != file_id]
            removed = len(self.metadata) - len(keep_indices)
            if removed == 0:
                return 0

            kept_meta = [self.metadata[i] for i in keep_indices]
            # Re-encode kept chunks and rebuild the index
            kept_texts = [m["content"] for m in kept_meta]
            assert faiss is not None and np is not None  # guarded by __init__ check
            self.index = faiss.IndexFlatL2(self.dim)
            if kept_texts:
                embeddings = self.encoder.encode(kept_texts, convert_to_numpy=True).astype(np.float32)
                self.index.add(embeddings)
            self.metadata = kept_meta
            self.files_registry.pop(file_id, None)
        self.persist()
        return removed

    def similarity_search(self, query: str, k: int = 5) -> list[dict[str, Any]]:
        if self.index.ntotal == 0:
            return []
        query_vec = self.encoder.encode([query], convert_to_numpy=True).astype(np.float32)
        distances, indices = self.index.search(query_vec, k)
        results: list[dict[str, Any]] = []
        for dist, idx in zip(distances[0], indices[0]):
            if idx != -1 and idx < len(self.metadata):
                item = self.metadata[idx].copy()
                item["score"] = float(1 / (1 + dist))
                results.append(item)
        return results


def parse_document(file_path: Path) -> list[dict[str, Any]]:
    pages: list[dict[str, Any]] = []
    ext = file_path.suffix.lower()
    try:
        if ext == ".pdf":
            with fitz.open(str(file_path)) as doc:
                for i, page in enumerate(doc):
                    text = page.get_text().strip()
                    if len(text) > 50:
                        pages.append({"text": text, "source": file_path.name, "page": i + 1})
        elif ext == ".epub":
            book = epub.read_epub(str(file_path))
            for i, item in enumerate(book.get_items_of_type(ebooklib.ITEM_DOCUMENT)):
                soup = BeautifulSoup(item.get_content(), "html.parser")
                text = soup.get_text().strip()
                if len(text) > 50:
                    pages.append({"text": text, "source": file_path.name, "chapter": i + 1})
    except Exception as e:
        logger.error(f"Parsing Failed for {file_path.name}: {e}")
    return pages


def _cleanup_stale_uploads(max_age_hours: int = 1) -> None:
    """Delete any files in UPLOAD_DIR older than max_age_hours.

    This catches uploads left behind by a previous process that crashed
    before it could delete them after FAISS indexing.
    """
    import time as _time
    if not UPLOAD_DIR.exists():
        return
    cutoff = _time.time() - max_age_hours * 3600
    removed = 0
    for f in UPLOAD_DIR.iterdir():
        if f.is_file() and f.stat().st_mtime < cutoff:
            try:
                f.unlink()
                removed += 1
            except OSError:
                pass
    if removed:
        logger.info(f"[startup] Removed {removed} stale upload(s) older than {max_age_hours}h.")


def _init_rag_services() -> None:
    global _vs_instance
    UPLOAD_DIR.mkdir(exist_ok=True)
    _cleanup_stale_uploads()
    if _RAG_IMPORT_ERROR is not None:
        # Log the specific missing package so it's actionable from startup logs
        logger.warning(
            f"[RAG] Optional packages not installed — RAG endpoints disabled.\n"
            f"  Error: {_RAG_IMPORT_ERROR}\n"
            f"  Fix:   pip install -r requirements.txt"
        )
        return
    try:
        _vs_instance = FAISSVectorStoreManager(FAISS_STORE_DIR, EMBEDDING_MODEL_NAME)
        logger.info(f"[RAG] Vector store ready — {_vs_instance.index.ntotal} chunks indexed.")
    except Exception as e:
        logger.error(
            f"[RAG] FAISSVectorStoreManager init failed: {type(e).__name__}: {e}\n"
            f"  Story pipeline will run without RAG context."
        )
        _vs_instance = None


_RAG_INJECTION_PATTERNS = re.compile(
    r"ignore\s+(all\s+)?previous\s+instructions?"
    r"|disregard\s+(all\s+)?previous"
    r"|forget\s+(all\s+)?previous"
    r"|you\s+are\s+now"
    r"|act\s+as\s+(?:if\s+)?(?:a|an|the)\s+\w+"
    r"|pretend\s+(?:you\s+are|to\s+be)"
    r"|your\s+new\s+(?:role|persona|instructions?)"
    r"|<\s*system\s*>"
    r"|\[\s*system\s*\]"
    r"|jailbreak"
    r"|developer\s+mode",
    re.IGNORECASE,
)


def _sanitize_rag_chunk(chunk: str) -> str:
    """Strip prompt-injection patterns from a RAG-retrieved text chunk."""
    if _RAG_INJECTION_PATTERNS.search(chunk):
        logger.warning("[RAG] Injection pattern detected in retrieved chunk — chunk removed.")
        return ""
    # Also strip HTML and control characters (same as filters.py)
    chunk = re.sub(r"<[^>]+>", "", chunk)
    chunk = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", chunk)
    return chunk.strip()


async def _fetch_rag_context(query: str) -> str | None:
    """
    Run a similarity search against the FAISS store and return a sanitized
    context string for injection into the story pipeline.

    Each retrieved chunk is screened for prompt-injection patterns before
    being included.  Returns None if RAG is unavailable, the index is empty,
    or all chunks are filtered out.
    """
    if _vs_instance is None or _vs_instance.model_status != "ready":
        return None
    if not query.strip():
        return None
    try:
        hits = await run_in_threadpool(_vs_instance.similarity_search, query, 5)
        if not hits:
            return None
        # Sanitize every chunk before injection
        clean_chunks = [_sanitize_rag_chunk(h["content"]) for h in hits]
        clean_chunks = [c for c in clean_chunks if c]
        if not clean_chunks:
            logger.warning("[RAG] All retrieved chunks were filtered — skipping context injection.")
            return None
        context = "\n---\n".join(clean_chunks)
        logger.info(f"[RAG] Retrieved {len(clean_chunks)}/{len(hits)} clean chunks")
        return context
    except Exception as e:
        logger.warning(f"[RAG] similarity_search failed: {type(e).__name__}: {e}")
        return None


def get_vs() -> FAISSVectorStoreManager:
    """FastAPI dependency for RAG-only endpoints that strictly require the vector store."""
    if _RAG_IMPORT_ERROR is not None:
        raise HTTPException(
            503,
            detail=f"RAG packages not installed: {_RAG_IMPORT_ERROR}. Run: pip install -r requirements.txt",
        )
    if _vs_instance is None:
        raise HTTPException(
            503,
            detail="Vector store failed to initialize at startup — check server logs for details.",
        )
    if _vs_instance.model_status != "ready":
        raise HTTPException(
            503,
            detail=f"Embedding model not ready (status: {_vs_instance.model_status}).",
        )
    return _vs_instance



@asynccontextmanager
async def lifespan(app: FastAPI):
    global _protagonist_image_b64
    # 1. Start session / job cleanup background tasks
    session_store.start_cleanup_task()
    job_store.start_cleanup_task()
    # 2. Download any missing public-folder assets (intro video, child photo, etc.)
    if os.path.exists(_PUBLIC_PROPS):
        print("[startup] Checking public assets...")
        download_if_missing(_PUBLIC_PROPS, _PUBLIC_DIR)
    # 3. Load protagonist reference image into memory once
    _protagonist_image_b64 = _load_protagonist_image()
    # 4. Initialize optional RAG services
    _init_rag_services()
    yield
    # Shutdown: cancel background tasks cleanly
    session_store.stop_cleanup_task()
    job_store.stop_cleanup_task()

app = FastAPI(title="Story Weaver API", lifespan=lifespan)

# Allowed origins: comma-separated list in CORS_ALLOWED_ORIGINS env var.
# Defaults to localhost dev ports.  Override in production with your real domain.
_CORS_ORIGINS = [
    o.strip()
    for o in os.getenv(
        "CORS_ALLOWED_ORIGINS",
        "http://localhost:5173,http://localhost:5174,http://localhost:3000",
    ).split(",")
    if o.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type"],
)


# ---------------------------------------------------------------------------
# Background task
# ---------------------------------------------------------------------------

async def run_pipeline_task(job_id: str, session_id: str, choice_text: str = ""):
    """
    Run the pipeline for one job.

    Each job works on a snapshot of the session state so that parallel
    pre-generation jobs (one per choice branch) don't corrupt each other's
    conversation history.  The choice_text for this branch is appended to the
    snapshot before running so the LLM sees the correct context.

    RAG context is fetched here (if the vector store is ready) and injected
    into the snapshot before the pipeline runs.  The live session is never
    mutated; rag_context is job-scoped.
    """
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

    # ── Inject RAG context into the snapshot ──────────────────────────────
    # Build a query from the most relevant signal available for this job:
    # for step 1 use the story idea; for later steps use the chosen branch text.
    rag_query = choice_text.strip() or state_snapshot.story_idea or ""
    rag_context = await _fetch_rag_context(rag_query)
    if rag_context:
        state_snapshot.rag_context = rag_context
        print(f"[API] RAG context injected for job={job_id} session={session_id} ({len(rag_context)} chars)")
    else:
        # Keep whatever was already in the session (may be None)
        # — don't overwrite with None if a previous turn stored context.
        if state_snapshot.rag_context is None:
            print(f"[API] No RAG context available for job={job_id} (store empty or not ready)")

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
    rag_status = "unavailable"
    if _RAG_IMPORT_ERROR is None:
        if _vs_instance is None:
            rag_status = "init_failed"
        elif _vs_instance.model_status == "ready":
            rag_status = f"ready ({_vs_instance.index.ntotal} chunks)"
        else:
            rag_status = _vs_instance.model_status
    return {
        "status": "ok",
        "service": "Story Weaver API",
        "version": "1.0",
        "mock_mode": MOCK_PIPELINES,
        "rag_status": rag_status,
    }


@app.post("/story/start")
async def story_start(config: ChildConfig):
    """Simple story-start endpoint: accepts ChildConfig, returns session_id + job_id."""
    safe_config = sanitize_input(config)
    state = StoryState(config=safe_config)
    session_store.set(state.session_id, state)

    job = job_store.create(state.session_id)

    coro = _mock_pipeline_task(job.job_id, state.session_id) if MOCK_PIPELINES \
        else run_pipeline_task(job.job_id, state.session_id, "")
    job_store.register_task(state.session_id, asyncio.create_task(coro))

    return {"session_id": state.session_id, "job_id": job.job_id, "step_number": state.step_number}


@app.post("/story/choose")
async def story_choose(request: StoryChooseRequest):
    """Advance the story by committing a choice and firing the next generation."""
    state = session_store.get(request.session_id)
    if not state:
        raise HTTPException(status_code=404, detail="Session not found")

    state.step_number += 1
    state.messages.append({"role": "user", "content": request.choice_text})
    session_store.set(request.session_id, state)

    job = job_store.create(state.session_id)

    coro = _mock_pipeline_task(job.job_id, request.session_id) if MOCK_PIPELINES \
        else run_pipeline_task(job.job_id, request.session_id, request.choice_text)
    job_store.register_task(request.session_id, asyncio.create_task(coro))

    return {"step_number": state.step_number, "session_id": request.session_id, "job_id": job.job_id}


# ---------------------------------------------------------------------------
# Legacy endpoints (/generate/*)
# ---------------------------------------------------------------------------

@app.post("/generate/start")
async def legacy_generate_start():
    """Legacy stub: creates a default session and fires a generation job."""
    config = ChildConfig(child_name="Friend", child_age=5)
    state = StoryState(config=config)
    session_store.set(state.session_id, state)

    job = job_store.create(state.session_id)

    coro = _mock_pipeline_task(job.job_id, state.session_id) if MOCK_PIPELINES \
        else run_pipeline_task(job.job_id, state.session_id, "")
    job_store.register_task(state.session_id, asyncio.create_task(coro))

    return {"session_id": state.session_id, "job_id": job.job_id}


@app.get("/generate/status/{id}")
async def legacy_get_status(id: str):
    """Legacy status endpoint: accepts either job_id or session_id."""
    job = job_store.get(id) or job_store.get_latest_for_session(id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return {"status": job.status, "job_id": job.job_id}


@app.post("/story/generate", response_model=GenerateResponse)
async def generate(request: GenerateRequest):
    """
    Unified generate endpoint for first chapter AND subsequent chapters.

    First chapter (session_id absent):
        - Requires config + story_idea.
        - Creates a new session, registers the protagonist image, fires generation.
        - Returns { session_id, job_id }.

    Next chapter (session_id present):
        - Requires choice_text (the chosen option text).
        - Looks up the existing session, advances conversation history, fires generation.
        - Returns { session_id, job_id }.

    The caller is expected to fire one job per available choice (pre-generation).
    Each fires independently; only the job matching the user's selection matters.
    """
    if not request.session_id:
        # ── First chapter ──────────────────────────────────────────────────
        if not request.config or not request.story_idea:
            raise HTTPException(status_code=422, detail="config and story_idea required for first chapter")

        safe_config = sanitize_input(request.config)
        safe_story_idea = sanitize_text_field(request.story_idea, 500, "story_idea")
        if not safe_story_idea:
            raise HTTPException(status_code=422, detail="story_idea is required and must not contain injection patterns")

        state = StoryState(
            config=safe_config,
            story_idea=safe_story_idea,
            messages=[{"role": "user", "content": f"The story idea is: {safe_story_idea}"}],
        )

        # Register protagonist: server-loaded image > request payload > nothing
        ref_image = _protagonist_image_b64 or request.protagonist_image_b64
        if ref_image:
            state.characters[safe_config.child_name.lower()] = CharacterRef(
                name=safe_config.child_name,
                role="protagonist",
                image_b64=ref_image,
            )
            print(f"[API] Protagonist registered for session {state.session_id}")
        else:
            print(f"[API] No protagonist image — session {state.session_id} will generate without reference")

        session_store.set(state.session_id, state)

    else:
        # ── Next chapter ───────────────────────────────────────────────────
        # The frontend fires one job per available choice immediately after
        # displaying a scene (pre-generation).  These jobs must NOT mutate the
        # live session — each gets a snapshot with its own choice appended.
        # The session history is advanced lazily: when the user fires the
        # FOLLOWING round's pre-generation jobs, pass `prev_job_id` so we can
        # commit the selected branch's history first.
        safe_choice = sanitize_text_field(request.choice_text, 200, "choice_text")
        if not safe_choice:
            raise HTTPException(status_code=422, detail="choice_text required for next chapter")
        request = request.model_copy(update={"choice_text": safe_choice})

        if not request.session_id:
            raise HTTPException(status_code=422, detail="session_id required for next chapter")
        state = session_store.get(request.session_id)
        if not state:
            raise HTTPException(status_code=404, detail="Session not found")

        # If the caller tells us which job was selected in the previous round,
        # commit that branch's history to the live session now.
        # Guard against duplicate commits — every prefire call in a round sends
        # the same prev_job_id, so only the first one actually writes.
        if request.prev_job_id and request.prev_job_id != state.last_committed_job_id:
            prev_job = job_store.get(request.prev_job_id)
            if prev_job and prev_job.status == StoryStatus.COMPLETE and prev_job.raw_text:
                # Commit: user choice + assistant response from the selected job
                state.step_number += 1
                state.messages.append({"role": "user", "content": f"[Scene {state.step_number}] {request.prev_choice_text or ''}"})
                state.messages.append({"role": "assistant", "content": prev_job.raw_text})
                state.last_committed_job_id = request.prev_job_id
                # Cap history: keep the first message (story idea) + the most recent ones
                if len(state.messages) > _MAX_HISTORY_MESSAGES:
                    state.messages = state.messages[:1] + state.messages[-(  _MAX_HISTORY_MESSAGES - 1):]
                session_store.set(state.session_id, state)
                print(f"[API] Committed job {request.prev_job_id} history to session {state.session_id} step={state.step_number}")
            elif prev_job and prev_job.status == StoryStatus.COMPLETE and not prev_job.raw_text:
                print(f"[API] prev_job {request.prev_job_id} has no raw_text — history not committed")
        elif request.prev_job_id and request.prev_job_id == state.last_committed_job_id:
            print(f"[API] Skipping duplicate commit of job {request.prev_job_id} for session {state.session_id}")

    # ── Create job and fire ────────────────────────────────────────────────
    job = job_store.create(state.session_id)
    branch_choice = request.choice_text or ""
    # Use asyncio.create_task so we can register the task for cancellation when
    # the session expires (BackgroundTasks provides no handle for this).
    task = asyncio.create_task(run_pipeline_task(job.job_id, state.session_id, branch_choice))
    job_store.register_task(state.session_id, task)

    print(f"[API] Job {job.job_id} queued for session {state.session_id} step={state.step_number} choice_len={len(branch_choice)}")
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
    print(f"[API] Character ({char.role}) added to session {request.session_id}")
    return {"status": "ok", "character": char.name}


def _resolve_job(id: str):
    """Look up a job by job_id, or fall back to the latest job for a session_id."""
    return job_store.get(id) or job_store.get_latest_for_session(id)


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
# Export endpoints — PDF and Video
# ---------------------------------------------------------------------------

from fastapi.responses import Response as _Response
from backend.export.models import ExportRequest


@app.post("/story/export/pdf")
async def export_pdf(req: ExportRequest):
    """
    Generate a storybook PDF from the completed scenes provided by the client.

    Request body: ExportRequest (title, child_name, scenes[]).
    Each scene carries step_number, story_text, and optionally illustration_b64.

    Returns: PDF file as application/pdf with a Content-Disposition attachment header.
    """
    try:
        from backend.export.pdf_export import generate_pdf
    except ImportError as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    try:
        pdf_bytes = await run_in_threadpool(
            generate_pdf,
            req.title,
            req.child_name,
            req.scenes,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        logger.error(f"[export/pdf] generation failed: {exc}")
        raise HTTPException(status_code=500, detail="PDF generation failed — check server logs.")

    safe_title = "".join(c if c.isalnum() or c in " _-" else "_" for c in req.title)[:60]
    filename   = f"{safe_title or 'story'}.pdf"
    return _Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.post("/story/export/video")
async def export_video(req: ExportRequest):
    """
    Generate a storybook slideshow MP4 from the completed scenes provided by the client.

    Request body: ExportRequest (title, child_name, scenes[]).
    Each scene carries step_number, story_text, illustration_b64, and optionally
    narration_audio_b64 (WAV).  When audio is present the scene clip lasts exactly
    as long as the narration; otherwise it defaults to 8 seconds.

    Returns: MP4 file as video/mp4 with a Content-Disposition attachment header.

    Note: Requires moviepy and ffmpeg to be installed on the server.
    """
    try:
        from backend.export.video_export import generate_video
    except ImportError as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    try:
        mp4_bytes = await run_in_threadpool(
            generate_video,
            req.title,
            req.child_name,
            req.scenes,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        logger.error(f"[export/video] generation failed: {exc}")
        raise HTTPException(status_code=500, detail="Video generation failed — check server logs.")

    safe_title = "".join(c if c.isalnum() or c in " _-" else "_" for c in req.title)[:60]
    filename   = f"{safe_title or 'story'}.mp4"
    return _Response(
        content=mp4_bytes,
        media_type="video/mp4",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---------------------------------------------------------------------------
# Debug: STT transcription endpoint (temporary diagnostic)
# ---------------------------------------------------------------------------

class SttRequest(_BaseModel):
    audio_b64: str = Field(..., max_length=MAX_AUDIO_B64_CHARS)  # raw base64 WAV, no data-URI prefix
    job_id: str = Field("", max_length=64)
    story_text: str = Field("", max_length=5000)


@app.post("/story/debug/stt")
async def debug_stt(req: SttRequest):
    """
    Transcribe the given WAV audio (base64) with Whisper and compare to story_text.
    Returns transcript + whether it matches the story_text (word-overlap %).

    Only available when DEBUG=true — returns 404 in production.
    """
    if os.getenv("DEBUG", "").lower() != "true":
        raise HTTPException(status_code=404, detail="Not found")
    try:
        wav_bytes = base64.b64decode(req.audio_b64)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Bad base64: {e}")

    from openai import AsyncOpenAI
    from dotenv import load_dotenv
    load_dotenv()

    # OpenRouter does NOT proxy Whisper (405). Call OpenAI directly.
    api_key = os.getenv("OPENAI_API_KEY", "")
    if not api_key:
        print(f"[debug/stt] OPENAI_API_KEY not set — STT diagnostic skipped for job={req.job_id}")
        return {
            "job_id": req.job_id,
            "transcript": "",
            "story_text_preview": req.story_text[:300],
            "word_overlap_pct": -1,
            "match": None,
            "skipped": True,
            "reason": "OPENAI_API_KEY not configured",
        }
    client = AsyncOpenAI(api_key=api_key)

    audio_file = io.BytesIO(wav_bytes)
    audio_file.name = "narration.wav"

    try:
        result = await client.audio.transcriptions.create(
            model="whisper-1",
            file=audio_file,
        )
        transcript = result.text.strip()
    except Exception as e:
        print(f"[debug/stt] Whisper failed: {e}")
        raise HTTPException(status_code=500, detail=f"STT failed: {e}")

    # Word-overlap metric (jaccard of word sets, case-insensitive)
    import re
    def _words(t: str) -> set:
        return set(re.sub(r"[^a-z0-9\s]", "", t.lower()).split())

    story_words = _words(req.story_text)
    audio_words = _words(transcript)
    if story_words or audio_words:
        overlap = len(story_words & audio_words) / len(story_words | audio_words)
    else:
        overlap = 1.0

    print(
        f"[debug/stt] job={req.job_id} word_overlap={overlap:.0%} "
        f"transcript_len={len(transcript)} story_len={len(req.story_text)}"
    )

    return {
        "job_id": req.job_id,
        "word_overlap_pct": round(overlap * 100, 1),
        "match": overlap > 0.4,
    }


# ---------------------------------------------------------------------------
# RAG endpoints  (/health, /api/v1/upload, /api/v1/generate)
# ---------------------------------------------------------------------------

class StoryRequest(_BaseModel):
    prompt: str = Field(..., max_length=500)
    age_group: str = Field("4-6", max_length=10)
    story_length: str = Field("10_minutes", max_length=20)
    child_name: str = Field("Friend", max_length=30)
    voice: str = Field("onyx", max_length=20)


@app.get("/health")
async def health():
    """
    Always returns 200 with RAG subsystem status.
    Use this to diagnose '503 RAG dependencies unavailable' and
    '503 Vector store initializing' issues without needing a working VS.
    """
    if _RAG_IMPORT_ERROR is not None:
        return {
            "status": "degraded",
            "rag_available": False,
            "rag_import_error": str(_RAG_IMPORT_ERROR),
            "fix": "pip install -r requirements.txt",
            "indexed_chunks": 0,
        }
    if _vs_instance is None:
        return {
            "status": "degraded",
            "rag_available": True,
            "rag_model_status": "init_failed",
            "detail": "FAISSVectorStoreManager failed at startup — check server logs.",
            "indexed_chunks": 0,
        }
    return {
        "status": "healthy" if _vs_instance.model_status == "ready" else "degraded",
        "rag_available": True,
        "rag_model_status": _vs_instance.model_status,
        "indexed_chunks": _vs_instance.index.ntotal,
    }


@app.post("/api/v1/upload")
async def upload_file(
    file: Annotated[UploadFile, File()],
    vs: Annotated[FAISSVectorStoreManager, Depends(get_vs)],
):
    ext = Path(file.filename).suffix.lower()
    if ext not in [".pdf", ".epub"]:
        raise HTTPException(400, "Invalid file extension.")

    file_id   = str(uuid.uuid4())
    save_path = UPLOAD_DIR / f"{file_id}{ext}"

    with save_path.open("wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    if save_path.stat().st_size > MAX_UPLOAD_BYTES:
        save_path.unlink(missing_ok=True)
        raise HTTPException(413, f"File too large. Maximum allowed size is {MAX_UPLOAD_BYTES // (1024*1024)} MB.")

    pages = await run_in_threadpool(parse_document, save_path)
    if not pages:
        raise HTTPException(422, "No readable text.")

    splitter = RecursiveCharacterTextSplitter(chunk_size=800, chunk_overlap=80)
    chunks: list[str]          = []
    metas:  list[dict[str, Any]] = []
    for page in pages:
        for text in splitter.split_text(page["text"]):
            chunks.append(text)
            metas.append({"file_id": file_id, "source": page["source"]})

    count = await run_in_threadpool(vs.add_documents, chunks, metas)
    vs.files_registry[file_id] = {
        "filename": file.filename,
        "at": datetime.now(timezone.utc).isoformat(),
    }
    vs.persist()

    # Delete the uploaded file immediately — the content is now in the FAISS
    # index and we no longer need the original document on disk.
    save_path.unlink(missing_ok=True)

    return {"file_id": file_id, "chunks": count}


@app.delete("/api/v1/upload/{file_id}")
async def delete_file(
    file_id: str,
    vs: Annotated[FAISSVectorStoreManager, Depends(get_vs)],
):
    """Remove all indexed content for a previously uploaded file."""
    if file_id not in vs.files_registry:
        raise HTTPException(status_code=404, detail="file_id not found")
    removed = await run_in_threadpool(vs.remove_file, file_id)
    return {"file_id": file_id, "chunks_removed": removed}


@app.post("/api/v1/generate", response_model=GenerateResponse)
async def generate_rag_story(
    req: StoryRequest,
):
    """
    RAG-enhanced story generation using the full Story Weaver pipeline.

    Workflow:
      1. Builds a ChildConfig from the request fields.
      2. Creates a new session with story_idea = req.prompt.
      3. Fires run_pipeline_task as a background job.
         - run_pipeline_task automatically fetches RAG context from the FAISS
           store (if available) and injects it into the pipeline before the
           LLM call — no separate search needed here.
         - The pipeline produces: story text + TTS audio + illustration + choices.
      4. Returns { session_id, job_id } immediately.

    Caller flow:
      - Poll GET /story/status/{job_id} until status == "complete"
      - Fetch GET /story/result/{job_id} for SceneOutput
        (story_text, narration_audio_b64, illustration_b64, choices)
      - Continue the story via POST /story/generate with session_id + choice_text
    """
    # Derive child_age from age_group string; default to 5 if unrecognised
    child_age = _AGE_GROUP_MAP.get(req.age_group, 5)

    safe_prompt = sanitize_text_field(req.prompt, 500, "prompt")
    if not safe_prompt:
        raise HTTPException(status_code=422, detail="prompt is required and must not contain injection patterns")

    # Embed the target word count in the story idea so the pipeline's
    # text builder (build_prompt) picks it up as part of the theme anchor.
    target_words = STORY_WORD_COUNTS.get(req.story_length, STORY_WORD_COUNTS["10_minutes"])
    story_idea = f"{safe_prompt} (target length: ~{target_words} words)"

    safe_config = sanitize_input(
        ChildConfig(child_name=req.child_name, child_age=child_age, voice=req.voice)
    )

    state = StoryState(
        config=safe_config,
        story_idea=story_idea,
        messages=[{"role": "user", "content": f"The story idea is: {story_idea}"}],
    )
    session_store.set(state.session_id, state)

    job = job_store.create(state.session_id)

    coro = _mock_pipeline_task(job.job_id, state.session_id) if MOCK_PIPELINES \
        else run_pipeline_task(job.job_id, state.session_id, "")
    job_store.register_task(state.session_id, asyncio.create_task(coro))

    logger.info(
        f"[RAG→pipeline] session={state.session_id} job={job.job_id} "
        f"age={child_age} words={target_words}"
    )
    return GenerateResponse(session_id=state.session_id, job_id=job.job_id)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
