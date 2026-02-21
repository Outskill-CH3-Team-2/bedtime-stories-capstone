import asyncio
import httpx
import yaml
import base64
import os
import sys
import random  # Added for automation
from pathlib import Path

def load_config():
    if not os.path.exists("config.yaml"):
        print("❌ Error: config.yaml not found.")
        sys.exit(1)
    with open("config.yaml", "r") as f:
        return yaml.safe_load(f)

# Helper to load a local reference image for testing
def load_reference_image():
    for ext in ["png", "jpg", "jpeg"]:
        path = f"ref.{ext}"
        if os.path.exists(path):
            print(f"📸 Found reference image: {path}")
            with open(path, "rb") as f:
                return base64.b64encode(f.read()).decode("utf-8")
    print("⚠️ No 'ref.png' or 'ref.jpg' found. Generating without reference.")
    return None

async def run_demo():
    cfg_data = load_config()
    child_info = cfg_data["child_info"]
    personalization = cfg_data.get("personalization", {})
    
    # Inject reference image if found
    ref_b64 = load_reference_image()
    
    STORY_IDEA = "Tomorrow we are going to the dentist for the first time."
    
    print(f"🚀 Starting Automated Story: {STORY_IDEA}")
    print(f"👤 Child: {child_info['name']} ({child_info['age']})")

    async with httpx.AsyncClient(timeout=120.0) as client:
        # --- START STORY ---
        try:
            payload = {
                "config": {
                    "child_name": child_info["name"],
                    "child_age": child_info["age"],
                    "personalization": personalization,
                    "reference_image_b64": ref_b64  # Sending the image!
                },
                "story_idea": STORY_IDEA
            }
            
            resp = await client.post("http://localhost:8000/story/start", json=payload)
            resp.raise_for_status()
        except httpx.ConnectError:
            print("❌ Error: Could not connect. Is 'uvicorn backend.main:app' running?")
            return

        session_id = resp.json()["session_id"]
        print(f"✅ Session ID: {session_id}")

        # --- LOOP ---
        step = 0
        while True:
            step += 1
            print(f"\n⏳ Waiting for Step {step}...")
            
            # --- POLLING ---
            while True:
                status_resp = await client.get(f"http://localhost:8000/story/status/{session_id}")
                status = status_resp.json()["status"]
                if status == "complete": break
                if status == "failed": print("❌ Failed."); return
                await asyncio.sleep(2)

            # --- RESULT ---
            res = await client.get(f"http://localhost:8000/story/result/{session_id}")
            scene = res.json()
            
            # Check for fallback error
            if "taking a moment to load" in scene.get('story_text', ''):
                print("\n❌ BACKEND CRASHED (Fallback returned). Check Uvicorn logs.")
                return

            print(f"\n📖 [SCENE {scene['step_number']}]")
            print(scene['story_text'])
            
            # Save output
            output_dir = Path("demo_output")
            output_dir.mkdir(exist_ok=True)
            
            if scene.get("illustration_b64"):
                with open(output_dir / f"scene_{step}.png", "wb") as f:
                    f.write(base64.b64decode(scene["illustration_b64"]))
                print(f"🖼️ Saved Image")
            
            if scene.get("narration_audio_b64"):
                 with open(output_dir / f"scene_{step}.mp3", "wb") as f:
                    f.write(base64.b64decode(scene["narration_audio_b64"]))
                 print(f"🔊 Saved Audio")

            # END CHECK
            if scene["is_ending"] or not scene["choices"]:
                print("\n🌙 The End!")
                break

            # --- AUTOMATED CHOICE ---
            options = scene["choices"]
            if not options: break
            
            choice = random.choice(options)
            print(f"\n🤖 Auto-Choosing: '{choice['text']}'")
            
            await client.post("http://localhost:8000/story/choose", json={
                "session_id": session_id,
                "choice_text": choice["text"],
                "choice_id": choice["id"]
            })

if __name__ == "__main__":
    asyncio.run(run_demo())