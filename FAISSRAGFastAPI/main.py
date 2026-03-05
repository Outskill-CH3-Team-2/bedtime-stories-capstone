# ══════════════════════════════════════════════════════════════════════════════
# RAG-Based Children's Story Generator — FastAPI Application
# ══════════════════════════════════════════════════════════════════════════════

# ── 1. Imports & Configuration ────────────────────────────────────────────────
import os
import uuid
import json
import time
import logging
import shutil
from pathlib import Path
from datetime import datetime, timezone
from typing import List, Dict, Optional, Any

import numpy as np
import fitz  # PyMuPDF
import faiss
import ebooklib
from ebooklib import epub
from bs4 import BeautifulSoup
from sentence_transformers import SentenceTransformer
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_openai import ChatOpenAI
from langchain.prompts import ChatPromptTemplate
from langchain.schema import HumanMessage, SystemMessage

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# ── Logging setup ─────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("rag-story-api")

# ── Configuration from environment ────────────────────────────────────────────
OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL: str = os.getenv("OPENAI_MODEL", "gpt-4")
EMBEDDING_MODEL: str = os.getenv("EMBEDDING_MODEL", "all-MiniLM-L6-v2")
MAX_FILE_SIZE_MB: int = int(os.getenv("MAX_FILE_SIZE_MB", "50"))
UPLOAD_DIR: Path = Path(os.getenv("UPLOAD_DIR", "./uploads"))
FAISS_STORE_DIR: Path = Path(os.getenv("FAISS_STORE_DIR", "./faiss_store"))
DEFAULT_CHUNK_SIZE: int = int(os.getenv("DEFAULT_CHUNK_SIZE", "500"))
DEFAULT_CHUNK_OVERLAP: int = int(os.getenv("DEFAULT_CHUNK_OVERLAP", "50"))
DEFAULT_TOP_K: int = int(os.getenv("DEFAULT_TOP_K", "5"))
APP_VERSION: str = "1.0.0"

# Word count targets per story length
STORY_WORD_COUNTS: Dict[str, int] = {
    "5_minutes": 700,
    "10_minutes": 1400,
    "15_minutes": 2100,
}

# ── Custom Exceptions ─────────────────────────────────────────────────────────
class UnsupportedFileTypeError(Exception):
    pass

class EmptyVectorStoreError(Exception):
    pass

class LLMGenerationError(Exception):
    pass

class FileTooLargeError(Exception):
    pass


# ══════════════════════════════════════════════════════════════════════════════
# ── 2. FAISS Vector Store Manager ────────────────────────────────────────────
# ══════════════════════════════════════════════════════════════════════════════

