import uuid
import json
import asyncio
import os
from fastapi import FastAPI, BackgroundTasks, HTTPException
from pydantic import BaseModel
from typing import List, Optional

app = FastAPI(title="Story Weaver Mock Service")

# In-memory job storage for the 'Fire and Poll' pattern
jobs = {}

class StoryRequest(BaseModel):
    choice_text: Optional[str] = None
    history: List[dict] = []

@app.get("/")
def read_root():
    return {"status": "Story Weaver Mock API is online"}

async def simulate_story_generation(job_id: str):
    """
    Simulates AI processing delay and loads content from the mock-responses directory.
    """
    await asyncio.sleep(2) 
    
    # FIX: Go up one level to find mock_responses in the project root
    file_path = os.path.join("..", "mock_responses", "initial_story.json")
    
    try:
        if os.path.exists(file_path):
            with open(file_path, "r") as f:
                jobs[job_id]["result"] = json.load(f)
                jobs[job_id]["status"] = "completed"
        else:
            # This is why your test showed 'failed'
            jobs[job_id]["status"] = "failed"
            print(f"Error: {os.path.abspath(file_path)} not found.")
    except Exception as e:
        jobs[job_id]["status"] = "failed"
        print(f"Error loading mock data: {e}")
        
@app.post("/generate/start")
async def start_story(request: StoryRequest, background_tasks: BackgroundTasks):
    job_id = str(uuid.uuid4())
    jobs[job_id] = {"status": "processing", "result": None}
    
    # Execute the 'generation' in the background
    background_tasks.add_task(simulate_story_generation, job_id)
    
    return {"job_id": job_id}

@app.get("/generate/status/{job_id}")
async def get_status(job_id: str):
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    return {"job_id": job_id, "status": jobs[job_id]["status"]}

@app.get("/generate/result/{job_id}")
async def get_result(job_id: str):
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    if jobs[job_id]["status"] != "completed":
        raise HTTPException(status_code=400, detail="Result not ready or process failed")
    return jobs[job_id]["result"]
