import uuid
from fastapi import FastAPI, BackgroundTasks, HTTPException
from backend.contracts import StoryState, StoryStartRequest, ChoiceRequest, StoryStatus
from backend.orchestrator.pipeline import process_scene
from backend.session_store import session_store
from backend.safety.filters import sanitize_input

app = FastAPI(title="Story Weaver API")

# --- Background Task Wrapper ---
async def run_pipeline_task(session_id: str):
    """
    Fetches state, runs the LangGraph engine, and updates the store.
    """
    state = session_store.get(session_id)
    if not state:
        return

    try:
        # Run the full graph (Text -> Safety -> Media -> Assembly)
        scene_result = await process_scene(state)
        
        # Update state with the result
        state.last_result = scene_result
        state.status = StoryStatus.COMPLETE
    except Exception as e:
        print(f"[API] Pipeline failed for {session_id}: {e}")
        state.status = StoryStatus.FAILED
    finally:
        session_store.set(session_id, state)

# --- Endpoints ---

@app.post("/story/start")
async def start_story(request: StoryStartRequest, background_tasks: BackgroundTasks):
    # 1. Sanitize input
    safe_config = sanitize_input(request.config)
    
    # 2. Create initial state
    state = StoryState(
        config=safe_config,
        story_idea=request.story_idea
    )
    
    # 3. Store and Trigger
    session_store.set(state.session_id, state)
    background_tasks.add_task(run_pipeline_task, state.session_id)
    
    return {"session_id": state.session_id}

@app.post("/story/choose")
async def make_choice(request: ChoiceRequest, background_tasks: BackgroundTasks):
    state = session_store.get(request.session_id)
    if not state:
        raise HTTPException(status_code=404, detail="Session not found")
    
    if state.status != StoryStatus.COMPLETE:
        raise HTTPException(status_code=400, detail="Previous turn not finished")

    # 1. Update history with user choice
    state.step_number += 1
    state.messages.append({"role": "user", "content": request.choice_text})
    state.status = StoryStatus.PENDING
    
    # 2. Store and Trigger
    session_store.set(state.session_id, state)
    background_tasks.add_task(run_pipeline_task, state.session_id)
    
    return {"status": "accepted", "step": state.step_number}

@app.get("/story/status/{session_id}")
async def get_status(session_id: str):
    state = session_store.get(session_id)
    if not state:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"status": state.status}

@app.get("/story/result/{session_id}")
async def get_result(session_id: str):
    state = session_store.get(session_id)
    if not state:
        raise HTTPException(status_code=404, detail="Session not found")
    
    if state.status == StoryStatus.FAILED:
        raise HTTPException(status_code=500, detail="Story generation failed")
        
    if state.status != StoryStatus.COMPLETE:
        raise HTTPException(status_code=400, detail="Result not ready")
        
    return state.last_result