class FAISSVectorStoreManager:
    """
    Singleton manager for the FAISS vector index.
    Handles embedding storage, similarity search, persistence, and deletion.
    """

    METADATA_FILE = "metadata.json"
    INDEX_FILE = "index.faiss"
    FILES_REGISTRY = "files_registry.json"

    def __init__(self, store_dir: Path, embedding_model_name: str):
        self.store_dir = store_dir
        self.store_dir.mkdir(parents=True, exist_ok=True)
        self.embedding_model_name = embedding_model_name

        logger.info(f"Loading embedding model: {embedding_model_name}")
        self.encoder = SentenceTransformer(embedding_model_name)
        self.embedding_dim: int = self.encoder.get_sentence_embedding_dimension()

        # In-memory metadata: list of dicts, index position == vector ID
        self.metadata: List[Dict[str, Any]] = []
        # Files registry: file_id → file metadata
        self.files_registry: Dict[str, Dict] = {}

        self.index: faiss.IndexFlatL2 = faiss.IndexFlatL2(self.embedding_dim)
        self.load()

    # ── Persistence ────────────────────────────────────────────────────────
    def persist(self) -> None:
        """Save FAISS index and metadata JSON to disk."""
        faiss.write_index(self.index, str(self.store_dir / self.INDEX_FILE))
        with open(self.store_dir / self.METADATA_FILE, "w") as f:
            json.dump(self.metadata, f, indent=2)
        with open(self.store_dir / self.FILES_REGISTRY, "w") as f:
            json.dump(self.files_registry, f, indent=2, default=str)
        logger.info(f"Persisted FAISS index ({self.index.ntotal} vectors) to disk.")

    def load(self) -> None:
        """Load FAISS index and metadata from disk if they exist."""
        index_path = self.store_dir / self.INDEX_FILE
        meta_path = self.store_dir / self.METADATA_FILE
        registry_path = self.store_dir / self.FILES_REGISTRY

        if index_path.exists() and meta_path.exists():
            self.index = faiss.read_index(str(index_path))
            with open(meta_path) as f:
                self.metadata = json.load(f)
            logger.info(f"Loaded FAISS index with {self.index.ntotal} vectors.")
        else:
            self.index = faiss.IndexFlatL2(self.embedding_dim)
            self.metadata = []
            logger.info("No existing FAISS index found — starting fresh.")

        if registry_path.exists():
            with open(registry_path) as f:
                self.files_registry = json.load(f)

    # ── Add Documents ──────────────────────────────────────────────────────
    def add_documents(self, chunks: List[str], chunk_metadata: List[Dict]) -> int:
        """
        Embed text chunks and add them to the FAISS index.
        Returns the number of vectors added.
        """
        if not chunks:
            return 0

        logger.info(f"Embedding {len(chunks)} chunks...")
        # Generate embeddings using sentence-transformers (local, no API key needed)
        embeddings = self.encoder.encode(chunks, show_progress_bar=False, convert_to_numpy=True)
        embeddings = embeddings.astype(np.float32)

        # FAISS expects shape (n, dim)
        self.index.add(embeddings)

        # Store metadata aligned with vector IDs
        for i, meta in enumerate(chunk_metadata):
            meta["text_preview"] = chunks[i][:200]  # Store first 200 chars as preview
            self.metadata.append(meta)

        self.persist()
        logger.info(f"Added {len(chunks)} vectors. Total: {self.index.ntotal}")
        return len(chunks)

    # ── Similarity Search ──────────────────────────────────────────────────
    def similarity_search(self, query: str, k: int = 5) -> List[Dict]:
        """
        Semantic similarity search: finds top-k passages most similar to the query.
        Returns list of dicts with text, score, source, chunk_index.
        """
        if self.index.ntotal == 0:
            raise EmptyVectorStoreError("Vector store is empty. Please upload and embed books first.")

        # Encode the query using the same embedding model
        query_vec = self.encoder.encode([query], convert_to_numpy=True).astype(np.float32)
        k = min(k, self.index.ntotal)

        # FAISS returns L2 distances and indices
        distances, indices = self.index.search(query_vec, k)

        results = []
        for dist, idx in zip(distances[0], indices[0]):
            if idx == -1:
                continue
            meta = self.metadata[idx]
            # Convert L2 distance to a similarity score (lower distance = higher similarity)
            score = float(1 / (1 + dist))
            results.append({
                "text": meta.get("text_preview", ""),
                "score": round(score, 4),
                "source": meta.get("source", "unknown"),
                "chunk_index": meta.get("chunk_index", idx),
                "file_id": meta.get("file_id", ""),
            })

        return results

    # ── Delete by File ID ──────────────────────────────────────────────────
    def delete_by_file_id(self, file_id: str) -> int:
        """
        Remove all vectors associated with a file_id.
        Rebuilds the FAISS index without those vectors.
        Returns number of vectors removed.
        """
        # Filter out chunks belonging to this file
        keep_indices = [i for i, m in enumerate(self.metadata) if m.get("file_id") != file_id]
        removed_count = len(self.metadata) - len(keep_indices)

        if removed_count == 0:
            return 0

        # Reconstruct the index with remaining vectors
        remaining_meta = [self.metadata[i] for i in keep_indices]

        # Re-encode remaining text previews to rebuild index
        new_index = faiss.IndexFlatL2(self.embedding_dim)
        if remaining_meta:
            texts = [m.get("text_preview", "") for m in remaining_meta]
            embeddings = self.encoder.encode(texts, show_progress_bar=False, convert_to_numpy=True)
            new_index.add(embeddings.astype(np.float32))

        self.index = new_index
        self.metadata = remaining_meta

        # Remove from files registry
        self.files_registry.pop(file_id, None)
        self.persist()

        logger.info(f"Deleted {removed_count} vectors for file_id={file_id}")
        return removed_count

    # ── Stats ──────────────────────────────────────────────────────────────
    def get_stats(self) -> Dict:
        """Return stats about the current vector store."""
        index_path = self.store_dir / self.INDEX_FILE
        size_mb = round(index_path.stat().st_size / (1024 * 1024), 2) if index_path.exists() else 0.0
        unique_docs = len(set(m.get("file_id") for m in self.metadata))
        return {
            "total_vectors": self.index.ntotal,
            "total_documents": unique_docs,
            "embedding_model": self.embedding_model_name,
            "faiss_index_type": "IndexFlatL2",
            "store_size_mb": size_mb,
            "is_ready": self.index.ntotal > 0,
        }

    def register_file(self, file_id: str, file_info: Dict) -> None:
        """Register a file in the files registry."""
        self.files_registry[file_id] = file_info
        self.persist()

    def update_file_status(self, file_id: str, status: str, chunks: int = 0) -> None:
        """Update the status of a registered file."""
        if file_id in self.files_registry:
            self.files_registry[file_id]["status"] = status
            if chunks:
                self.files_registry[file_id]["chunks"] = chunks
            self.persist()


