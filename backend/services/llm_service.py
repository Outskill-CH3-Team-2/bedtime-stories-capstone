import requests
import os
from dotenv import load_dotenv

load_dotenv()

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")

def call_openrouter(messages: list):
    """
    Prepares the service for future OpenRouter calls.
    Replace the mock logic in main.py with this call when ready.
    """
    if not OPENROUTER_API_KEY:
        return {"error": "API Key not found in .env"}

    response = requests.post(
        url="https://openrouter.ai/api/v1/chat/completions",
        headers={
            "Authorization": f"Bearer {OPENROUTER_API_KEY}",
            "HTTP-Referer": "http://localhost:8000", 
        },
        json={
            "model": "openai/gpt-3.5-turbo", 
            "messages": messages
        }
    )
    return response.json()
