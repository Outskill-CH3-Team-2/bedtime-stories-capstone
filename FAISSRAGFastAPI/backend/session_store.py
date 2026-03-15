"""
session_store.py — In-memory session store for StoryState objects.

Sessions expire after SESSION_TTL_SECONDS (default 1 hour).
A background asyncio task runs every 5 minutes to prune stale sessions.

Usage:
    from backend.session_store import session_store
    session_store.set(state.session_id, state)
    state = session_store.get(session_id)
"""

from __future__ import annotations

import asyncio
import os
import time
from typing import Optional, Set

from backend.contracts import StoryState, JobState

SESSION_TTL_SECONDS = int(os.getenv("SESSION_TTL_SECONDS", "3600"))  # default 1 hour
CLEANUP_INTERVAL_SECONDS = int(os.getenv("CLEANUP_INTERVAL_SECONDS", "300"))  # default 5 minutes


class SessionStore:
    def __init__(self) -> None:
        self._store: dict[str, tuple[StoryState, float]] = {}
        # timestamp → (state, created_at)
        self._cleanup_task: Optional[asyncio.Task] = None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def get(self, session_id: str) -> Optional[StoryState]:
        """Return the StoryState for session_id, or None if not found / expired."""
        entry = self._store.get(session_id)
        if entry is None:
            return None
        state, created_at = entry
        if time.monotonic() - created_at > SESSION_TTL_SECONDS:
            del self._store[session_id]
            return None
        return state

    def set(self, session_id: str, state: StoryState) -> None:
        """Store or overwrite a StoryState, refreshing its creation timestamp."""
        self._store[session_id] = (state, time.monotonic())

    def delete(self, session_id: str) -> None:
        """Remove a session if it exists."""
        self._store.pop(session_id, None)

    def count(self) -> int:
        """Return the number of active (non-expired) sessions."""
        now = time.monotonic()
        return sum(
            1
            for _, (_, created_at) in self._store.items()
            if now - created_at <= SESSION_TTL_SECONDS
        )

    # ------------------------------------------------------------------
    # Background cleanup
    # ------------------------------------------------------------------

    async def _cleanup_loop(self) -> None:
        """Periodically remove sessions older than SESSION_TTL_SECONDS."""
        while True:
            await asyncio.sleep(CLEANUP_INTERVAL_SECONDS)
            self._prune()

    def _prune(self) -> None:
        now = time.monotonic()
        expired = [
            sid
            for sid, (_, created_at) in self._store.items()
            if now - created_at > SESSION_TTL_SECONDS
        ]
        for sid in expired:
            del self._store[sid]
        if expired:
            print(f"[session_store] Pruned {len(expired)} expired session(s).")

    def start_cleanup_task(self) -> None:
        """
        Start the background cleanup loop.
        Call this from the FastAPI lifespan startup event.
        """
        if self._cleanup_task is None or self._cleanup_task.done():
            self._cleanup_task = asyncio.create_task(self._cleanup_loop())

    def stop_cleanup_task(self) -> None:
        """Cancel the background cleanup loop on shutdown."""
        if self._cleanup_task and not self._cleanup_task.done():
            self._cleanup_task.cancel()


# Singleton — import and use this everywhere
session_store = SessionStore()


class JobStore:
    """
    In-memory store for generation jobs (job_id → JobState).
    Jobs expire with their parent session (TTL reuses SESSION_TTL_SECONDS).
    A background cleanup task runs on the same interval as SessionStore.

    Task registry
    -------------
    register_task(session_id, task) associates an asyncio.Task with a session.
    cancel_session_tasks(session_id) cancels all registered tasks for that
    session — called automatically on prune / manual delete.
    """

    def __init__(self) -> None:
        self._store: dict[str, tuple[JobState, float]] = {}
        # Maps session_id → latest job_id so callers can look up by session.
        # Populated by create() and cleaned up by prune() — never leaks.
        self._session_latest: dict[str, str] = {}
        # Maps session_id → set of active asyncio.Tasks
        self._session_tasks: dict[str, Set[asyncio.Task]] = {}
        self._cleanup_task: Optional[asyncio.Task] = None

    def register_task(self, session_id: str, task: asyncio.Task) -> None:
        """Track an asyncio.Task so it can be cancelled when the session expires."""
        self._session_tasks.setdefault(session_id, set()).add(task)
        # Remove the task from the set automatically when it completes
        task.add_done_callback(
            lambda t: self._session_tasks.get(session_id, set()).discard(t)
        )

    def cancel_session_tasks(self, session_id: str) -> int:
        """Cancel all pending tasks for session_id.  Returns number cancelled."""
        tasks = self._session_tasks.pop(session_id, set())
        cancelled = 0
        for t in tasks:
            if not t.done():
                t.cancel()
                cancelled += 1
        return cancelled

    def create(self, session_id: str) -> JobState:
        """Create a new PENDING job for session_id, store it, return it."""
        job = JobState(session_id=session_id)
        self._store[job.job_id] = (job, time.monotonic())
        self._session_latest[session_id] = job.job_id
        return job

    def get(self, job_id: str) -> Optional[JobState]:
        entry = self._store.get(job_id)
        if entry is None:
            return None
        job, created_at = entry
        if time.monotonic() - created_at > SESSION_TTL_SECONDS:
            del self._store[job_id]
            if self._session_latest.get(job.session_id) == job_id:
                del self._session_latest[job.session_id]
            return None
        return job

    def get_latest_for_session(self, session_id: str) -> Optional[JobState]:
        """Return the most recent job for a session_id, or None if not found."""
        job_id = self._session_latest.get(session_id)
        return self.get(job_id) if job_id else None

    def update(self, job: JobState) -> None:
        """Overwrite an existing job entry (preserves original timestamp)."""
        entry = self._store.get(job.job_id)
        ts = entry[1] if entry else time.monotonic()
        self._store[job.job_id] = (job, ts)

    def prune(self) -> None:
        now = time.monotonic()
        expired = [(jid, job) for jid, (job, ts) in self._store.items()
                   if now - ts > SESSION_TTL_SECONDS]
        cancelled_total = 0
        seen_sessions: set[str] = set()
        for jid, job in expired:
            del self._store[jid]
            if self._session_latest.get(job.session_id) == jid:
                del self._session_latest[job.session_id]
            if job.session_id not in seen_sessions:
                seen_sessions.add(job.session_id)
                cancelled_total += self.cancel_session_tasks(job.session_id)
        if expired:
            print(
                f"[job_store] Pruned {len(expired)} expired job(s)"
                + (f", cancelled {cancelled_total} task(s)." if cancelled_total else ".")
            )

    async def _cleanup_loop(self) -> None:
        while True:
            await asyncio.sleep(CLEANUP_INTERVAL_SECONDS)
            self.prune()

    def start_cleanup_task(self) -> None:
        if self._cleanup_task is None or self._cleanup_task.done():
            self._cleanup_task = asyncio.create_task(self._cleanup_loop())

    def stop_cleanup_task(self) -> None:
        if self._cleanup_task and not self._cleanup_task.done():
            self._cleanup_task.cancel()


job_store = JobStore()
