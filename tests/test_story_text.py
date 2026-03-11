# run: pytest tests/test_story_text.py
import pytest
import asyncio
import os
from backend.contracts import StoryState, ChildConfig, Personalization
from backend.orchestrator.pipeline import process_scene
from tests.story_judge import StoryJudge # Ensure you save the code above in this file

@pytest.mark.asyncio
async def test_story_generation_with_judge():
    """
    Directly runs the story pipeline (text-only) and uses an LLM Judge 
    to validate the quality and personalization of the output.
    """
    # Force media skip internally for this test process
    os.environ["VITE_TEST_AUDIO"] = "true"
    os.environ["VITE_TEST_IMAGE"] = "true"

    # 1. Setup Configuration
    config = ChildConfig(
        child_name="Leo",
        child_age=5,
        personalization=Personalization(
            favourite_colour="green",
            favourite_food="blueberries",
            favourite_activities=["building blocks"]
        )
    )
    
    initial_idea = "going to the dentist"
    state = StoryState(
        config=config,
        story_idea=initial_idea,
        messages=[{"role": "user", "content": f"The story idea is: {initial_idea}"}]
    )

    # 2. Generate Story (Looping through scenes)
    full_story_text = ""
    print(f"\n[1/2] Generating story text for: {initial_idea}...")
    
    for step in range(5): # Test a 5-step arc
        state.step_number = step
        scene = await process_scene(state)
        
        # Verify no backend crash occurred
        assert "taking a moment to load" not in scene.story_text, "Pipeline error detected!"
        
        full_story_text += " " + scene.story_text
        if scene.is_ending or not scene.choices:
            break
            
        # Select first choice and advance
        state.messages.append({"role": "user", "content": f"[Scene {step+1}] {scene.choices[0].text}"})

    # 3. Invoke the Judge
    print("[2/2] Invoking Story Judge for evaluation...")
    judge = StoryJudge()
    evaluation = await judge.evaluate_story(full_story_text, config, initial_idea)

    # 4. Print Report
    print("\n" + "="*50)
    print("STORY JUDGE REPORT")
    print("="*50)
    print(f"OVERALL SCORE: {evaluation['scores']['overall_average']}/100")
    print(f"Engagement:    {evaluation['scores']['engagement']}")
    print(f"Teaching:      {evaluation['scores']['teaching_value']}")
    print(f"Personalization: {evaluation['scores']['personalization']}")
    print("-" * 30)
    print(f"VERDICT: {evaluation['verdict']}")
    print("\nIMPROVEMENT IDEAS:")
    for idea in evaluation['report']['improvement_ideas']:
        print(f" - {idea}")
    print("="*50)

    # 5. Assertions based on Judge's Score
    assert evaluation['scores']['overall_average'] >= 70, "Story quality fell below acceptable threshold."
    assert evaluation['scores']['personalization'] >= 50, "Judge found poor use of child configuration."