"""
demo_story.py  —  End-to-end story demo using the /story/generate API.

Implements the parallel pre-generation model:
  - All choice branches are fired immediately when a scene arrives.
  - When the user picks a choice, the matching job is already running (or done).
  - No waiting after the first scene loads.

Usage:
    python demo_story.py              # interactive (prompts for choice each turn)
    python demo_story.py --auto       # automated (random choice, no prompts)
    python demo_story.py --auto --steps 2   # stop after N chapters

Requires:
    pip install httpx
    config.yaml  (see below for expected shape)
    uvicorn backend.main:app --reload  running on port 8000

config.yaml shape:
    child_info:
      name: Arlo
      age: 7
    personalization:
      favourite_colour: blue
"""
import asyncio
import base64
import os
import random
import sys
import argparse
from pathlib import Path

import httpx
import yaml

BASE = "http://localhost:8000"
POLL_INTERVAL = 2          # seconds between status polls
OUTPUT_DIR = Path("demo_output")


# ---------------------------------------------------------------------------
# Config helpers
# ---------------------------------------------------------------------------

def load_config(path: str = "config.yaml") -> dict:
    if not os.path.exists(path):
        print(f"ERROR: {path} not found.")
        sys.exit(1)
    with open(path) as f:
        return yaml.safe_load(f)


# ---------------------------------------------------------------------------
# API wrappers
# ---------------------------------------------------------------------------

async def api_generate(client: httpx.AsyncClient, payload: dict) -> dict:
    """POST /story/generate — returns {session_id, job_id}."""
    resp = await client.post(f"{BASE}/story/generate", json=payload)
    resp.raise_for_status()
    return resp.json()


async def api_poll_until_done(client: httpx.AsyncClient, job_id: str) -> None:
    """Poll /story/status/{job_id} until complete or failed."""
    while True:
        r = await client.get(f"{BASE}/story/status/{job_id}")
        r.raise_for_status()
        status = r.json()["status"]
        if status == "complete":
            return
        if status == "failed":
            raise RuntimeError(f"Job {job_id} failed.")
        await asyncio.sleep(POLL_INTERVAL)


async def api_result(client: httpx.AsyncClient, job_id: str) -> dict:
    """GET /story/result/{job_id}."""
    r = await client.get(f"{BASE}/story/result/{job_id}")
    r.raise_for_status()
    return r.json()


# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------

def save_scene(scene: dict, step: int) -> None:
    OUTPUT_DIR.mkdir(exist_ok=True)
    if scene.get("illustration_b64"):
        p = OUTPUT_DIR / f"scene_{step:02d}.png"
        p.write_bytes(base64.b64decode(scene["illustration_b64"]))
        print(f"  [image]  saved {p.name}")
    if scene.get("narration_audio_b64"):
        p = OUTPUT_DIR / f"scene_{step:02d}.mp3"
        p.write_bytes(base64.b64decode(scene["narration_audio_b64"]))
        print(f"  [audio]  saved {p.name}")


def print_scene(scene: dict) -> None:
    print(f"\n{'='*60}")
    print(f"  SCENE {scene['step_number']}")
    print(f"{'='*60}")
    print(scene.get("story_text", ""))
    choices = scene.get("choices", [])
    if choices:
        print("\nChoices:")
        for i, c in enumerate(choices, 1):
            print(f"  {i}. {c['text']}")


def pick_choice(choices: list, auto: bool) -> dict:
    if auto:
        choice = random.choice(choices)
        print(f"\n[auto] Chose: '{choice['text']}'")
        return choice
    while True:
        raw = input(f"\nYour choice (1–{len(choices)}): ").strip()
        if raw.isdigit() and 1 <= int(raw) <= len(choices):
            return choices[int(raw) - 1]
        print("  Invalid. Try again.")


# ---------------------------------------------------------------------------
# Main demo loop
# ---------------------------------------------------------------------------

async def run_demo(auto: bool, max_steps: int | None) -> None:
    cfg = load_config()
    child = cfg["child_info"]
    personalization = cfg.get("personalization", {})

    story_idea = "Tomorrow we are going to the dentist for the first time."

    print(f"Story:  {story_idea}")
    print(f"Child:  {child['name']}, age {child['age']}")
    print(f"Mode:   {'auto' if auto else 'interactive'}")
    print()

    async with httpx.AsyncClient(timeout=300.0) as client:

        # ── Step 0: start first chapter ───────────────────────────────────
        print("Firing first chapter...")
        try:
            gen = await api_generate(client, {
                "config": {
                    "child_name": child["name"],
                    "child_age": child["age"],
                    "personalization": personalization,
                },
                "story_idea": story_idea,
            })
        except httpx.ConnectError:
            print(f"ERROR: Could not connect to {BASE}. Is uvicorn running?")
            return

        session_id = gen["session_id"]
        current_job_id = gen["job_id"]
        print(f"  session_id  = {session_id}")
        print(f"  job_id      = {current_job_id}")

        # ── Main story loop ────────────────────────────────────────────────
        step = 0
        # Maps choice_text → job_id for pre-fired branches
        prefired: dict[str, str] = {}
        # The job_id + choice that the user selected last round (for history commit)
        prev_job_id: str | None = None
        prev_choice_text: str | None = None

        while True:
            step += 1
            if max_steps and step > max_steps:
                print(f"\n[demo] Reached max_steps={max_steps}. Stopping.")
                break

            # ── Wait for the current chapter job ──────────────────────────
            print(f"\nWaiting for chapter {step} (job {current_job_id[:8]}…)…")
            await api_poll_until_done(client, current_job_id)
            scene = await api_result(client, current_job_id)

            print_scene(scene)
            save_scene(scene, step)

            if scene["is_ending"] or not scene.get("choices"):
                print("\nThe End.")
                break

            choices = scene["choices"]

            # ── Pre-fire ALL choice branches immediately ───────────────────
            # Build the base payload for pre-generation.  On the very first
            # next-chapter round we pass prev_job_id so the backend commits
            # the just-selected history before snapshotting new jobs.
            print(f"\nPre-firing {len(choices)} branch(es) in parallel…")
            prefired = {}
            for i, choice in enumerate(choices):
                payload: dict = {
                    "session_id": session_id,
                    "choice_text": choice["text"],
                }
                # Only the FIRST pre-fire call of a round needs to carry the
                # previous selection — the backend uses it to advance history
                # once before any snapshots are taken.
                if i == 0 and prev_job_id:
                    payload["prev_job_id"] = prev_job_id
                    payload["prev_choice_text"] = prev_choice_text

                resp = await api_generate(client, payload)
                prefired[choice["text"]] = resp["job_id"]
                print(f"  '{choice['text'][:50]}' → job {resp['job_id'][:8]}…")

            # ── User picks a choice ────────────────────────────────────────
            chosen = pick_choice(choices, auto)
            chosen_text = chosen["text"]
            chosen_job_id = prefired[chosen_text]

            print(f"\nSelected: '{chosen_text}'")
            print(f"Using pre-fired job {chosen_job_id[:8]}…")

            # Carry forward for next round's commit
            prev_job_id = chosen_job_id
            prev_choice_text = chosen_text
            current_job_id = chosen_job_id


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Bedtime story demo")
    parser.add_argument("--auto", action="store_true",
                        help="Automated mode — pick choices randomly")
    parser.add_argument("--steps", type=int, default=None, metavar="N",
                        help="Stop after N chapters (default: run to ending)")
    args = parser.parse_args()

    asyncio.run(run_demo(auto=args.auto, max_steps=args.steps))
