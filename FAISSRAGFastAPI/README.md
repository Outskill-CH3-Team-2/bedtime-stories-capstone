# Dream Weaver — Interactive AI Bedtime Stories

An AI-powered interactive bedtime story platform for children. A parent configures
the child's profile and uploads reference books; the child then types a story idea
and the app generates a fully personalised, narrated, illustrated story — scene by
scene — with branching choices driven by RAG-enriched content.

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Three-Process Stack                       │
├──────────────────┬──────────────────┬───────────────────────────┤
│  Backend API     │  Child View      │  Parent Dashboard         │
│  FastAPI / 8000  │  Dream Weaver    │  story-weaver-ui          │
│                  │  Vite / 3000     │  Vite / 5173              │
│  • Story pipeline│  • Story reader  │  • Upload reference books │
│  • RAG / FAISS   │  • Page-flip UI  │  • RAG story tester       │
│  • Session store │  • Audio player  │                           │
└──────────────────┴──────────────────┴───────────────────────────┘
```

---

## Architecture

### End-to-End Request Flow

```
Parent Dashboard (5173)
  │
  ├─ POST /api/v1/upload  ──► Backend parses PDF/EPUB, chunks text,
  │                           embeds with sentence-transformers,
  │                           indexes into FAISS
  │
Child View (3000)
  │
  ├─ POST /api/v1/generate  ─► Backend creates session, fires LangGraph
  │   (first chapter)          pipeline with RAG context injected
  │
  ├─ GET  /story/status/{job_id}  ◄── poll every 2s until "complete"
  │
  ├─ GET  /story/result/{job_id}  ◄── fetch SceneOutput
  │       (story_text, narration_audio_b64, illustration_b64, choices[])
  │
  └─ POST /story/generate  ──► subsequent chapters
      (session_id + choice_text)    (session history preserved)
```

### LangGraph Pipeline (per scene)

```
generate_text
  └─ Queries FAISS for relevant context (top-k=5 chunks, if books uploaded)
  └─ If RAG context found  → inject chunks into system prompt as REFERENCE MATERIAL
  └─ If no RAG context     → proceed with LLM-only generation (no block/error)
  └─ Calls LLM → story prose + 2 choices

safety_check
  └─ Content moderation (auto-pass or LLM judge)

retry_text  (if safety_check fails)
  └─ Re-runs generate_text with stricter prompt

generate_media  (text → TTS and text → image, concurrent)
  ├─ TTS  → narration WAV (base64)
  └─ Image → illustration PNG (base64)

assemble
  └─ Builds SceneOutput payload
  └─ Writes debug artefacts to backend/debug_output/ (if DEBUG=true)
```

> **RAG is optional, not required.** Stories generate freely via LLM when no
> books have been uploaded or when no relevant chunks are found in FAISS.
> Uploaded books enrich the story style and content — they do not gate generation.

### Pre-Generation (zero-wait transitions)

After each scene loads, the Child View fires **one job per available choice** in
parallel. When the child taps a choice, the result is already cached and displayed
instantly. If the cache misses, it falls back to live polling.

---

## Project Structure

```
bedtime-stories-capstone/
│
├── backend/
│   ├── main.py                  # FastAPI app — all endpoints
│   ├── contracts.py             # Pydantic models (ChildConfig, SceneOutput, …)
│   ├── session_store.py         # In-memory session + job stores, task registry
│   ├── orchestrator/
│   │   └── pipeline.py          # LangGraph 5-node pipeline
│   ├── pipelines/
│   │   ├── text.py              # LLM text generation + response parser
│   │   ├── tts.py               # TTS via OpenRouter (gpt-4o-audio-preview)
│   │   ├── image.py             # Image generation via DALL-E / OpenRouter
│   │   └── provider.py          # OpenRouter HTTP client factory
│   ├── safety/
│   │   ├── classifier.py        # LLM-based safety judge
│   │   └── filters.py           # Input sanitisation + RAG injection stripping
│   └── config/
│       ├── prompts.yaml         # System and story prompts
│       └── models.yaml          # Model IDs per pipeline stage
│
├── frontend/                    # Child View — Dream Weaver (port 3000)
│   ├── App.tsx                  # Root: state, polling, audio ref, pre-generation
│   ├── index.html               # Fonts (Cinzel + Crimson Text), global CSS
│   ├── types.ts                 # Scene, Choice, StoryConfig, StoryState
│   ├── components/
│   │   ├── Book.tsx             # Page-flip book reader (StPageFlip)
│   │   ├── ConfigurationPage.tsx# Child profile modal (name, age, preferences)
│   │   └── LandingCanvas.tsx    # Particle starfield animation
│   └── services/
│       ├── storyService.ts      # API client → /api/v1/generate + /story/*
│       └── storyCache.ts        # 3-tier cache: L1 memory, L2 IndexedDB, L3 API
│
├── frontend/story-weaver-ui/    # Parent Dashboard (port 5173)
│   └── src/
│       ├── App.tsx              # Tab shell — active: Generate Stories from PDF
│       ├── api.ts               # Axios client → all backend endpoints (upload timeout: 10 min)
│       └── components/
│           ├── RagUploadTab.tsx # Upload + index PDF/EPUB; duplicate detection; localStorage history
│           └── RagStoryTab.tsx  # (hidden) RAG story generation + scene viewer
│
├── requirements.txt             # Python dependencies (pinned)
├── .env                         # API keys (not committed — see Setup)
└── README.md                    # This file
```

---

## API Endpoints

### Story Pipeline

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/generate` | Start first chapter (RAG-enhanced). Returns `{session_id, job_id}` |
| `POST` | `/story/generate` | Continue story (next chapter). Requires `session_id + choice_text` |
| `GET`  | `/story/status/{job_id}` | Poll job status: `pending \| running \| complete \| failed` |
| `GET`  | `/story/result/{job_id}` | Fetch completed `SceneOutput` |
| `POST` | `/story/character` | Add a character reference image to the session |

