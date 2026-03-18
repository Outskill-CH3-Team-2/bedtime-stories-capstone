# Interactive Bedtime Stories

An AI-powered interactive bedtime story app for children. A child picks a story idea, and the app generates a personalised story scene-by-scene — each scene has narrated audio, an illustration, and two choices that drive the next scene.

---

## How it works

### Architecture overview

```
Frontend (React/Vite)  ──POST /story/generate──►  Backend (FastAPI)
                        ◄──{ session_id, job_id }──

Frontend polls GET /story/status/{job_id} until "complete"
Frontend fetches GET /story/result/{job_id}  ──► scene payload
```

The backend uses a **fire-and-poll** model: generation is async and the frontend polls for the result.

### Pipeline (per scene)

Each request to `/story/generate` queues a background job that runs the LangGraph pipeline:

```
node_generate_text
    └─ LLM (OpenRouter → gpt-4o) generates story prose + 2 choices
    └─ parse_response() splits narrative from [Choice A: ...] / [Choice B: ...]

node_safety_check (v02)
    └─ LLM (OpenRouter → gpt-4o-mini) evaluates text for age-appropriateness
    └─ Triggers a retry if the content is flagged as unsafe

node_generate_media  (runs text → TTS and text → image concurrently)
    ├─ TTS  (OpenRouter → gpt-4o-audio-preview, PCM16 @ 24kHz)
    └─ Image (OpenRouter → google/gemini-3.1-flash-image-preview-20260226, base64 PNG)

node_assemble
    └─ builds the scene payload: story_text, audio_b64, image_b64, choices[]
    └─ optionally writes debug artefacts to backend/debug_output/ (see DEBUG below)
```

### Pre-generation

After displaying a scene the frontend immediately fires **one job per choice** so the next scene is ready before the child picks. When the child chooses, the selected job's result is shown instantly and its conversation history is committed to the session.

### Session / job stores

Both stores are in-memory (`session_store.py`). Sessions hold the growing conversation history (LLM messages) and character reference images. Jobs hold status + result.

### v02 Advanced Features
* **RAG & Cross-Session Memory**: Vectors are stored in a FAISS index (`rag_data/index.faiss`). Uploaded PDFs are chunked and embedded. A story summary is saved to the store at Step 8, giving the app long-term memory.
* **Character Consistency & Avatars**: Base64 reference images are passed directly into the multimodal image generation prompt. If family members lack photos, `/story/avatar` generates a portrait.
* **PDF Export**: Completed stories can be exported as A5 PDF booklets via `/story/export` (emojis are stripped automatically to prevent rendering crashes).

---

## Project structure

```
bedtime-stories-capstone/
├── backend/
│   ├── main.py                  # FastAPI app, endpoints
│   ├── contracts.py             # Pydantic models (StoryState, StoryStatus, …)
│   ├── session_store.py         # In-memory session + job stores
│   ├── orchestrator/
│   │   └── pipeline.py          # LangGraph nodes: text → media → assemble
│   ├── pipelines/
│   │   ├── text.py              # LLM text generation + parse_response()
│   │   ├── tts.py               # Audio generation (gpt-4o-audio-preview)
│   │   ├── image.py             # Image generation (gemini-3.1-flash-image)
│   │   └── provider.py          # OpenRouter client factory
│   ├── config/
│   │   └── prompts.yaml         # System + story prompts
│   └── safety/
│       └── filters.py           # Input sanitisation
├── frontend/
│   ├── App.tsx                  # Main app shell, polling loop
│   ├── services/
│   │   └── storyService.ts      # API calls to the backend
│   ├── components/              # React UI components
│   └── types.ts                 # Shared TypeScript types
├── tests/
│   └── test_pipeline_local.py   # Layered test suite (see Testing below)
├── .env                         # API keys (not committed)
└── requirements.txt
```

---

## Prerequisites

- **Python 3.12+**
- **Node.js 18+** (or Bun)
- **OpenRouter API key** — the entire AI stack (text, TTS, image) runs through [openrouter.ai](https://openrouter.ai)

---

## Setup

### 1. Clone and install backend dependencies

```bash
git clone <repo-url>
cd bedtime-stories-capstone
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt
```

### 2. Install frontend dependencies

```bash
cd frontend
npm install
# or: bun install
```

### 3. Configure environment variables

Create a `.env` file in the project root:

```env
OPENROUTER_API_KEY=sk-or-v1-...

# Optional: write generated text/audio/image to backend/debug_output/ for inspection
# DEBUG=true
```

---

## Running the app

Open two terminals from the project root.

**Terminal 1 — backend:**

```bash
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```

API is available at `http://localhost:8000`.

**Terminal 2 — frontend:**

```bash
cd frontend
npm run dev
# or: bun dev
```

Frontend is available at `http://localhost:5173`.

---

## Testing

The test suite is layered — lower levels run without any API key.

| Level | What it tests | Needs API key? |
|-------|--------------|---------------|
| 1 — Unit | `parse_response`, pipeline logic, mocked AI calls | No |
| 2 — API | FastAPI endpoints via `TestClient` | No |
| 3 — Smoke | Single real calls to text / TTS / image APIs | Yes |
| 4 — E2E | Full multi-turn story through the live pipeline | Yes |

```bash
# Run everything that doesn't need a key
python -m pytest tests/test_pipeline_local.py -v -m "not requires_key"

# Run only unit tests
python -m pytest tests/test_pipeline_local.py -v -k "Level1"

# Run real API tests (costs ~$0.01–$0.10)
python -m pytest tests/test_pipeline_local.py -v -k "Level3 or Level4"
```

Level 3 and 4 tests are automatically skipped when `OPENROUTER_API_KEY` is not set.

---

## Debug: save generated artefacts to disk

Set `DEBUG=true` in `.env` to write every generated scene to `backend/debug_output/`:

```
backend/debug_output/
  20260223T011623Z_<job-id>_step0.txt   ← story text + metadata
  20260223T011623Z_<job-id>_step0.wav   ← raw PCM audio
  20260223T011623Z_<job-id>_step0.png   ← illustration
```

Files are named `{timestamp}_{job_id}_step{N}.{ext}`.