# ══════════════════════════════════════════════════════════════════════════════
# ── 3. Document Parsers ───────────────────────────────────────────────────────
# ══════════════════════════════════════════════════════════════════════════════

def parse_pdf(filepath: str) -> List[Dict]:
    """
    Extract text from a PDF file page by page using PyMuPDF.
    Skips pages with fewer than 50 characters (likely blank or image-only).
    Returns list of {text, page_number, source}.
    """
    pages = []
    source = Path(filepath).name
    try:
        doc = fitz.open(filepath)
        for page_num in range(len(doc)):
            page = doc[page_num]
            text = page.get_text("text").strip()
            if len(text) < 50:
                continue  # Skip sparse pages
            pages.append({
                "text": text,
                "page_number": page_num + 1,
                "source": source,
            })
        doc.close()
        logger.info(f"PDF parsed: {len(pages)} pages extracted from {source}")
    except Exception as e:
        logger.error(f"PDF parse error: {e}")
        raise ValueError(f"Could not parse PDF: {e}")
    return pages


def parse_epub(filepath: str) -> List[Dict]:
    """
    Extract text from an EPUB file using ebooklib and BeautifulSoup.
    Iterates through spine items, strips HTML tags, and returns clean text.
    Returns list of {text, chapter, source}.
    """
    chapters = []
    source = Path(filepath).name
    try:
        book = epub.read_epub(filepath)
        chapter_num = 0
        for item in book.get_items_of_type(ebooklib.ITEM_DOCUMENT):
            content = item.get_content()
            soup = BeautifulSoup(content, "html.parser")
            # Remove script and style tags
            for tag in soup(["script", "style"]):
                tag.decompose()
            text = soup.get_text(separator=" ", strip=True)
            if len(text) < 50:
                continue  # Skip near-empty chapters
            chapter_num += 1
            chapters.append({
                "text": text,
                "chapter": chapter_num,
                "source": source,
            })
        logger.info(f"EPUB parsed: {len(chapters)} chapters extracted from {source}")
    except Exception as e:
        logger.error(f"EPUB parse error: {e}")
        raise ValueError(f"Could not parse EPUB: {e}")
    return chapters


# ══════════════════════════════════════════════════════════════════════════════
# ── 4. Embedding + Chunking Pipeline ─────────────────────────────────────────
# ══════════════════════════════════════════════════════════════════════════════

