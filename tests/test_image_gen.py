import pytest
import os
import yaml
import base64
from PIL import Image

# to run the test: pytest tests/test_image_gen.py
# Helper functions kept local or moved to a shared utils if preferred
def image_to_base64_url(image_path):
    with open(image_path, "rb") as f:
        data = base64.b64encode(f.read()).decode('utf-8')
        return f"data:image/png;base64,{data}"

async def generate_image(client, prompt, ref_image_paths=None):
    """
    Generic function for Text-to-Image (T2I) and Multi-Reference Image-to-Image.
    Accepts a single prompt and a list of image paths.
    """
    if ref_image_paths is None:
        ref_image_paths = []

    # Build the multimodal content list
    # Content starts with the text instructions
    content = [{"type": "text", "text": prompt}]
    
    # Append each reference image as a base64 URL
    for path in ref_image_paths:
        if os.path.exists(path):
            ref_url = image_to_base64_url(path)
            content.append({"type": "image_url", "image_url": {"url": ref_url}})
        else:
            print(f"⚠️ Warning: Reference image not found at {path}")

    # Call the model via OpenRouter
    response = client.chat.completions.create(
        model="google/gemini-3.1-flash-image-preview", 
        messages=[
            {
                "role": "user",
                "content": content
            }
        ],
        modalities=["image"] # Vital for triggering image output
    )

    # Extract image bytes from the response
    resp_dict = response.model_dump()
    for choice in resp_dict.get("choices", []):
        images = choice.get("message", {}).get("images", [])
        if images:
            img_url = images[0].get("url") or images[0].get("image_url", {}).get("url")
            # Extract the base64 part and decode
            return base64.b64decode(img_url.split("base64,")[1])
            
    raise Exception("Generation failed to return an image content.")

class TestImageGeneration:
    
    @pytest.fixture
    def characters(self, test_dir):
        with open(os.path.join(test_dir, "characters.yaml"), "r") as f:
            return yaml.safe_load(f)["characters"]

    @pytest.mark.asyncio
    async def test_01_simple_t2i(self, client, characters, test_dir):
        print(f"\n🚀 Running Test 01: Simple T2I for {characters[0]['name']}...")
        char = characters[0]
        prompt = f"""Studio portrait of {char['name']}, a picture that looks like a child drawings, white background, 
        do not generate text on the picture"""
        
        img_bytes = await generate_image(client, prompt)
        out = os.path.join(test_dir, "test_output_1.png")
        with open(out, "wb") as f: f.write(img_bytes)
        print(f"💾 Saved: {out}")

    @pytest.mark.asyncio
    async def test_02_single_ref(self, client, characters, test_dir):
        print(f"\n🚀 Running Test 02: Character + Child Reference...")
        refs = [
            os.path.join(test_dir, "child_photo_01.png"),
            os.path.join(test_dir, "test_image_01.png")
        ]
        char = characters[0]
        prompt = f"""The child from the reference photo singing with {char['name']} who makes music on {char['instrument']}, 
        a picture that looks like a child drawings, do not generate text on the picture"""
        
        img_bytes = await generate_image(client, prompt, refs)
        out = os.path.join(test_dir, "test_output_2.png")
        with open(out, "wb") as f: f.write(img_bytes)
        print(f"💾 Saved: {out}")

    @pytest.mark.asyncio
    async def test_03_triple_ref(self, client, characters, test_dir):
        print(f"\n🚀 Running Test 03: Triple Reference Group Scene...")
        # Fixed prompt to prevent "cloning" of the child
        refs = [
            os.path.join(test_dir, "child_photo_01.png"),
            os.path.join(test_dir, "test_image_01.png"), 
            os.path.join(test_dir, "test_image_02.png")  
        ]
        
        prompt = (
        f"""A group shot featuring the child from the reference photo and two characters 
        {characters[0]['name']} playing on {characters[0]['instrument']} and
        {characters[1]['name']} playing on {characters[1]['instrument']}
        playing music together on a medow. The picture that looks like a child drawings, 
        do not generate text on the picture."""
        )
        
        img_bytes = await generate_image(client, prompt, refs)
        out = os.path.join(test_dir, "test_output_3.png")
        with open(out, "wb") as f: f.write(img_bytes)
        print(f"💾 Saved: {out}")