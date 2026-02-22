
import { Scene, Choice } from '../types';

const API_BASE = 'http://localhost:8000';

export const storyService = {
  async startStory(idea: string, childInfo: any, protagonistImageB64?: string): Promise<string> {
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
        // Only included when the user uploads a photo — stays in server memory only
        ...(protagonistImageB64 ? { protagonist_image_b64: protagonistImageB64 } : {}),
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to start story: ${response.status} ${text}`);
    }
    const data = await response.json();
    return data.session_id;
  },

  async addCharacter(sessionId: string, character: {
    name: string;
    role?: 'protagonist' | 'side';
    image_b64: string;
    description?: string;
  }): Promise<void> {
    const response = await fetch(`${API_BASE}/story/character`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        character: {
          name: character.name,
          role: character.role ?? 'side',
          image_b64: character.image_b64,
          description: character.description ?? '',
        },
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to add character: ${response.status} ${text}`);
    }
  },

  async checkStatus(sessionId: string): Promise<string> {
    const response = await fetch(`${API_BASE}/story/status/${sessionId}`);
    if (!response.ok) throw new Error(`Status check failed: ${response.status}`);
    const data = await response.json();
    return data.status;
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

  /** Read a File/Blob and return a full data-URI (data:image/...;base64,...) */
  async fileToDataUri(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  },
};