def chunk_documents(
    pages: List[Dict],
    file_id: str,
    chunk_size: int = DEFAULT_CHUNK_SIZE,
    chunk_overlap: int = DEFAULT_CHUNK_OVERLAP,
) -> tuple[List[str], List[Dict]]:
    """
    Split extracted document pages/chapters into overlapping chunks
    using LangChain's RecursiveCharacterTextSplitter.
    Returns (chunks_text, chunks_metadata).
    """
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        separators=["\n\n", "\n", ". ", " ", ""],
    )

    all_chunks: List[str] = []
    all_metadata: List[Dict] = []

    for page in pages:
        raw_text = page["text"]
        splits = splitter.split_text(raw_text)
        for i, chunk in enumerate(splits):
            all_chunks.append(chunk)
            all_metadata.append({
                "file_id": file_id,
                "source": page.get("source", "unknown"),
                "chunk_index": len(all_chunks) - 1,
                "page_or_chapter": page.get("page_number") or page.get("chapter", 0),
            })

    # Update total_chunks count
    total = len(all_chunks)
    for m in all_metadata:
        m["total_chunks"] = total

    logger.info(f"Chunked into {total} pieces (size={chunk_size}, overlap={chunk_overlap})")
    return all_chunks, all_metadata


# ══════════════════════════════════════════════════════════════════════════════
# ── 6. Story Generation Chain ─────────────────────────────────────────────────
# ══════════════════════════════════════════════════════════════════════════════

def generate_story(
    prompt: str,
    retrieved_passages: List[Dict],
    age_group: str,
    story_length: str,
    temperature: float,
    model: str,
) -> str:
    """
    Use OpenAI GPT via LangChain to generate a children's story.
    Retrieved passages serve as style and context references (RAG augmentation).
    """
    if not OPENAI_API_KEY:
        raise LLMGenerationError("OPENAI_API_KEY is not configured.")

    word_count = STORY_WORD_COUNTS.get(story_length, 1400)

    # Format retrieved passages as style examples
    passages_text = "\n\n---\n\n".join(
        [f"[Passage {i+1} from {p.get('source', 'book')}]:\n{p['text']}"
         for i, p in enumerate(retrieved_passages)]
    )

    system_prompt = (
        "You are a master children's story writer with decades of experience. "
        "Study the REFERENCE PASSAGES below carefully — they represent the writing style, "
        "vocabulary, pacing, and narrative patterns you should emulate. "
        "Do NOT copy them directly. Use them purely as creative style inspiration. "
        "Always end with a clear, positive moral lesson."
    )

    user_prompt = f"""REFERENCE PASSAGES (use these as style guides):
{passages_text}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

YOUR TASK:
Write a COMPLETE original children's story for age group: {age_group}
Target length: approximately {word_count} words ({story_length.replace("_", " ")} read-aloud)

Story prompt: "{prompt}"

Requirements:
- Start with an engaging TITLE on the first line (e.g., "Title: The Brave Little Fox")
- Create vivid, memorable characters
- Clear beginning → conflict → resolution arc
- Age-appropriate vocabulary for {age_group} year olds
- Positive moral lesson woven naturally into the story
- A warm, satisfying conclusion
- Write the full story now, do not summarize or truncate.
"""

    llm = ChatOpenAI(
        model=model,
        temperature=temperature,
        api_key=OPENAI_API_KEY,
        max_tokens=3000,
    )

    messages = [
        SystemMessage(content=system_prompt),
        HumanMessage(content=user_prompt),
    ]

    try:
        response = llm.invoke(messages)
        return response.content
    except Exception as e:
        logger.error(f"LLM generation error: {e}")
        raise LLMGenerationError(f"Story generation failed: {e}")


def extract_title_and_body(story_text: str) -> tuple[str, str]:
    """Extract title and body from generated story text."""
    lines = story_text.strip().split("\n")
    title = "A Magical Story"
    body = story_text

    for i, line in enumerate(lines):
        if line.lower().startswith("title:"):
            title = line.replace("title:", "").replace("Title:", "").strip().strip('"')
            body = "\n".join(lines[i + 1:]).strip()
            break
        elif i == 0 and len(line) < 100:
            # First line that's short is likely the title
            title = line.strip().strip('"').strip("*").strip("#")
            body = "\n".join(lines[1:]).strip()
            break

    return title, body


