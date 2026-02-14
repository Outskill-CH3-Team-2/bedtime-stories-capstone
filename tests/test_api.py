import requests
import time

BASE_URL = "http://127.0.0.1:8000"

def run_test():
    print("🔔 Testing Story Weaver Mock Backend...")
    
    # 1. Trigger the job
    print("Step 1: POST /generate/start")
    res = requests.post(f"{BASE_URL}/generate/start", json={"history": []})
    job_id = res.json().get("job_id")
    print(f"Created Job ID: {job_id}")

    # 2. Poll for the status
    status = "processing"
    while status == "processing":
        print("Step 2: Polling status...")
        time.sleep(1)
        status_res = requests.get(f"{BASE_URL}/generate/status/{job_id}")
        status = status_res.json().get("status")

    # 3. Fetch final result
    if status == "completed":
        print("Step 3: GET /generate/result")
        result_res = requests.get(f"{BASE_URL}/generate/result/{job_id}")
        story = result_res.json()
        print("\n✨ STORY GENERATED SUCCESSFULLY:")
        print(f"TEXT: {story['story_text'][:100]}...")
        print(f"CHOICES: {[c['text'] for c in story['choices']]}")
    else:
        print(f"❌ Test Failed. Final Status: {status}")

if __name__ == "__main__":
    try:
        run_test()
    except Exception as e:
        print(f"Error: {e}. Is the FastAPI server running at {BASE_URL}?")