### RAG / Document Management

| Method | Path | Description |
|--------|------|-------------|
| `POST`   | `/api/v1/upload` | Upload PDF or EPUB → parse, chunk, embed, index into FAISS |
| `DELETE` | `/api/v1/upload/{file_id}` | Remove a file's chunks from the FAISS index |
| `GET`    | `/health` | Backend health + RAG index status |

### Request Bodies

**`POST /api/v1/generate`** — first chapter
```json
{
  "prompt": "A brave knight who befriends a dragon",
  "child_name": "Arlo",
  "age_group": "6",
  "story_length": "10_minutes",
  "voice": "onyx",
  "favourite_colour": "blue",
  "favourite_animal": "dog",
  "favourite_food": "pizza",
  "favourite_activities": ["football"],
  "pet_name": "Biscuit",
  "pet_type": "rabbit",
  "place_to_visit": "beach"
}
```

**`POST /story/generate`** — continuation
```json
{
  "session_id": "uuid",
  "choice_text": "The knight approaches the dragon slowly"
}
```

**`SceneOutput`** — response from `/story/result/{job_id}`
```json
{
  "session_id": "uuid",
  "step_number": 1,
  "is_ending": false,
  "story_text": "Once upon a time…",
  "narration_audio_b64": "<base64 WAV>",
  "illustration_b64": "<base64 PNG>",
  "choices": [
    { "id": "a", "text": "Approach the dragon slowly" },
    { "id": "b", "text": "Run back to the castle" }
  ]
}
```

---

## Child View — Dream Weaver (port 3000)

### User Flow

```
1. Landing screen (dark starfield)
     └─ Child types a story idea → "Open the Book"

2. Configuration modal (if first visit or parent resets)
     └─ Child name, age, favourite colour / animal / food / activity
     └─ Pet name & type, friend name, family details
     └─ Child photo (for protagonist reference)
     └─ Saved to IndexedDB — persists across sessions

3. Intro screen — video plays while first scene generates
     └─ "Writing your story…" spinner → green "Ready" badge
     └─ "Open the Book" button unlocks when scene is ready

4. Book reader (page-flip)
     └─ Left page: AI-generated illustration
     └─ Right page: story prose + choice buttons + audio controls
     └─ Audio auto-plays narration; can pause / resume
     └─ Choice buttons light up when next scenes are pre-generated
     └─ Tap a choice → instant transition (pre-generated) or live poll

5. Story ends
     └─ "The End" ornament on final page
     └─ "Rewind the Clock" to start a new story
```

### Caching (3-tier)

| Tier | Storage | TTL |
|------|---------|-----|
| L1 | In-memory Map | session lifetime |
| L2 | IndexedDB (scenes, sessions, prefired jobs) | 24 hours |
| L3 | Backend API | on demand |

### Tech Stack

- React 19 + TypeScript, Vite, StPageFlip (page-flip library)
- Tailwind CSS (CDN) + Cinzel / Crimson Text fonts
- Inline styles for dynamic theming (warm parchment ↔ dark starfield)

---

## Parent Dashboard — story-weaver-ui (port 5173)

### Generate Stories from PDF Tab

1. Drag-and-drop or click to select a **PDF** or **EPUB** file (max 50 MB)
2. **Duplicate detection** — if a file with the same name was already uploaded,
   a warning is shown with the original upload time and chunk count; the parent
   can choose **Upload Anyway** (replaces the existing index entry) or **Cancel**
3. Upload history is **persisted in `localStorage`** — survives page refresh
4. Click **Upload & Index** — backend parses, chunks, embeds, stores in FAISS
5. Indexed files appear in the list with chunk count
6. Delete button removes a file's chunks from FAISS immediately
7. Upload timeout: **10 minutes** (allows large books)

> **Hidden tabs** (disabled by default, re-enable in `App.tsx`):
> Health, Story Pipeline, Debug STT, RAG Story — these remain in the codebase
> as commented-out imports for developer use.