# ══════════════════════════════════════════════════════════════════════════════
# ── 7. FastAPI App + Middleware ────────────────────────────────────────────────
# ══════════════════════════════════════════════════════════════════════════════

app = FastAPI(
    title="RAG Story Generator API",
    description="Generate children's bedtime stories from uploaded eBooks using RAG",
    version=APP_VERSION,
    docs_url="/docs",
    redoc_url="/redoc",
)

# CORS — allow all origins for development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Request logging middleware
@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.time()
    response = await call_next(request)
    duration = round(time.time() - start, 3)
    logger.info(f"{request.method} {request.url.path} → {response.status_code} ({duration}s)")
    return response

# Global vector store manager (initialized on startup)
vector_store: FAISSVectorStoreManager = None


# ── Custom Exception Handlers ──────────────────────────────────────────────────
@app.exception_handler(UnsupportedFileTypeError)
async def unsupported_file_handler(request, exc):
    return JSONResponse(status_code=400, content={"error": "UnsupportedFileType", "detail": str(exc)})

@app.exception_handler(EmptyVectorStoreError)
async def empty_store_handler(request, exc):
    return JSONResponse(status_code=503, content={"error": "EmptyVectorStore", "detail": str(exc)})

@app.exception_handler(LLMGenerationError)
async def llm_error_handler(request, exc):
    return JSONResponse(status_code=502, content={"error": "LLMGenerationError", "detail": str(exc)})

@app.exception_handler(FileTooLargeError)
async def file_too_large_handler(request, exc):
    return JSONResponse(status_code=413, content={"error": "FileTooLarge", "detail": str(exc)})


# ══════════════════════════════════════════════════════════════════════════════
# ── 8. Pydantic Schemas ────────────────────────────────────────────────────────
# ══════════════════════════════════════════════════════════════════════════════

class EmbedRequest(BaseModel):
    file_id: str
    chunk_size: Optional[int] = Field(default=DEFAULT_CHUNK_SIZE, ge=100, le=2000)
    chunk_overlap: Optional[int] = Field(default=DEFAULT_CHUNK_OVERLAP, ge=0, le=200)

class StoryRequest(BaseModel):
    prompt: str = Field(..., min_length=5, max_length=500)
    age_group: Optional[str] = Field(default="4-6", pattern=r"^(2-4|4-6|6-8|8-12)$")
    story_length: Optional[str] = Field(default="10_minutes", pattern=r"^(5_minutes|10_minutes|15_minutes)$")
    top_k: Optional[int] = Field(default=DEFAULT_TOP_K, ge=1, le=20)
    temperature: Optional[float] = Field(default=0.85, ge=0.0, le=1.0)

class SearchRequest(BaseModel):
    query: str = Field(..., min_length=3)
    top_k: Optional[int] = Field(default=5, ge=1, le=20)


# ══════════════════════════════════════════════════════════════════════════════
# ── 9. API Endpoints ──────────────────────────────────────────────────────────
# ══════════════════════════════════════════════════════════════════════════════

# ── Health Check ──────────────────────────────────────────────────────────────
@app.get("/health", tags=["System"])
async def health_check():
    """Returns API health status and whether the FAISS index is ready."""
    return {
        "status": "ok",
        "version": APP_VERSION,
        "faiss_ready": vector_store.index.ntotal > 0 if vector_store else False,
    }


