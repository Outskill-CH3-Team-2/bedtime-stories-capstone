# tests/story_judge.py
import json
import asyncio
from backend.pipelines.provider import get_client
from backend.contracts import ChildConfig

class StoryJudge:
    def __init__(self):
        self.client = get_client()
        self.model = "gpt-4o" # Use a high-reasoning model for judging

    async def evaluate_story(self, full_text: str, config: ChildConfig, initial_idea: str):
        """
        Evaluates the story based on engagement, teaching value, and personalization.
        """
        # Format personalization for the judge
        p = config.personalization
        details = f"Name: {config.child_name}, Age: {config.child_age}, Food: {p.favourite_food}, " \
                  f"Color: {p.favourite_colour}, Animal: {p.favourite_animal}, " \
                  f"Activities: {', '.join(p.favourite_activities)}"

        judge_prompt = f"""
        You are an expert children's book editor and child psychologist. 
        Evaluate the following bedtime story written for a {config.child_age}-year-old.

        STORY TEXT:
        ---
        {full_text}
        ---

        INITIAL IDEA: {initial_idea}
        CHILD CONFIG: {details}

        CRITERIA (Score 0-100 for each):
        1. Engagement: Is the story captivating or boring for a {config.child_age}-year-old?
        2. Teaching Value: Does it contain a useful moral or gentle teaching moment?
        3. Personalization: Does it weave in the child's preferences naturally? 
           (Score lower if it 'overdoes' it by listing them like a robot, or if it misses them).

        RETURN ONLY A JSON OBJECT:
        {{
            "scores": {{
                "engagement": int,
                "teaching_value": int,
                "personalization": int,
                "overall_average": int
            }},
            "report": {{
                "strengths": ["string"],
                "weaknesses": ["string"],
                "improvement_ideas": ["string"]
            }},
            "verdict": "string (brief summary)"
        }}
        """

        response = await self.client.chat.completions.create(
            model=self.model,
            messages=[{"role": "system", "content": judge_prompt}],
            response_format={ "type": "json_object" }
        )
        
        return json.loads(response.choices[0].message.content)