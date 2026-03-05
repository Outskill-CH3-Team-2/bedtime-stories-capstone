# 📚 RAG Story Generator API

A FastAPI-powered Retrieval-Augmented Generation (RAG) pipeline that generates
children's bedtime stories using your uploaded eBook library as style references.

---

## Architecture

```
PDF/EPUB Upload → Text Extraction → Chunking → HuggingFace Embeddings
                                                        ↓
Story Prompt → Semantic Search → FAISS Vector Store → Retrieved Passages
                                                        ↓
                                              GPT-4 Story Generation
                                           (style-augmented by passages)
```

---

## Quick Start

### 1. Clone / set up project

```bash
mkdir rag-story-api && cd rag-story-api
# Place main.py, requirements.txt, .env.example in this folder
```

### 2. Create virtual environment

```bash
python -m venv venv
source venv/bin/activate        # macOS/Linux
venv\Scripts\activate           # Windows
```

### 3. Install dependencies

```bash
pip install -r requirements.txt
```

> **Note:** On first run, `sentence-transformers` will download the
> `all-MiniLM-L6-v2` model (~90MB). This only happens once and is cached locally.

### 4. Configure environment

```bash
cp .env.example .env
# Edit .env and add your OpenAI API key:
nano .env
```

Required in `.env`:
```
OPENAI_API_KEY=sk-your-key-here
```

### 5. Start the server

```bash
uvicorn main:app --reload --port 8000
```

The API will be available at:
- **API:** http://localhost:8000
- **Swagger UI:** http://localhost:8000/docs
- **ReDoc:** http://localhost:8000/redoc

### 6. Open the Test Console

Open `test_app.html` in your browser — it connects to `http://localhost:8000` by default.

---

## Typical Workflow

```
1. Upload book   →  POST /api/v1/upload
2. Embed book    →  POST /api/v1/embed      (uses the file_id from step 1)
3. Generate!     →  POST /api/v1/generate-story
```

---

## API Reference

### `GET /health`
Verify the server is running and FAISS index is ready.

```bash
curl http://localhost:8000/health
```
```json
{"status": "ok", "version": "1.0.0", "faiss_ready": false}
```

---

### `POST /api/v1/upload`
Upload a PDF or EPUB file.

```bash
curl -X POST http://localhost:8000/api/v1/upload \
  -F "file=@/path/to/your/book.pdf" \
  -F 'metadata={"title":"Charlotte Web","author":"E.B. White","age_group":"6-8"}'
```
```json
{
  "file_id": "a3f7bc2d-1234-5678-abcd-ef0123456789",
  "filename": "book.pdf",
  "status": "uploaded",
  "size_mb": 2.4,
  "message": "File saved successfully. Call /api/v1/embed to process it."
}
```

---

### `POST /api/v1/embed`
Parse the file and create FAISS vector embeddings.

```bash
curl -X POST http://localhost:8000/api/v1/embed \
  -H "Content-Type: application/json" \
  -d '{
    "file_id": "a3f7bc2d-1234-5678-abcd-ef0123456789",
    "chunk_size": 500,
    "chunk_overlap": 50
  }'
```
```json
{
  "file_id": "a3f7bc2d-...",
  "status": "embedded",
  "chunks_created": 142,
  "embedding_model": "all-MiniLM-L6-v2",
  "vector_store_size": 142,
  "processing_time_seconds": 4.2
}
```

---

### `POST /api/v1/generate-story`
Generate a children's story using the RAG pipeline.

```bash
curl -X POST http://localhost:8000/api/v1/generate-story \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A brave little fox who learns to share with her forest friends",
    "age_group": "4-6",
    "story_length": "10_minutes",
    "top_k": 5,
    "temperature": 0.85
  }'
```
```json
{
  "story_title": "Fiora and the Golden Acorn",
  "story": "Deep in the Whispering Wood, where the oak trees...",
  "word_count": 1387,
  "estimated_read_time_minutes": 10,
  "age_group": "4-6",
  "retrieved_passages_count": 5,
  "model_used": "gpt-4",
  "prompt_used": "A brave little fox who learns to share..."
}
```

