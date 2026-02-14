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