# ── Upload File ───────────────────────────────────────────────────────────────
@app.post("/api/v1/upload", tags=["Documents"])
async def upload_file(
    file: UploadFile = File(...),
    metadata: Optional[str] = Form(default=None),
):
    """
    Upload a PDF or EPUB file to the server.
    The file is saved to disk and registered for later embedding.
    """
    # Validate file type
    allowed_extensions = {".pdf", ".epub"}
    file_ext = Path(file.filename).suffix.lower()
    if file_ext not in allowed_extensions:
        raise UnsupportedFileTypeError(
            f"File type '{file_ext}' is not supported. Allowed: {', '.join(allowed_extensions)}"
        )

    # Check file size
    content = await file.read()
    size_mb = len(content) / (1024 * 1024)
    if size_mb > MAX_FILE_SIZE_MB:
        raise FileTooLargeError(f"File size {size_mb:.1f}MB exceeds limit of {MAX_FILE_SIZE_MB}MB.")

    # Generate unique file ID and save to disk
    file_id = str(uuid.uuid4())
    save_path = UPLOAD_DIR / f"{file_id}{file_ext}"
    save_path.write_bytes(content)

    # Parse optional metadata
    extra_meta = {}
    if metadata:
        try:
            extra_meta = json.loads(metadata)
        except json.JSONDecodeError:
            pass

    # Register file in the vector store's files registry
    file_info = {
        "file_id": file_id,
        "filename": file.filename,
        "original_ext": file_ext,
        "size_mb": round(size_mb, 2),
        "status": "uploaded",
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
        "chunks": 0,
        **extra_meta,
    }
    vector_store.register_file(file_id, file_info)

    logger.info(f"Uploaded: {file.filename} → {file_id} ({size_mb:.2f}MB)")
    return {
        "file_id": file_id,
        "filename": file.filename,
        "status": "uploaded",
        "size_mb": round(size_mb, 2),
        "message": "File saved successfully. Call /api/v1/embed to process it.",
    }


# ── Parse & Embed ─────────────────────────────────────────────────────────────
@app.post("/api/v1/embed", tags=["Documents"])
async def embed_file(request: EmbedRequest):
    """
    Parse an uploaded PDF/EPUB and create FAISS vector embeddings.
    This is the core ingestion step of the RAG pipeline.
    """
    file_id = request.file_id

    # Find the uploaded file on disk
    file_info = vector_store.files_registry.get(file_id)
    if not file_info:
        raise HTTPException(status_code=404, detail=f"file_id '{file_id}' not found. Upload the file first.")

    file_ext = file_info["original_ext"]
    file_path = UPLOAD_DIR / f"{file_id}{file_ext}"
    if not file_path.exists():
        raise HTTPException(status_code=404, detail=f"File on disk not found for file_id '{file_id}'.")

    start_time = time.time()

    # Route to correct parser based on file type
    try:
        if file_ext == ".pdf":
            pages = parse_pdf(str(file_path))
        elif file_ext == ".epub":
            pages = parse_epub(str(file_path))
        else:
            raise UnsupportedFileTypeError(f"Cannot parse file type: {file_ext}")
    except ValueError as e:
        vector_store.update_file_status(file_id, "error")
        raise HTTPException(status_code=422, detail=str(e))

    # Chunk the extracted text
    chunks, chunk_metadata = chunk_documents(
        pages,
        file_id=file_id,
        chunk_size=request.chunk_size,
        chunk_overlap=request.chunk_overlap,
    )

    # Embed and add to FAISS index
    added = vector_store.add_documents(chunks, chunk_metadata)

    # Update file registry
    vector_store.update_file_status(file_id, "embedded", chunks=added)

    processing_time = round(time.time() - start_time, 2)
    logger.info(f"Embedded {file_id}: {added} chunks in {processing_time}s")

    return {
        "file_id": file_id,
        "status": "embedded",
        "chunks_created": added,
        "embedding_model": EMBEDDING_MODEL,
        "vector_store_size": vector_store.index.ntotal,
        "processing_time_seconds": processing_time,
    }


