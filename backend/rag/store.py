"""
backend/rag/store.py — FAISS vector store with OpenRouter embeddings.

Design:
- Embeddings via OpenRouter (text-embedding-3-small) — same API key as everything else.
- FAISS IndexFlatL2 for similarity search — stored on disk at rag_data/.
- Metadata (text chunks, source file, upload date) stored alongside in JSON.
- Thread-safe via threading.Lock for concurrent upload/search.
"""

from __future__ import annotations

import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import faiss
import numpy as np

from backend.pipelines.provider import get_client

_PROJECT_ROOT = Path(__file__).parent.parent.parent
_STORE_DIR = _PROJECT_ROOT / "rag_data"
_INDEX_PATH = _STORE_DIR / "index.faiss"
_META_PATH = _STORE_DIR / "metadata.json"

EMBEDDING_MODEL = "openai/text-embedding-3-small"
EMBEDDING_DIM = 1536
CHUNK_SIZE = 500
CHUNK_OVERLAP = 50


class RAGStore:
    def __init__(self) -> None:
        _STORE_DIR.mkdir(parents=True, exist_ok=True)
        self.lock = threading.Lock()
        self.index: faiss.IndexFlatL2 = faiss.IndexFlatL2(EMBEDDING_DIM)
        self.metadata: list[dict[str, Any]] = []
        self.files: dict[str, dict[str, Any]] = {}
        self._load()

    # ── Persistence ───────────────────────────────────────────────────────────

    def _load(self) -> None:
        if _INDEX_PATH.exists() and _META_PATH.exists():
            try:
                self.index = faiss.read_index(str(_INDEX_PATH))
                with open(_META_PATH) as f:
                    data = json.load(f)
                self.metadata = data.get("chunks", [])
                self.files = data.get("files", {})
                print(f"[rag] Loaded {self.index.ntotal} vectors from disk.")
            except Exception as e:
                print(f"[rag] Failed to load store: {e} — starting fresh.")

    def _save(self) -> None:
        with self.lock:
            try:
                faiss.write_index(self.index, str(_INDEX_PATH))
                with open(_META_PATH, "w") as f:
                    json.dump({"chunks": self.metadata, "files": self.files}, f, indent=2)
            except Exception as e:
                print(f"[rag] Failed to persist store: {e}")

    # ── Embedding ─────────────────────────────────────────────────────────────

    async def _embed(self, texts: list[str]) -> np.ndarray:
        """Get embeddings via OpenRouter (proxies OpenAI text-embedding-3-small)."""
        client = get_client()
        response = await client.embeddings.create(
            model=EMBEDDING_MODEL,
            input=texts,
        )
        vectors = [item.embedding for item in response.data]
        return np.array(vectors, dtype=np.float32)

    # ── Chunking ──────────────────────────────────────────────────────────────

    @staticmethod
    def _chunk_text(text: str) -> list[str]:
        """Split text into overlapping chunks by word count."""
        words = text.split()
        if len(words) <= CHUNK_SIZE:
            return [text.strip()] if text.strip() else []
        chunks = []
        start = 0
        while start < len(words):
            end = start + CHUNK_SIZE
            chunk = " ".join(words[start:end])
            if chunk.strip():
                chunks.append(chunk.strip())
            start += CHUNK_SIZE - CHUNK_OVERLAP
        return chunks

    # ── Public API ────────────────────────────────────────────────────────────

    async def add_document(self, text: str, filename: str, source_type: str = "upload") -> int:
        """
        Chunk text, embed, and add to FAISS index.
        Returns number of chunks added.
        """
        chunks = self._chunk_text(text)
        if not chunks:
            return 0

        vectors = await self._embed(chunks)

        with self.lock:
            base_idx = self.index.ntotal
            self.index.add(vectors)

            for i, chunk in enumerate(chunks):
                self.metadata.append({
                    "text": chunk,
                    "filename": filename,
                    "source_type": source_type,
                    "chunk_idx": i,
                    "vector_idx": base_idx + i,
                })

            self.files[filename] = {
                "source_type": source_type,
                "chunk_count": len(chunks),
                "uploaded_at": datetime.now(timezone.utc).isoformat(),
            }

        self._save()
        print(f"[rag] Added {len(chunks)} chunks from '{filename}' ({source_type})")
        return len(chunks)

    async def search(self, query: str, k: int = 5) -> str:
        """
        Search for relevant chunks. Returns formatted context string
        ready for prompt injection, or empty string if nothing found.
        """
        if self.index.ntotal == 0:
            return ""

        query_vec = await self._embed([query])
        k = min(k, self.index.ntotal)
        distances, indices = self.index.search(query_vec, k)

        results = []
        for dist, idx in zip(distances[0], indices[0]):
            if idx < 0 or idx >= len(self.metadata):
                continue
            meta = self.metadata[idx]
            # L2 distance threshold — skip very dissimilar results
            if dist > 1.5:
                continue
            results.append({
                "text": meta["text"],
                "source": meta["filename"],
                "distance": float(dist),
            })

        if not results:
            return ""

        # Format as context string for prompt injection
        lines = []
        for r in results:
            lines.append(f"[From: {r['source']}]\n{r['text']}")
        context = "\n---\n".join(lines)
        print(f"[rag] Search returned {len(results)} chunks for query: {query[:60]!r}")
        return context

    def list_files(self) -> dict[str, dict[str, Any]]:
        """Return metadata about all uploaded files."""
        return dict(self.files)

    async def delete_file(self, filename: str) -> bool:
        """Remove all chunks from a specific file. Rebuilds the index."""
        if filename not in self.files:
            return False

        with self.lock:
            # Filter out chunks from this file
            keep = [(i, m) for i, m in enumerate(self.metadata) if m["filename"] != filename]
            if len(keep) == len(self.metadata):
                return False

            # Rebuild index with remaining vectors
            new_index = faiss.IndexFlatL2(EMBEDDING_DIM)
            if keep:
                old_indices = [i for i, _ in keep]
                # Reconstruct vectors from old index
                vectors = np.zeros((len(old_indices), EMBEDDING_DIM), dtype=np.float32)
                for j, old_idx in enumerate(old_indices):
                    self.index.reconstruct(old_idx, vectors[j])
                new_index.add(vectors)

            self.index = new_index
            self.metadata = [m for _, m in keep]
            # Re-index vector_idx
            for i, m in enumerate(self.metadata):
                m["vector_idx"] = i
            del self.files[filename]

        self._save()
        print(f"[rag] Deleted file '{filename}' — {self.index.ntotal} vectors remain.")
        return True
