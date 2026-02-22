
import { Scene, Choice } from '../types';

const API_BASE = 'http://localhost:8000';

export const storyService = {
  async startStory(idea: string, childInfo: any): Promise<string> {
    const response = await fetch(`${API_BASE}/story/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        config: {
          child_name: childInfo.name,
          child_age: childInfo.age,
          personalization: childInfo.personalization ?? {},
        },
        story_idea: idea,
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to start story: ${response.status} ${text}`);
    }
    const data = await response.json();
    return data.session_id;
  },

  async checkStatus(sessionId: string): Promise<string> {
    const response = await fetch(`${API_BASE}/story/status/${sessionId}`);
    if (!response.ok) throw new Error(`Status check failed: ${response.status}`);
    const data = await response.json();
    return data.status; // "pending" | "generating_text" | "safety_check" | "generating_media" | "complete" | "failed"
  },

  async getResult(sessionId: string): Promise<Scene> {
    const response = await fetch(`${API_BASE}/story/result/${sessionId}`);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to get result: ${response.status} ${text}`);
    }
    const data = await response.json();
    return { ...data, session_id: sessionId };
  },

  async submitChoice(sessionId: string, choice: Choice): Promise<void> {
    const response = await fetch(`${API_BASE}/story/choose`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        choice_text: choice.text,
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to submit choice: ${response.status} ${text}`);
    }
  },
};