# ── Generate Story ─────────────────────────────────────────────────────────────
@app.post("/api/v1/generate-story", tags=["Stories"])
async def generate_story_endpoint(request: StoryRequest):
    """
    RAG pipeline: retrieve similar passages from FAISS, then generate
    a children's story using GPT-4 augmented with those passages as style examples.
    """
    if vector_store.index.ntotal == 0:
        raise EmptyVectorStoreError(
            "No books have been embedded yet. Upload PDF/EPUB files and call /api/v1/embed first."
        )

    # ── Step 1: Semantic Search (RAG retrieval) ──
    logger.info(f"Retrieving top {request.top_k} passages for prompt: '{request.prompt}'")
    retrieved = vector_store.similarity_search(request.prompt, k=request.top_k)

    # ── Step 2: Augmented Generation ──
    logger.info(f"Generating story with model={OPENAI_MODEL}, length={request.story_length}")
    story_text = generate_story(
        prompt=request.prompt,
        retrieved_passages=retrieved,
        age_group=request.age_group,
        story_length=request.story_length,
        temperature=request.temperature,
        model=OPENAI_MODEL,
    )

    title, body = extract_title_and_body(story_text)
    word_count = len(body.split())
    read_time = round(word_count / 140)  # ~140 words per minute read-aloud

    return {
        "story_title": title,
        "story": body,
        "word_count": word_count,
        "estimated_read_time_minutes": read_time,
        "age_group": request.age_group,
        "retrieved_passages_count": len(retrieved),
        "model_used": OPENAI_MODEL,
        "prompt_used": request.prompt,
    }


# ── Knowledge Base Status ──────────────────────────────────────────────────────
@app.get("/api/v1/knowledge-base/status", tags=["Knowledge Base"])
async def knowledge_base_status():
    """Return statistics about the FAISS vector store."""
    return vector_store.get_stats()


# ── List Files ─────────────────────────────────────────────────────────────────
@app.get("/api/v1/files", tags=["Documents"])
async def list_files():
    """List all uploaded and processed files."""
    files = list(vector_store.files_registry.values())
    return {"files": files, "total": len(files)}


# ── Delete File ────────────────────────────────────────────────────────────────
@app.delete("/api/v1/files/{file_id}", tags=["Documents"])
async def delete_file(file_id: str):
    """Remove a file and all its associated vectors from the knowledge base."""
    if file_id not in vector_store.files_registry:
        raise HTTPException(status_code=404, detail=f"file_id '{file_id}' not found.")

    file_info = vector_store.files_registry[file_id]
    file_ext = file_info.get("original_ext", "")
    file_path = UPLOAD_DIR / f"{file_id}{file_ext}"

    # Remove vectors from FAISS
    removed = vector_store.delete_by_file_id(file_id)

    # Remove file from disk
    if file_path.exists():
        file_path.unlink()

    logger.info(f"Deleted file {file_id}: {removed} vectors removed.")
    return {
        "file_id": file_id,
        "status": "deleted",
        "vectors_removed": removed,
    }


# ── Semantic Search ─────────────────────────────────────────────────────────────
@app.post("/api/v1/search", tags=["Knowledge Base"])
async def semantic_search(request: SearchRequest):
    """
    Direct semantic search against the knowledge base.
    Useful for debugging retrieval quality.
    """
    if vector_store.index.ntotal == 0:
        raise EmptyVectorStoreError("Vector store is empty. Upload and embed books first.")

    results = vector_store.similarity_search(request.query, k=request.top_k)
    return {
        "query": request.query,
        "results": results,
    }


# ══════════════════════════════════════════════════════════════════════════════
# ── 9. Startup / Shutdown Events ─────────────────────────────────────────────
# ══════════════════════════════════════════════════════════════════════════════

@app.on_event("startup")
async def startup_event():
    """
    On startup: create required directories and load existing FAISS index.
    """
    global vector_store
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    FAISS_STORE_DIR.mkdir(parents=True, exist_ok=True)
    logger.info(f"Startup: upload_dir={UPLOAD_DIR}, faiss_store={FAISS_STORE_DIR}")
    vector_store = FAISSVectorStoreManager(
        store_dir=FAISS_STORE_DIR,
        embedding_model_name=EMBEDDING_MODEL,
    )
    logger.info(f"✅ RAG Story API ready. FAISS vectors: {vector_store.index.ntotal}")


@app.on_event("shutdown")
async def shutdown_event():
    """Persist the FAISS index on graceful shutdown."""
    if vector_store:
        vector_store.persist()
    logger.info("Shutdown complete.")


# ══════════════════════════════════════════════════════════════════════════════
# ── 10. Main Entry Point ──────────────────────────────────────────────────────
# ══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
