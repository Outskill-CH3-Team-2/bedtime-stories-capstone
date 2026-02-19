# Interactive Bedtime Stories (Capstone)

Team repo for the Interactive Bedtime Stories project.

## Docs
- PRD: see /docs
- Demo script: see /docs
- Decisions: DECISIONS.md
- Runbook: RUNBOOK.md

## Quick start
Work in progress. See RUNBOOK.md.

# Interactive Bedtime Stories (Capstone)

Team repo for the Interactive Bedtime Stories project.

## Docs
- PRD: see /docs
- Demo script: see /docs
- Decisions: DECISIONS.md
- Runbook: RUNBOOK.md

---

## Project Setup

### 1. Project Structure
The repository is organized to support an asynchronous "Fire and Poll" architecture, separating mock data from application logic:

* **`backend/`**: Contains the FastAPI implementation and the main entry point (`main.py`).
* **`backend/services/`**: Includes the `llm_service.py` module, pre-configured for future OpenRouter integration.
* **`mock_responses/`**: Houses static JSON files (e.g., `initial_story.json`) that define the story segments, choices, and media metadata.
* **`tests/`**: Contains `test_api.py` for automated end-to-end flow validation.
* **`requirements.txt`**: Lists all necessary Python dependencies (FastAPI, Uvicorn, Requests, etc.).

### 2. Prerequisites & API Keys
* **Python 3.12.x**: This project is built and tested using Python 3.12.
* **OpenRouter Access**: While the current backend uses mock data, you will need an API key for live LLM features.
* **Environment Variables**: Create a `.env` file in the root directory and add your key:
    ```text
    OPENROUTER_API_KEY=your_api_key_here
    ```

### 3. Installation & Environment
1.  **Create a Virtual Environment**:
    ```bash
    python -m venv venv
    ```
2.  **Activate the Environment**:
    * **Windows**: `venv\Scripts\activate`
    * **macOS/Linux**: `source venv/bin/activate`
3.  **Install Dependencies**:
    ```bash
    pip install -r requirements.txt
    ```

### 4. Running the Mock Backend
The mock service simulates the processing of AI story generation by loading externalized JSON content with a 2-second simulated delay.

1.  Navigate to the `backend` folder:
    ```bash
    cd backend
    ```
2.  Launch the server:
    ```bash
    uvicorn main:app --reload
    ```
3.  The API will be live at `http://127.0.0.1:8000`.

### 5. Running the Tests
To ensure the "Fire and Poll" logic and the mock response loading are working correctly:

1.  Ensure the FastAPI server is running in one terminal.
2.  Open a second terminal and run the test script:
    ```bash
    python tests/test_api.py
    ```
3.  The test script will output the job ID, show polling progress, and print the generated story text once the state transitions to `completed`.

# 🧪 Testing the AI Pipeline

The project features a layered testing suite for the LangGraph orchestrator. These tests are designed to be run from the root directory.

### Test Levels
We use a "Level" system to allow testing even without active API keys:

* **Level 1 (Unit):** Pure logic tests. No API key needed. Mocks all AI calls.
* **Level 2 (API):** Tests FastAPI endpoints using `TestClient`. No API key needed.
* **Level 3 (Smoke):** Makes **real** single calls to OpenRouter (Text, TTS, Image). *Requires API Key.*
* **Level 4 (E2E):** Runs a full multi-turn story through the real pipeline. *Requires API Key.*

### How to Run

**1. Run all safe tests (No API key required):**
```bash
python -m pytest tests/test_pipeline_local.py -v -m "not requires_key"
```

**2. Run specific levels:**
```bash
# Only Unit Tests
python -m pytest tests/test_pipeline_local.py -v -k "Level1"

# Real API Integration Tests (Cost: ~$0.01 - $0.10)
python -m pytest tests/test_pipeline_local.py -v -k "Level3 or Level4"
```

**3. Standalone Runner (Alternative):**
If you don't have `pytest` installed, you can run the suite directly:
```bash
python tests/test_pipeline_local.py
```

> **Note:** Level 3 and 4 tests will be automatically skipped if `OPENROUTER_API_KEY` is not detected in your `.env` file.
