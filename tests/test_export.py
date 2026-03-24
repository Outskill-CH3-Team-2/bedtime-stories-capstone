import sys
import os
from pathlib import Path

# Ensure backend is in path
sys.path.append(str(Path(__file__).parent))

from backend.export_pdf import generate_story_pdf

def test_manual_export():
    child_name = "TestChild"
    story_idea = "A quick test adventure"
    
    # Create a list of dummy scenes to simulate a finished story
    TINY_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="

    mock_scenes = [
        {
            "story_text": "Once upon a time, there was a test.",
            "illustration_b64": TINY_PNG, # Add a small base64 string here if you want to test images
            "step_number": 0,
            "is_ending": False,
            "choice_made": "Go to the next page"
        },
        {
            "story_text": "And then the test was successful. The End!",
            "illustration_b64": TINY_PNG,
            "step_number": 8,
            "is_ending": True,
            "choice_made": ""
        }
    ]

    print("Generating PDF...")
    try:
        pdf_bytes = generate_story_pdf(child_name, story_idea, mock_scenes)
        with open("test_output.pdf", "wb") as f:
            f.write(pdf_bytes)
        print("Success! Created test_output.pdf")
    except Exception as e:
        print(f"Export Failed: {e}")

if __name__ == "__main__":
    test_manual_export()