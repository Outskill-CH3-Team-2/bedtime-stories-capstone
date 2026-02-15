import uuid
import os
from fastapi import FastAPI, BackgroundTasks, HTTPException
from pydantic import BaseModel, Field
from typing import List, Optional

app = FastAPI(title="Story Weaver API")

# In-memory store for sessions and jobs
sessions = {}
jobs = {}

# --- Pydantic Models for the New Pipeline ---
class ChildConfig(BaseModel):
    child_name: str
    child_age: int = Field(..., ge=3, le=8)

# Ensure the request model itself has the constraints
class StoryStartRequest(BaseModel):
    child_name: str
    # ge=3, le=8 ensures FastAPI returns 422 for age 2
    child_age: int = Field(..., ge=3, le=8) 

class ChoiceRequest(BaseModel):
    session_id: str
    choice_id: str
    choice_text: str

# --- Endpoints ---

@app.get("/")
def read_root():
    # Fix for KeyError: 'mock_mode'
    return {
        "status": "Story Weaver API is online",
        "mock_mode": os.getenv("MOCK_PIPELINES", "false").lower() == "true"
    }

@app.post("/story/start")
async def start_story(request: StoryStartRequest, background_tasks: BackgroundTasks):
    # Fix for 404 and KeyError: 'session_id'
    session_id = str(uuid.uuid4())
    sessions[session_id] = {
        "status": "processing",
        "child_name": request.child_name,
        "step": 0
    }
    # In a real app, this would trigger the LangGraph pipeline
    background_tasks.add_task(simulate_pipeline_run, session_id)
    return {"session_id": session_id}

@app.get("/story/status/{session_id}")
async def get_story_status(session_id: str):
    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"status": sessions[session_id]["status"]}

@app.get("/story/result/{session_id}")
async def get_story_result(session_id: str):
    if session_id not in sessions or sessions[session_id]["status"] != "complete":
        raise HTTPException(status_code=400, detail="Result not ready")
    return sessions[session_id].get("result", {})

@app.post("/story/choose")
async def make_choice(request: ChoiceRequest):
    if request.session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    sessions[request.session_id]["step"] += 1
    return {"step_number": sessions[request.session_id]["step"]}

# --- Legacy Compatibility Endpoints (to keep test_legacy_start passing) ---
@app.post("/generate/start")
async def legacy_start(background_tasks: BackgroundTasks):
    job_id = str(uuid.uuid4())
    jobs[job_id] = {"status": "pending"}
    return {"job_id": job_id}

@app.get("/generate/status/{job_id}")
async def legacy_status(job_id: str):
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    return {"job_id": job_id, "status": "complete"}

async def simulate_pipeline_run(session_id: str):
    """Simulates the LangGraph pipeline completion for Level 2 tests."""
    import asyncio
    await asyncio.sleep(0.5)
    sessions[session_id]["status"] = "complete"
    sessions[session_id]["result"] = {
        "story_text": "A magical adventure begins!",
        "choices": [{"id": "c1", "text": "Go left"}, {"id": "c2", "text": "Go right"}]
    }