import { Scene, PrefiredJob, StoryConfig } from '../types';
import { storyCache, deleteDb } from './storyCache';

// In production (same origin), use relative URLs. In dev, target localhost:8000.
const API_BASE = import.meta.env.DEV ? (import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000') : '';

// User-provided API key (set from config, kept in memory only)
let _userApiKey: string | null = null;

/** Set the user's OpenRouter API key for all subsequent requests. */
export function setUserApiKey(key: string | null): void {
  _userApiKey = key?.trim() || null;
}

/** Build headers, injecting the user API key if set. */
function _headers(extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json', ...extra };
  // FIX: Only inject the saved key if we didn't explicitly pass one in 'extra'
  if (_userApiKey && !h['X-OpenRouter-Key']) {
    h['X-OpenRouter-Key'] = _userApiKey;
  }
  return h;
}

// ── Dev overrides (from .env) ─────────────────────────────────────────────────
const _DELETE_DB   = import.meta.env.VITE_DELETE_DB  === 'true';
const _TEST_IMAGE  = (import.meta.env.VITE_TEST_IMAGE  || '').trim();
const _TEST_AUDIO  = (import.meta.env.VITE_TEST_AUDIO  || '').trim();

// Perform DB wipe immediately at module load time if requested
if (_DELETE_DB) {
  deleteDb().catch(() => {});
}

/** Fetch a public asset and return it as base64 (no data-URI prefix). */
async function _publicFileToB64(path: string): Promise<string> {
  const resp = await fetch(`/${path}`);
  if (!resp.ok) throw new Error(`Failed to fetch test file: ${path}`);
  const buf = await resp.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// ── In-memory cache for background results ────────────────────────────────────
const resultCache = new Map<string, Scene>();

export const storyService = {
  
  /** Validates the API key by pinging OpenRouter via the backend */
 async validateKey(key: string): Promise<boolean> {
    try {
      const response = await fetch(`${API_BASE}/story/validate-key`, {
        method: 'POST',
        // .trim() prevents HTTP header syntax errors if you copy-pasted a space
        headers: _headers({ 'X-OpenRouter-Key': key.trim() }), 
      });
      
      if (!response.ok) {
        console.error("[validateKey] Server rejected key:", response.status, await response.text());
      }
      return response.ok;
    } catch (e) {
      console.error("[validateKey] Network or CORS error:", e);
      return false;
    }
  },

  /**
   * Start a brand-new story (first chapter).
   * Returns { session_id, job_id }.
   */
  async startStory(idea: string, childInfo: any): Promise<{ sessionId: string; jobId: string }> {
    const cfg: Record<string, any> = childInfo.personalization ?? {};

    const joinArr = (arr: string[] | string | undefined): string =>
      Array.isArray(arr) ? arr.join(', ') : (arr || '');

    const companions: any[] = cfg.companions || [];
    const petCompanion    = companions.find((c: any) => c.relation?.toLowerCase() !== 'best friend' && companions.indexOf(c) === 0)
                          ?? companions[0];
    const friendCompanion = companions.find((c: any) => c.relation?.toLowerCase().includes('friend'))
                          ?? companions[1];

    const mapMember = ({ name, relation, age, favourites }: any) => ({
      name,
      relation,
      ...(age        ? { age }        : {}),
      ...(favourites ? { favourites } : {}),
    });

    const personalization: Record<string, any> = {
      favourite_colour:   joinArr(cfg.favoriteColors)     || joinArr(cfg.favoriteColor),
      favourite_food:     joinArr(cfg.favoriteFoods)      || joinArr(cfg.favoriteFood),
      favourite_activity: joinArr(cfg.favoriteActivities) || joinArr(cfg.favoriteActivity),
      pet_name:    petCompanion?.name    || cfg.petName    || '',
      pet_type:    petCompanion?.relation !== 'Best Friend' ? (petCompanion?.relation || cfg.petType || '') : '',
      friend_name: friendCompanion?.name || cfg.friendName || '',
      companions: companions.filter((m: any) => m?.name).map(mapMember),
      siblings:     (cfg.siblings     || []).filter((m: any) => m?.name).map(mapMember),
      parents:      (cfg.parents      || []).filter((m: any) => m?.name).map(mapMember),
      grandparents: (cfg.grandparents || []).filter((m: any) => m?.name).map(mapMember),
    };

    const body: Record<string, any> = {
      config: {
        child_name: childInfo.name,
        child_age: childInfo.age,
        personalization,
      },
      story_idea: idea,
    };

    if (cfg.childPhoto) {
      body.protagonist_image_b64 = cfg.childPhoto;
    }

    const response = await fetch(`${API_BASE}/story/generate`, {
      method: 'POST',
      headers: _headers(),
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to start story: ${response.status} ${text}`);
    }
    const data = await response.json();
    return { sessionId: data.session_id, jobId: data.job_id };
  },

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
    if (prevJobId) body.prev_job_id = prevJobId;
    if (prevChoiceText) body.prev_choice_text = prevChoiceText;

    const response = await fetch(`${API_BASE}/story/generate`, {
      method: 'POST',
      headers: _headers(),
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
      headers: _headers(),
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

  async generateAvatar(name: string, relation: string, description?: string): Promise<string> {
    const response = await fetch(`${API_BASE}/story/avatar`, {
      method: 'POST',
      headers: _headers(),
      body: JSON.stringify({ name, relation, description: description || '' }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Avatar generation failed: ${response.status} ${text}`);
    }
    const data = await response.json();
    return data.image_b64 as string;
  },

  async checkStatus(jobId: string): Promise<string> {
    const response = await fetch(`${API_BASE}/story/status/${jobId}`);
    if (!response.ok) throw new Error(`Status check failed: ${response.status}`);
    const data = await response.json();
    return data.status;
  },

  async getResult(jobId: string): Promise<Scene> {
    if (resultCache.has(jobId)) {
      return resultCache.get(jobId)!;
    }

    const idbScene = await storyCache.loadScene(jobId);
    if (idbScene) {
      resultCache.set(jobId, idbScene);
      return idbScene;
    }

    const response = await fetch(`${API_BASE}/story/result/${jobId}`);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to get result: ${response.status} ${text}`);
    }
    let scene: Scene = await response.json();

    if (_TEST_IMAGE.length > 0 || _TEST_AUDIO.length > 0) {
      const [imgB64, audB64] = await Promise.all([
        _TEST_IMAGE.length > 0 ? _publicFileToB64(_TEST_IMAGE).catch(() => scene.illustration_b64) : Promise.resolve(scene.illustration_b64),
        _TEST_AUDIO.length > 0 ? _publicFileToB64(_TEST_AUDIO).catch(() => scene.narration_audio_b64) : Promise.resolve(scene.narration_audio_b64),
      ]);
      scene = { ...scene, illustration_b64: imgB64, narration_audio_b64: audB64 };
    }

    resultCache.set(jobId, scene);
    if (scene.illustration_b64 && scene.narration_audio_b64) {
      storyCache.saveScene(jobId, scene).catch(() => { });
    }

    return scene;
  },

  isResultCached(jobId: string): boolean {
    return resultCache.has(jobId);
  },

  async getCompletedResult(jobId: string): Promise<Scene | null> {
    return resultCache.get(jobId) || null;
  },

  async checkAndCache(jobId: string): Promise<void> {
    if (resultCache.has(jobId)) return;
    try {
      const statusRes = await fetch(`${API_BASE}/story/status/${jobId}`);
      if (!statusRes.ok) return;
      const statusData = await statusRes.json();
      if (statusData.status === 'complete') {
        await this.getResult(jobId);
      }
    } catch (e) {
    }
  },

  saveSession(sessionId: string, jobId: string): Promise<void> {
    return storyCache.saveSession(sessionId, jobId);
  },

  loadSession(): Promise<{ sessionId: string; jobId: string } | null> {
    return storyCache.loadSession();
  },

  savePrefired(sessionId: string, jobs: PrefiredJob[]): Promise<void> {
    return storyCache.savePrefired(sessionId, jobs);
  },

  loadPrefired(sessionId: string): Promise<PrefiredJob[] | null> {
    return storyCache.loadPrefired(sessionId);
  },

  clearCache(): Promise<void> {
    return storyCache.clearAll();
  },

  clearOldEntries(): Promise<void> {
    return storyCache.clearOldEntries();
  },

  saveConfig(config: StoryConfig): Promise<void> {
      return storyCache.saveConfig(config);
  },

  loadConfig(): Promise<StoryConfig | null> {
      return storyCache.loadConfig();
  },

  async exportStoryPdf(childName: string, storyIdea: string, scenes: any[]): Promise<void> {
    const response = await fetch(`${API_BASE}/story/export`, {
      method: 'POST',
      headers: _headers(),
      body: JSON.stringify({ child_name: childName, story_idea: storyIdea, scenes }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Export failed: ${response.status} ${text}`);
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `story_${childName.toLowerCase().replace(/\s+/g, '_')}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  },

  async saveStoryMemory(childName: string, sessionId: string, summary: string): Promise<void> {
    await fetch(`${API_BASE}/story/memory`, {
      method: 'POST',
      headers: _headers(),
      body: JSON.stringify({ child_name: childName, session_id: sessionId, summary }),
    });
  },

  async uploadDocument(file: File, sourceType: string = 'upload'): Promise<any> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('source_type', sourceType);
    const response = await fetch(`${API_BASE}/story/upload?source_type=${sourceType}`, {
      method: 'POST',
      body: formData,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Upload failed: ${response.status} ${text}`);
    }
    return response.json();
  },

  async getLibrary(): Promise<any> {
    const response = await fetch(`${API_BASE}/story/library`);
    if (!response.ok) throw new Error('Failed to fetch library');
    return response.json();
  },

};