### Design

Matches the Dream Weaver aesthetic: dark starfield background, warm parchment
cards, Cinzel + Crimson Text fonts, saddle-brown accents.

### Parent Dashboard Link in Child View

Parents can reach the dashboard directly from the child view settings panel
(gear icon → **Parent Dashboard** section → **Open Parent Dashboard** button).
This lets parents upload additional books without navigating away manually.

---

## RAG Pipeline Detail

```
Upload flow:
  PDF / EPUB file
    └─ PyMuPDF (PDF) or ebooklib (EPUB) → extract raw text pages
    └─ LangChain RecursiveCharacterTextSplitter (chunk_size=800, overlap=100)
    └─ sentence-transformers (all-MiniLM-L6-v2) → 384-dim embeddings
    └─ FAISS IndexFlatL2 → persisted to faiss_store/

Generation flow:
  Story idea + child config
    └─ Query FAISS with story_idea (top-k=5 chunks)
    └─ Sanitize chunks (strip prompt-injection patterns)
    └─ Inject into system prompt as "REFERENCE MATERIAL"
    └─ LLM generates story text with stylistic influence from reference
```

---

## Prerequisites

- **Python 3.12+**
- **Node.js 18+**
- **OpenRouter API key** — text generation, TTS, and image generation all route
  through [openrouter.ai](https://openrouter.ai)

---

## Setup

### 1. Backend

```bash
git clone <repo-url>
cd bedtime-stories-capstone

python -m venv myenv
# Windows
source myenv/Scripts/activate
# macOS / Linux
source myenv/bin/activate

pip install -r requirements.txt
```

### 2. Child View

```bash
cd frontend
npm install
```

### 3. Parent Dashboard

```bash
cd frontend/story-weaver-ui
npm install
```

### 4. Environment variables

Create `.env` in the project root:

```env
OPENROUTER_API_KEY=sk-or-v1-...

# Optional
OPENROUTER_REFERER=http://localhost:3000
DEBUG=false          # set true to write scene files to backend/debug_output/
MOCK_PIPELINES=false # set true to skip AI calls (returns dummy scenes)
MAX_UPLOAD_MB=50     # maximum file size for RAG uploads
```

---

## Running

**Three terminals required — start in this order:**

```bash
# Terminal 1 — Backend (must start first)
cd bedtime-stories-capstone
source myenv/Scripts/activate
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000

# Terminal 2 — Child View
cd bedtime-stories-capstone/frontend
npm run dev
# → http://localhost:3000

# Terminal 3 — Parent Dashboard
cd bedtime-stories-capstone/frontend/story-weaver-ui
npm run dev
# → http://localhost:5173
```

---

## Recommended Workflow

1. **Parent** opens **http://localhost:5173** → **Generate Stories from PDF** tab
   and uploads reference PDF/EPUB books (fairy tales, bedtime stories, specific authors)
   — if a book was uploaded before, a duplicate warning prompts to confirm before re-indexing
2. **Parent** opens **http://localhost:3000** and sets up the child's profile
   (name, age, preferences) via the settings gear icon; the **Open Parent Dashboard**
   button in settings links directly back to step 1
3. **Child** types a story idea and taps "Open the Book"
4. The AI generates a personalised story — enriched by uploaded books if available,
   or generated freely by the LLM if no books have been uploaded yet
5. Child reads, listens, and picks choices — each scene pre-generates in the background
6. **Parent** can upload more books at any time to enrich future stories

---

## Testing

| Level | Scope | Needs API key |
|-------|-------|---------------|
| 1 — Unit | `parse_response`, pipeline logic, mocked AI | No |
| 2 — API | FastAPI endpoints via `TestClient` | No |
| 3 — Smoke | Single real calls to text / TTS / image | Yes |
| 4 — E2E | Full multi-turn story through live pipeline | Yes |

```bash
# No API key required
python -m pytest tests/test_pipeline_local.py -v -m "not requires_key"

# Real API (costs ~$0.01–$0.10)
python -m pytest tests/test_pipeline_local.py -v -k "Level3 or Level4"
```

---

## Debug Mode

Set `DEBUG=true` in `.env` to write every generated scene to `backend/debug_output/`:

```
backend/debug_output/
  20260315T120000Z_<job-id>_step0.txt   ← story text + metadata
  20260315T120000Z_<job-id>_step0.wav   ← raw PCM audio
  20260315T120000Z_<job-id>_step0.png   ← illustration
```

---

## Security & Privacy Notes

- Child names, prompts, and choice text are **never logged** to the console
- RAG chunks are sanitised to strip prompt-injection patterns before LLM injection
- Uploaded files are deleted from disk immediately after FAISS indexing
- Stale uploads (> 1 hour old) are purged on backend startup
- The debug STT endpoint returns 404 unless `DEBUG=true`
- The Parent Dashboard (port 5173) is a separate process — children using port 3000
  have no code path to RAG upload or admin endpoints
