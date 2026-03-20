import os
import sys
import uvicorn
from pathlib import Path
from dotenv import load_dotenv

# 1. Dynamically add the project root to Python's module path
# This makes 'from backend.xxx import yyy' work from anywhere.
_ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_ROOT_DIR))

if __name__ == "__main__":
    # Load the .env file from the root directory
    load_dotenv(dotenv_path=_ROOT_DIR / ".env")
    
    # Read the port from the .env file, fallback to 8000 if missing
    port = int(os.getenv("BACKEND_PORT", 8000))
    
    print(f"🚀 Starting Story Weaver Backend on port {port}...")
    
    # 2. Tell Uvicorn explicitly to load the app from the 'backend' package
    uvicorn.run("backend.main:app", host="0.0.0.0", port=port, reload=True)