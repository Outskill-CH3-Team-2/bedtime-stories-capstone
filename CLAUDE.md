# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Dream Weaver** — A personalized bedtime story generator for children ages 3-8. A FastAPI backend orchestrates a LangGraph pipeline that generates narrative text, illustrations, and narration audio, all routed through OpenRouter as a single AI gateway.

## DEADLINE: 18 MARZO 2026 (corso Outskill AI Engineering)

### Stato attuale (18 marzo 2026)

App funzionante end-to-end, testata manualmente e via API E2E. Branch `feature/final-polish` con PR #40 aperta verso main.

**Completati:**
- [x] PR #33: bug critici frontend (config screen, story_idea, button sync)
- [x] PR #34: prompt aggiornato per moral message
- [x] PR #38: side characters + config screen redesign + injection protection
- [x] Bug fix: TTS 402 short-circuit (no retry on insufficient balance)
- [x] Bug fix: debounce duplicate story starts (ref-based guard)
- [x] Bug fix: companion roles rispettati (Cat, Uncle, ecc.)
- [x] Bug fix: scelte bloccate fino a fine narrazione audio
- [x] Bug fix: duplicate story_system_prompt in YAML rimosso
- [x] Bug fix: image prompt migliorato per character consistency
- [x] Bug fix: image max_tokens capped at 4096 (was defaulting to 32768 → 402 errors)
- [x] Bug fix: safety max_tokens reduced 5000→500 (only returns small JSON)
- [x] Bug fix: scene 0 history committed before prefiring scene 1 (fixes LLM restarting story)
- [x] Bug fix: choices unlock when jobs fired, not when results cached (eliminates dead time)
- [x] RAG integration: FAISS + OpenRouter embeddings per story memory
- [x] PDF export: booklet A5 con illustrazioni e testo
- [x] Story memory: auto-save per espandere universo del bambino
- [x] Mobile UI: landscape hint, responsive adjustments
- [x] Deployment: Dockerfile, render.yaml, SPA serving
- [x] Presentation: course template filled, team photos (Tamas + Alessandro)
- [x] 34/34 test passing
- [x] E2E API test: 2-scene story verified (text + audio + image + choices)
- [x] PR #40 opened (feature/final-polish → main)

**Da fare:**
- [ ] Merge PR #40 to main
- [ ] Deploy online (Render/Railway)
- [ ] Finalize presentation in Google Slides (team fixing colors/alignment)
- [ ] Record demo video

## Commands

```bash
# Activate virtual environment (Python 3.13, venv named "bedtime")
source bedtime/bin/activate

# Install dependencies
pip install -r requirements.txt

# Run API server (must run from project root, not backend/)
bedtime/bin/python -m uvicorn backend.main:app --reload --port 8000

# Run frontend (separate terminal)
cd frontend && npm install && npm run dev

# Run all tests (Level 1+2 are free, Level 3+4 cost real API credits)
bedtime/bin/python -m pytest tests/test_pipeline_local.py -v

# Run only free tests (no API key needed)
bedtime/bin/python -m pytest tests/test_pipeline_local.py -v -m "not requires_key"

# Docker build (for deployment)
docker build -t dream-weaver .
docker run -e OPENROUTER_API_KEY=... -p 8000:8000 dream-weaver
```

## Architecture

### Fire-and-Poll API Pattern

POST endpoints (`/story/generate`, `/story/start`, `/story/choose`) trigger the LangGraph pipeline as a `BackgroundTask` and return immediately with a `session_id` + `job_id`. The client polls `GET /story/status/{id}` until status is `complete`, then fetches the result from `GET /story/result/{id}`. Sessions live in an in-memory store with 1-hour TTL — there is no database.

### LangGraph Pipeline (`backend/orchestrator/pipeline.py`)

A `StateGraph` with five nodes and conditional routing:

```
generate_text -> safety_check -> [retry_text ->] generate_media -> assemble -> END
```

- **generate_text** — Calls GPT-4o via OpenRouter to produce narrative + choices
- **safety_check** — GPT-4o-mini classifies content safety; returns `{passed, reason, flags}`
- **retry_text** — Re-generates with a safety nudge (max 1 retry, then fail-open)
- **generate_media** — Runs TTS and image generation in parallel via `asyncio.gather`
- **assemble** — Encodes media to base64, builds `SceneOutput`, appends to conversation history

Stories have a max of 8 steps. Step 6+ injects ending instructions; step 8 forces a final scene with moral lesson and no choices.

### RAG Module (`backend/rag/`)

