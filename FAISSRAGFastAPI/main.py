import os
import uuid
import json
import logging
import shutil
import threading
import numpy as np
import uvicorn

from pathlib import Path
from datetime import datetime, timezone
from typing import List, Dict, Optional, Annotated

# Core Logic Imports
import fitz  # PyMuPDF
import faiss
import ebooklib
from ebooklib import epub
from bs4 import BeautifulSoup
from sentence_transformers import SentenceTransformer
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage

# FastAPI Imports
from fastapi import FastAPI, UploadFile, File, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from dotenv import load_dotenv

# -- 1. Setup & Configuration --
load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("rag-story-api")

# Config constants
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o")
EMBEDDING_MODEL_NAME = os.getenv("EMBEDDING_MODEL", "all-MiniLM-L6-v2")
UPLOAD_DIR = Path("uploads")
FAISS_STORE_DIR = Path("faiss_store")
STORY_WORD_COUNTS = {"5_minutes": 700, "10_minutes": 1400, "15_minutes": 2100}

# -- 2. Vector Store Manager (Thread-Safe) --
class FAISSVectorStoreManager:
    def __init__(self, store_dir: Path, model_name: str):
        self.store_dir = store_dir
        self.store_dir.mkdir(parents=True, exist_ok=True)
        self.lock = threading.Lock()
        self.model_status = "loading"
        
        try:
            logger.info(f"Initializing SentenceTransformer: {model_name}")
            self.encoder = SentenceTransformer(model_name, trust_remote_code=True)
            self.dim = self.encoder.get_sentence_embedding_dimension()
            self.model_status = "ready"
        except Exception as e:
            self.model_status = f"error: {str(e)}"
            logger.critical(f"Encoder Load Failed: {e}")
            raise

        self.index = faiss.IndexFlatL2(self.dim)
        self.metadata: List[Dict] = []
        self.files_registry: Dict[str, Dict] = {}
        self.load()

    def persist(self):
        with self.lock:
            try:
                faiss.write_index(self.index, str(self.store_dir / "index.faiss"))
                with open(self.store_dir / "store_data.json", "w") as f:
                    json.dump({"metadata": self.metadata, "registry": self.files_registry}, f, indent=2)
            except Exception as e:
                logger.error(f"Persistence Failed: {e}")

    def load(self):
        idx_path = self.store_dir / "index.faiss"
        meta_path = self.store_dir / "store_data.json"
        if idx_path.exists() and meta_path.exists() and idx_path.stat().st_size > 0:
            try:
                self.index = faiss.read_index(str(idx_path))
                with open(meta_path, "r") as f:
                    data = json.load(f)
                    self.metadata = data.get("metadata", [])
                    self.files_registry = data.get("registry", {})
                logger.info(f"Loaded {self.index.ntotal} vectors.")
            except Exception as e:
                logger.error(f"Corruption during load: {e}. Starting fresh.")

    def add_documents(self, chunks: List[str], metas: List[Dict]):
        embeddings = self.encoder.encode(chunks, convert_to_numpy=True).astype(np.float32)
        with self.lock:
            self.index.add(embeddings)
            for i, text in enumerate(chunks):
                metas[i]["content"] = text
                self.metadata.append(metas[i])
        self.persist()
        return len(chunks)

    def similarity_search(self, query: str, k: int = 5):
        if self.index.ntotal == 0:
            return []
        query_vec = self.encoder.encode([query], convert_to_numpy=True).astype(np.float32)
        distances, indices = self.index.search(query_vec, k)
        results = []
        for dist, idx in zip(distances[0], indices[0]):
            if idx != -1 and idx < len(self.metadata):
                item = self.metadata[idx].copy()
                item["score"] = float(1 / (1 + dist))
                results.append(item)
        return results

# -- 3. Document Parsers --
def parse_document(file_path: Path) -> List[Dict]:
    pages = []
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

# -- 4. Global Instance & Dependencies --
app = FastAPI(title="RAG Story Engine", version="1.2.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

_vs_instance: Optional[FAISSVectorStoreManager] = None

@app.on_event("startup")
def on_startup():
    global _vs_instance
    UPLOAD_DIR.mkdir(exist_ok=True)
    _vs_instance = FAISSVectorStoreManager(FAISS_STORE_DIR, EMBEDDING_MODEL_NAME)

def get_vs() -> FAISSVectorStoreManager:
    if not _vs_instance:
        raise HTTPException(503, "Vector store initializing...")
    return _vs_instance

def get_llm():
    return ChatOpenAI(model=OPENAI_MODEL, api_key=OPENAI_API_KEY)

# -- 5. Endpoints --

class StoryRequest(BaseModel):
    prompt: str = Field(..., min_length=5)
    age_group: str = "4-6"
    story_length: str = "10_minutes"
    temperature: float = 0.5

@app.get("/health")
async def health(vs: Annotated[FAISSVectorStoreManager, Depends(get_vs)]):
    return {
        "status": "healthy" if vs.model_status == "ready" else "error",
        "error_details": vs.model_status if "error" in vs.model_status else None,
        "indexed_chunks": vs.index.ntotal
    }

# FIX: Both parameters now use Annotated[] syntax consistently,
# so Python never sees a "parameter with default" before "parameter without default".
@app.post("/api/v1/upload")
async def upload(
    file: Annotated[UploadFile, File()],          # <-- was: UploadFile = File(...)
    vs: Annotated[FAISSVectorStoreManager, Depends(get_vs)],
):
    ext = Path(file.filename).suffix.lower()
    if ext not in [".pdf", ".epub"]:
        raise HTTPException(400, "Invalid file extension.")

    file_id = str(uuid.uuid4())
    save_path = UPLOAD_DIR / f"{file_id}{ext}"

    with save_path.open("wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    pages = await run_in_threadpool(parse_document, save_path)
    if not pages:
        raise HTTPException(422, "No readable text.")

    splitter = RecursiveCharacterTextSplitter(chunk_size=800, chunk_overlap=80)
    chunks, metas = [], []
    for p in pages:
        for text in splitter.split_text(p["text"]):
            chunks.append(text)
            metas.append({"file_id": file_id, "source": p["source"]})

    count = await run_in_threadpool(vs.add_documents, chunks, metas)
    vs.files_registry[file_id] = {"filename": file.filename, "at": datetime.now(timezone.utc).isoformat()}
    vs.persist()

    return {"file_id": file_id, "chunks": count}

@app.post("/api/v1/generate")
async def generate(
    req: StoryRequest,
    vs: Annotated[FAISSVectorStoreManager, Depends(get_vs)],
    llm: Annotated[ChatOpenAI, Depends(get_llm)],
):
    retrieved = await run_in_threadpool(vs.similarity_search, req.prompt, 5)
    context = "\n---\n".join([r["content"] for r in retrieved]) if retrieved else "No reference found."

    sys_msg = SystemMessage(content="You are a children's book author. Use the style of the STYLE REFERENCE.")
    usr_msg = HumanMessage(content=f"STYLE REFERENCE:\n{context}\n\nSTORY TOPIC: {req.prompt}\nAGE: {req.age_group}\nWORDS: {STORY_WORD_COUNTS[req.story_length]}")

    response = await run_in_threadpool(llm.invoke, [sys_msg, usr_msg])
    return {"story": response.content, "sources": list(set([r.get("source") for r in retrieved]))}

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
