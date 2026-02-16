"""
demo_story.py — Run a real story generation and save the output.

Usage:
    cd bedtime-stories-capstone-main
    python demo_story.py

Output saved to: demo_output/
  - story.txt         full story text + choices
  - scene_1.png       illustration for scene 1
  - scene_2.png       illustration for scene 2
  - scene_3.png       illustration for scene 3
  - scene_1_audio.mp3 narration audio (if available)
"""

import asyncio
import base64
import os
import sys
import time
from pathlib import Path

from dotenv import load_dotenv
load_dotenv()

sys.path.insert(0, os.path.dirname(__file__))

# ── Story configuration ───────────────────────────────────────────────────────

CHILD_NAME  = "Sofia"
CHILD_AGE   = 5
VOICE       = "nova"       # alloy | echo | fable | onyx | nova | shimmer
ANIMAL      = "unicorn"
COLOUR      = "purple"
FOOD        = "strawberries"
NUM_SCENES  = 3

OUTPUT_DIR  = Path("demo_output")

# ─────────────────────────────────────────────────────────────────────────────


def check_key():
    key = os.getenv("OPENROUTER_API_KEY", "").strip()
    if not key or key == "your_openrouter_api_key_here":
        print("ERROR: OPENROUTER_API_KEY not found in .env")
        sys.exit(1)
    print(f"OK  API key found ({key[:8]}...)")


def save_scene(scene, scene_num, story_log):
    """Save image, audio, and append text to story log."""
    OUTPUT_DIR.mkdir(exist_ok=True)

    # ── Story text ────────────────────────────────────────────────────────────
    story_log.append(f"\n{'='*50}")
    story_log.append(f"SCENE {scene_num}  (step {scene.step_number})")
    story_log.append(f"{'='*50}")
    story_log.append(f"\n{scene.story_text}\n")

    if scene.is_ending:
        story_log.append("[THE END]")
    else:
        story_log.append("CHOICES:")
        for i, choice in enumerate(scene.choices, 1):
            story_log.append(f"  {i}. {choice.text}")

    story_log.append(f"\n[Safety: {'PASSED' if scene.safety_passed else 'FLAGGED'} | Time: {scene.generation_time_ms}ms]")

    # ── Illustration ──────────────────────────────────────────────────────────
    if scene.illustration_b64:
        img_path = OUTPUT_DIR / f"scene_{scene_num}.png"
        img_bytes = base64.b64decode(scene.illustration_b64)
        img_path.write_bytes(img_bytes)
        print(f"  Saved image  → {img_path}  ({len(img_bytes):,} bytes)")
    else:
        print(f"  No image for scene {scene_num}")

    # ── Narration audio ───────────────────────────────────────────────────────
    if scene.narration_audio_b64:
        audio_path = OUTPUT_DIR / f"scene_{scene_num}_audio.mp3"
        audio_bytes = base64.b64decode(scene.narration_audio_b64)
        audio_path.write_bytes(audio_bytes)
        print(f"  Saved audio  → {audio_path}  ({len(audio_bytes):,} bytes)")
    else:
        print(f"  No audio for scene {scene_num}  (TTS model unavailable on this plan)")

    # ── Choice images ─────────────────────────────────────────────────────────
    for i, choice in enumerate(scene.choices, 1):
        if choice.image_b64:
            choice_img_path = OUTPUT_DIR / f"scene_{scene_num}_choice_{i}.png"
            choice_img_bytes = base64.b64decode(choice.image_b64)
            choice_img_path.write_bytes(choice_img_bytes)
            print(f"  Saved choice {i} image → {choice_img_path}")


def print_scene_summary(scene, scene_num):
    width = 60
    print()
    print("-" * width)
    print(f"  SCENE {scene_num}  (step {scene.step_number})")
    print("-" * width)
    print(f"\n  {scene.story_text}\n")
    if scene.is_ending:
        print("  [END OF STORY]")
    else:
        print("  CHOICES:")
        for i, choice in enumerate(scene.choices, 1):
            print(f"    {i}. {choice.text}")
    print(f"\n  Time: {scene.generation_time_ms}ms | "
          f"Safety: {'PASSED' if scene.safety_passed else 'FLAGGED'} | "
          f"Audio: {'OK' if scene.narration_audio_b64 else 'MISSING'} | "
          f"Image: {'OK' if scene.illustration_b64 else 'MISSING'}")


async def run_demo():
    check_key()

    from backend.contracts import ChildConfig, StoryState, Personalization
    from backend.orchestrator.pipeline import process_scene

    print()
    print("=" * 60)
    print("  STORY WEAVER - Real generation demo")
    print("=" * 60)
    print(f"  Child:   {CHILD_NAME}, age {CHILD_AGE}")
    print(f"  Animal:  {ANIMAL}  |  Colour: {COLOUR}  |  Food: {FOOD}")
    print(f"  Scenes:  {NUM_SCENES}")
    print(f"  Output:  ./{OUTPUT_DIR}/")
    print("=" * 60)

    config = ChildConfig(
        child_name=CHILD_NAME,
        child_age=CHILD_AGE,
        voice=VOICE,
        personalization=Personalization(
            favourite_animal=ANIMAL,
            favourite_colour=COLOUR,
            favourite_food=FOOD,
        )
    )

    state = StoryState(config=config)
    story_log = [
        f"STORY WEAVER - Generated Story",
        f"Child: {CHILD_NAME}, age {CHILD_AGE}",
        f"Animal: {ANIMAL} | Colour: {COLOUR} | Food: {FOOD}",
        f"Generated: {time.strftime('%Y-%m-%d %H:%M:%S')}",
    ]

    total_start = time.monotonic()

    for scene_num in range(1, NUM_SCENES + 1):
        print(f"\nGenerating scene {scene_num}/{NUM_SCENES}...")
        scene = await process_scene(state)

        print_scene_summary(scene, scene_num)
        save_scene(scene, scene_num, story_log)

        if scene.is_ending:
            break

        if scene.choices:
            chosen = scene.choices[0]
            print(f"\n  [Auto-selecting: '{chosen.text}']")
            state.messages.append({"role": "user", "content": chosen.text})
            state.step_number += 1
        else:
            break

    # Save full story text
    story_txt_path = OUTPUT_DIR / "story.txt"
    story_txt_path.write_text("\n".join(story_log), encoding="utf-8")

    total = time.monotonic() - total_start
    print()
    print("=" * 60)
    print(f"  Done in {total:.1f}s")
    print(f"  Output saved to: ./{OUTPUT_DIR}/")
    print()
    print("  Files generated:")
    for f in sorted(OUTPUT_DIR.iterdir()):
        size = f.stat().st_size
        print(f"    {f.name:<35} {size:>10,} bytes")
    print("=" * 60)

    # ── Audio diagnosis ───────────────────────────────────────────────────────
    audio_files = list(OUTPUT_DIR.glob("*_audio.mp3"))
    if not audio_files:
        print()
        print("NOTE: No audio files were generated.")
        print("      This is likely because the TTS model configured in")
        print("      backend/config/models.yaml is not available on your")
        print("      OpenRouter plan. Check openrouter.ai/models and update")
        print("      the 'tts' model entry, or set MOCK_PIPELINES=true to")
        print("      skip TTS during development.")


if __name__ == "__main__":
    asyncio.run(run_demo())
