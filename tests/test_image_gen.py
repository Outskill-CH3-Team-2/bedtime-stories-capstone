import asyncio
import os
import base64
import yaml
import io
import traceback
from PIL import Image
from openai import OpenAI
from dotenv import load_dotenv

# --- Helper Functions ---

def load_characters():
    """Loads character data from characters.yaml."""
    # Assuming the script runs from the /tests folder
    yaml_path = os.path.join(".", "characters.yaml")
    with open(yaml_path, "r") as f:
        return yaml.safe_load(f)["characters"]

def image_to_base64_url(image_path):
    """Encodes a local image to a base64 Data URL."""
    with open(image_path, "rb") as image_file:
        base64_data = base64.b64encode(image_file.read()).decode('utf-8')
        return f"data:image/png;base64,{base64_data}"

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
        model="google/gemini-2.5-flash-image", 
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

# --- Test Case 1: Simple Text to Image ---

async def test_01_simple_t2i(client, character):
    print(f"🧪 Test 1: Simple T2I for {character['name']}...")
    
    prompt = f"""
    A full-body studio portrait of {character['name']}.
    The character is standing in a neutral pose, facing forward.
    The entire character is visible from head to toe.
    Isolated on a solid, plain white background with professional studio lighting.
    Storybook illustration style, clean lines, high detail, no background elements.
    """
    
    img_bytes = await generate_image(client, prompt)
    output_path = "test_output_1_simple.png"
    
    with open(output_path, "wb") as f:
        f.write(img_bytes)
    
    # Validation: Check if file exists and has content
    assert os.path.exists(output_path), "File was not created."
    assert os.path.getsize(output_path) > 1000, "Image file is too small."
    print(f"✅ Test 1 Passed: Image saved to {output_path}")
    return output_path

# --- Test Case 2: Text + 1 Reference Image ---

async def test_02_single_ref(client, character, ref_path):
    print(f"🧪 Test 2: Text + 1 Reference (Consistency test)...")
    prompt = f"Using the character from the provided image, show {character['name']} in a new scene: eating a carrot in a garden."
    
    img_bytes = await generate_image(client, prompt, [ref_path])
    output_path = "test_output_2_ref.png"
    
    with open(output_path, "wb") as f:
        f.write(img_bytes)
    
    assert os.path.exists(output_path), "File was not created."
    print(f"✅ Test 2 Passed: Consistent image saved to {output_path}")
    return output_path

# --- Test Case 3: Text + 3 Reference Images ---

async def test_03_triple_ref(client, child_ref, generated_ref, characters):
    print(f"🧪 Test 3: Text + 3 References (Group scene)...")
    
    ref_list = [child_ref, generated_ref[0], generated_ref[1]]
    prompt = f"""
        A group shot featuring children from the reference photo and two characters 
        {characters[0]['name']} playing on {characters[0]['instrument']} and
        {characters[1]['name']} playing on {characters[1]['instrument']}
        playing music together on a medow.
        """
    
    img_bytes = await generate_image(client, prompt, ref_list)
    output_path = "test_output_3_triple.png"
    
    with open(output_path, "wb") as f:
        f.write(img_bytes)
    
    assert os.path.exists(output_path), "File was not created."
    print(f"✅ Test 3 Passed: Group scene saved to {output_path}")

# --- Main Entry Point ---

async def main():
    load_dotenv()
    api_key = os.getenv("OPENROUTER_API_KEY")
    client = OpenAI(base_url="https://openrouter.ai/api/v1", api_key=api_key)
    
    # Load first character as test subject
    chars = load_characters()
    test_char = chars[0] # Barnaby the Rabbit

    try:
        # Step 1: Generate initial character image
        path_1 = await test_01_simple_t2i(client, test_char)
        
        # Step 2: Use that image as reference for a new scene
        path_2 = await test_02_single_ref(client, test_char, "child_photo_01.png")
        
        # Step 3: Combine children references with character reference
        await test_03_triple_ref(client, "child_photo_01.png", ["test_image_01.png", "test_image_02.png"], chars )
        
        print("\n🎉 ALL IMAGE TESTS COMPLETED SUCCESSFULLY!")
        
    except Exception as e:
        print(f"\n❌ TEST SUITE FAILED: {e}")
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(main())