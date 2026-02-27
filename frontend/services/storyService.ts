import { Scene, PrefiredJob } from '../types';

const API_BASE = 'http://localhost:8000';

// ── NEW: In-memory cache for background results ─────────────────────────────
const resultCache = new Map<string, Scene>();
// ────────────────────────────────────────────────────────────────────────────

export const storyService = {
  /**
   * Start a brand-new story (first chapter).
   * Returns { session_id, job_id }.
   */
  async startStory(idea: string, childInfo: any): Promise<{ sessionId: string; jobId: string }> {
    const response = await fetch(`${API_BASE}/story/generate`, {
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
    return { sessionId: data.session_id, jobId: data.job_id };
  },

  /**
   * Pre-fire next-chapter generation for one choice branch.
   */
  async pregenerateNextChapter(
    sessionId: string,
    choiceText: string,
    prevJobId?: string,
    prevChoiceText?: string,
  ): Promise<PrefiredJob> {
    const body: Record<string, unknown> = {
      session_id: sessionId,
      choice_text: choiceText,
    };
    if (prevJobId)     body.prev_job_id     = prevJobId;
    if (prevChoiceText) body.prev_choice_text = prevChoiceText;

    const response = await fetch(`${API_BASE}/story/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to pre-generate: ${response.status} ${text}`);
    }
    const data = await response.json();
    return { choiceText, jobId: data.job_id };
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

  async checkStatus(jobId: string): Promise<string> {
    const response = await fetch(`${API_BASE}/story/status/${jobId}`);
    if (!response.ok) throw new Error(`Status check failed: ${response.status}`);
    const data = await response.json();
    return data.status;
  },

  async getResult(jobId: string): Promise<Scene> {
      // If we have it cached, return it immediately!
      if (resultCache.has(jobId)) {
        console.log(`[getResult] ⚡ Returning cached result for ${jobId}`);
        return resultCache.get(jobId)!;
      }

      console.log(`[getResult] fetching job=${jobId}`);
      const response = await fetch(`${API_BASE}/story/result/${jobId}`);
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Failed to get result: ${response.status} ${text}`);
      }
      const scene: Scene = await response.json();
      
      // Cache it for future reference (e.g. going back)
      resultCache.set(jobId, scene);

      const audioB64 = scene.narration_audio_b64 ?? '';
      const audioBytes = audioB64
        ? Math.floor((audioB64.length * 3) / 4) - (audioB64.endsWith('==') ? 2 : audioB64.endsWith('=') ? 1 : 0)
        : 0;
      console.log(
        `[getResult] job=${jobId}  step=${scene.step_number}  ` +
        `audio=${audioBytes > 0 ? `${audioBytes.toLocaleString()} bytes` : 'EMPTY'}  ` +
        `image=${scene.illustration_b64 ? 'present' : 'EMPTY'}  ` +
        `choices=${scene.choices.length}`
      );
      return scene;
  },

  // ── NEW: Helper methods for Preloading ────────────────────────────────────
  
  isResultCached(jobId: string): boolean {
    return resultCache.has(jobId);
  },

  async getCompletedResult(jobId: string): Promise<Scene | null> {
    return resultCache.get(jobId) || null;
  },

  /**
   * Background task: Checks if a job is done. If yes, downloads and caches the result.
   * This is called by App.tsx in a background loop.
   */
  async checkAndCache(jobId: string): Promise<void> {
    if (resultCache.has(jobId)) return; // Already got it

    try {
      const statusRes = await fetch(`${API_BASE}/story/status/${jobId}`);
      if (!statusRes.ok) return;
      const statusData = await statusRes.json();

      if (statusData.status === 'complete') {
         // It's ready! Download payload silently.
         console.log(`[checkAndCache] Job ${jobId} is ready. Downloading...`);
         await this.getResult(jobId); // getResult auto-caches
      }
    } catch (e) {
      // Silent fail for background tasks
    }
  },
  // ──────────────────────────────────────────────────────────────────────────

  async debugStt(jobId: string, audiob64: string, storyText: string): Promise<void> {
    try {
      const resp = await fetch(`${API_BASE}/story/debug/stt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: jobId, audio_b64: audiob64, story_text: storyText }),
      });
      if (!resp.ok) {
        console.warn(`[debugStt] STT endpoint returned ${resp.status}`);
        return;
      }
      const data = await resp.json();
        if (data.skipped) {
          console.log(`[debugStt] job=${jobId}  ⏭ SKIPPED — ${data.reason}`);
          return;
        }
        const match = data.match ? '✅ MATCH' : '❌ MISMATCH';
        console.group(`[debugStt] job=${jobId}  ${match}  overlap=${data.word_overlap_pct}%`);
        console.log('STORY_TEXT :', data.story_text_preview);
        console.log('TRANSCRIPT :', data.transcript);
        console.groupEnd();
    } catch (e) {
      console.warn('[debugStt] failed:', e);
    }
  },
};