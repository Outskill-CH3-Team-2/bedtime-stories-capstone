"""
backend/pipelines/image.py — Real Image Generation using Gemini via OpenRouter.
"""
from __future__ import annotations
import base64
import yaml
from pathlib import Path
from typing import Optional
from backend.pipelines.provider import get_client

_CONFIG_DIR = Path(__file__).parent.parent / "config"

def _get_models() -> dict:
    with open(_CONFIG_DIR / "models.yaml") as f:
        return yaml.safe_load(f)

async def generate_image(prompt: str, reference_image_b64: Optional[str] = None) -> bytes:
    """
    Generates an image using Gemini 2.5 Flash.
    Strictly follows the multimodal payload format from test_image_gen.py.
    """
    models = _get_models()
    model_name = models["image"]["model"]
    client = get_client()

    # 1. Start with the text prompt
    content = [{"type": "text", "text": prompt}]

    # 2. Append Reference Image if provided
    # Note: test_image_gen.py uses a list, here we support a single reference for now
    if reference_image_b64:
        # Ensure it has the correct Data URL header
        if not reference_image_b64.startswith("data:image"):
            image_url = f"data:image/png;base64,{reference_image_b64}"
        else:
            image_url = reference_image_b64
            
        content.append({
            "type": "image_url", 
            "image_url": {"url": image_url}
        })

    try:
        # 3. Call OpenRouter/Gemini
        response = await client.chat.completions.create(
            model=model_name,
            messages=[{"role": "user", "content": content}],
            modalities=["image"] # Vital for triggering image output
        )

        # 4. Extract Image from Response (Robust handling)
        resp_dict = response.model_dump()
        
        # Iterate through choices to find the image
        for choice in resp_dict.get("choices", []):
            message = choice.get("message", {})
            
            # Check for 'images' list (OpenRouter standard for some models)
            images = message.get("images", [])
            
            # Fallback: Check content string for markdown image links
            content_str = message.get("content", "")
            
            target_url = None
            
            if images:
                target_url = images[0].get("url") or images[0].get("image_url", {}).get("url")
            elif "http" in content_str and (".png" in content_str or ".jpg" in content_str or "generated" in content_str):
                # Simple extraction if URL is embedded in text
                import re
                url_match = re.search(r'(https?://[^\s)]+)', content_str)
                if url_match:
                    target_url = url_match.group(1)

            # 5. Decode or Download
            if target_url:
                if "base64," in target_url:
                    return base64.b64decode(target_url.split("base64,")[1])
                else:
                    # It's a remote URL, download it
                    import httpx
                    async with httpx.AsyncClient() as http:
                        r = await http.get(target_url)
                        return r.content

        print("[Image Gen] No valid image found in response.")
        return b""

    except Exception as e:
        print(f"[Image Gen] Error: {e}")
        return b""