FAISS vector store with OpenRouter embeddings (`text-embedding-3-small`). Three use cases:
1. **Admin upload** — Upload storybook PDFs to seed story generation
2. **Story memory** — Completed stories auto-saved for cross-session continuity
3. **Re-upload** — Exported story PDFs can be re-uploaded to expand the child's universe

At story start, the RAG store is queried with `story_idea`. If relevant content is found, it's injected into the prompt via `rag_injection` template. Graceful fallback if nothing found.

### AI Models (all via OpenRouter, configured in `backend/config/models.yaml`)

| Component | Model |
|-----------|-------|
| Text generation | `gpt-4o` |
| Safety classifier | `openai/gpt-4o-mini` |
| Image generation | `google/gemini-3.1-flash-image-preview` |
| TTS narration | `openai/gpt-4o-audio-preview` |
| Embeddings (RAG) | `openai/text-embedding-3-small` |

### Key Modules

- **`backend/contracts.py`** — All Pydantic models (`StoryState`, `SceneOutput`, `ChildConfig`, `CharacterRef`, `FamilyMemberInfo`, etc.).
- **`backend/pipelines/provider.py`** — `AsyncOpenAI` client factory pointing at OpenRouter's base URL, cached via `lru_cache`.
- **`backend/pipelines/text.py`** — Prompt building with structured CHILD PROFILE block, `_build_details()` for companion/family data, response parsing.
- **`backend/pipelines/image.py`** — Multimodal image gen with character reference images and animal/gender consistency hints.
- **`backend/pipelines/tts.py`** — Director+Actor expressive TTS pipeline. 402 short-circuit on insufficient balance.
- **`backend/safety/filters.py`** — 5-layer input sanitization (HTML, injection patterns, env-var detection, name validation).
- **`backend/config/prompts.yaml`** — All LLM prompt templates. Edit here, not in Python code.
- **`backend/rag/`** — FAISS vector store + PDF ingestion + OpenRouter embeddings.
- **`backend/export_pdf.py`** — PDF booklet generation with reportlab (A5 format, cover + scene pages).

### Character Consistency

Character reference images (base64 data URIs) are stored in the session's `characters` dict. The protagonist photo is sent at `/story/generate`; companions and family are registered via `/story/character` (or auto-generated via `/story/avatar`). The image prompt includes explicit animal/gender hints to prevent misrepresentation.

### Pre-generation Pattern

When a scene is displayed, BOTH choices are pre-generated in parallel (`/story/generate` with `choice_text`). Each runs as an independent job on a snapshot of the session state. When the child picks a choice, the cached result is shown instantly (no loading). This creates a seamless, book-like experience.

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/story/generate` | Unified endpoint: first chapter or next chapter |
| GET | `/story/status/{id}` | Poll job status |
| GET | `/story/result/{id}` | Get completed scene |
| POST | `/story/character` | Register side character reference image |
| POST | `/story/avatar` | Generate storybook portrait for a character |
| POST | `/story/upload` | Upload PDF for RAG context |
| GET | `/story/library` | List uploaded documents |
| DELETE | `/story/library/{filename}` | Remove document from RAG |
| POST | `/story/memory` | Save story summary for cross-session memory |
| POST | `/story/export` | Generate PDF booklet from completed story |

## Test Levels

- **Level 1** (unit) — Pure logic, no API key needed: contract validation, filter functions, prompt building, LangGraph routing, session store
- **Level 2** (API mocking) — FastAPI TestClient with `MOCK_PIPELINES=true` env var, no API key needed
- **Level 3** (smoke, ~$0.01) — Real single calls to text/safety/TTS/image endpoints, requires `OPENROUTER_API_KEY`
- **Level 4** (E2E, ~$0.05-0.10) — Full multi-turn story through real pipeline, requires `OPENROUTER_API_KEY`

## Environment

- `OPENROUTER_API_KEY` — Required for any real AI calls (Level 3+4 tests, running the server)
- `MOCK_PIPELINES=true` — Enables mock mode for Level 2 tests
- `STATIC_DIR` — Path to built frontend (Docker deployment only)
- Config is in `.env` (see `.env.example`)

## Deployment

Single Docker container serves both backend + built frontend:
```bash
docker build -t dream-weaver .
docker run -e OPENROUTER_API_KEY=sk-... -p 8000:8000 dream-weaver
```

Or deploy via Render using `render.yaml` (set `OPENROUTER_API_KEY` env var in dashboard).

# currentDate
Today's date is 2026-03-18.