**Story length options:**
| Value | Target Words | Read Time |
|---|---|---|
| `5_minutes` | ~700 words | 5 min |
| `10_minutes` | ~1400 words | 10 min |
| `15_minutes` | ~2100 words | 15 min |

---

### `POST /api/v1/search`
Semantic search against the knowledge base (admin/debug tool).

```bash
curl -X POST http://localhost:8000/api/v1/search \
  -H "Content-Type: application/json" \
  -d '{"query": "a lonely rabbit looking for friends", "top_k": 3}'
```
```json
{
  "query": "a lonely rabbit looking for friends",
  "results": [
    {
      "text": "The velveteen rabbit sat alone on the...",
      "score": 0.923,
      "source": "velveteen_rabbit.epub",
      "chunk_index": 14,
      "file_id": "..."
    }
  ]
}
```

---

### `GET /api/v1/knowledge-base/status`
View stats about the FAISS vector store.

```bash
curl http://localhost:8000/api/v1/knowledge-base/status
```
```json
{
  "total_vectors": 1024,
  "total_documents": 7,
  "embedding_model": "all-MiniLM-L6-v2",
  "faiss_index_type": "IndexFlatL2",
  "store_size_mb": 12.4,
  "is_ready": true
}
```

---

### `GET /api/v1/files`
List all uploaded files.

```bash
curl http://localhost:8000/api/v1/files
```

---

### `DELETE /api/v1/files/{file_id}`
Remove a file and all its vectors.

```bash
curl -X DELETE http://localhost:8000/api/v1/files/a3f7bc2d-1234-5678-abcd-ef0123456789
```
```json
{"file_id": "...", "status": "deleted", "vectors_removed": 142}
```

---

## Error Responses

All errors return:
```json
{"error": "ErrorType", "detail": "Human readable message"}
```

| HTTP Code | Error Type | Cause |
|---|---|---|
| 400 | UnsupportedFileType | Not a PDF or EPUB |
| 404 | Not Found | file_id does not exist |
| 413 | FileTooLarge | File exceeds 50MB |
| 422 | Unprocessable | Corrupt or unreadable file |
| 503 | EmptyVectorStore | No books embedded yet |
| 502 | LLMGenerationError | OpenAI API error |

---

## Project Structure

```
rag-story-api/
├── main.py              ← Single-file FastAPI application
├── requirements.txt     ← Python dependencies
├── .env.example         ← Environment variable template
├── .env                 ← Your configuration (gitignored)
├── test_app.html        ← Interactive browser test console
├── README.md            ← This file
├── uploads/             ← Uploaded PDF/EPUB files (auto-created)
└── faiss_store/         ← FAISS index + metadata (auto-created)
    ├── index.faiss
    ├── metadata.json
    └── files_registry.json
```

---

## Notes

- The embedding model (`all-MiniLM-L6-v2`) runs **locally** — no API key needed for embeddings
- The FAISS index **persists to disk** — your library survives server restarts
- For best story quality, upload books in the target age group's reading level
- EPUB files often yield better results than PDFs (cleaner text extraction)
- The `temperature` parameter controls creativity: `0.7` = consistent, `0.95` = more creative

---

## Troubleshooting

**"EmptyVectorStore" error on generate-story:**
You need to upload at least one PDF/EPUB and call `/api/v1/embed` before generating stories.

**Slow first embed:**
The HuggingFace model downloads on first run (~90MB). Subsequent runs use the cache.

**CORS errors in test app:**
Make sure your FastAPI server is running with `--reload` on port 8000.

**"OPENAI_API_KEY not configured":**
Check your `.env` file has a valid `OPENAI_API_KEY=sk-...` entry.
