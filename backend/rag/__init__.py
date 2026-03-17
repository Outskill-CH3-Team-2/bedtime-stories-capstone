"""
backend/rag — Lightweight RAG module for Story Weaver.

Upload PDFs (storybooks, exported stories) → chunk → embed via OpenRouter → FAISS index.
At story start, query the index with story_idea → return relevant context for prompt injection.
"""

from backend.rag.store import RAGStore

# Singleton instance — initialized lazily on first use
_store: RAGStore | None = None


def get_store() -> RAGStore:
    global _store
    if _store is None:
        _store = RAGStore()
    return _store
