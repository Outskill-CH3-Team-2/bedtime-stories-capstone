import { Scene, PrefiredJob, StoryConfig } from '../types';
import { storyCache, deleteDb } from './storyCache';

const API_BASE = 'http://localhost:8000';

// ── Dev overrides (from .env) ─────────────────────────────────────────────────
// VITE_DELETE_DB=true  → wipe IDB on startup (simulates first-run)
// VITE_TEST_IMAGE=xxx  → path under /public/ used for every illustration
// VITE_TEST_AUDIO=xxx  → path under /public/ used for every narration audio
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
  /**
   * Start a brand-new story (first chapter).
   * Returns { session_id, job_id }.
   */
  async startStory(idea: string, childInfo: any): Promise<{ sessionId: string; jobId: string }> {
    const cfg: Record<string, any> = childInfo.personalization ?? {};

    // Map camelCase StoryConfig fields → snake_case Personalization fields.
    // Favorites are now arrays; join them into readable strings for the backend prompt.
    const joinArr = (arr: string[] | string | undefined): string =>
      Array.isArray(arr) ? arr.join(', ') : (arr || '');

    // Resolve pet/friend from companions array (preferred) or legacy string fields
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
      // pet / friend resolved from companions carousel, with legacy fallback
      pet_name:    petCompanion?.name    || cfg.petName    || '',
      pet_type:    petCompanion?.relation !== 'Best Friend' ? (petCompanion?.relation || cfg.petType || '') : '',
      friend_name: friendCompanion?.name || cfg.friendName || '',
      // Full companions list (for future backend enrichment)
      companions: companions.filter((m: any) => m?.name).map(mapMember),
      // Family lists — strip members without names; strip photo field (sent separately)
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

    // Include child's reference photo if one was uploaded
    if (cfg.childPhoto) {
      body.protagonist_image_b64 = cfg.childPhoto;
    }

    const response = await fetch(`${API_BASE}/story/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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
    if (prevJobId) body.prev_job_id = prevJobId;
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

  /**
   * Generate a storybook avatar portrait for a named side character.
   * Returns a data-URI (data:image/png;base64,...).
   */
  async generateAvatar(name: string, relation: string, description?: string): Promise<string> {
    const response = await fetch(`${API_BASE}/story/avatar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    // L1: in-memory cache
    if (resultCache.has(jobId)) {
      console.log(`[getResult] ⚡ L1 hit for ${jobId}`);
      return resultCache.get(jobId)!;
    }

    // L2: IndexedDB cache
    const idbScene = await storyCache.loadScene(jobId);
    if (idbScene) {
      resultCache.set(jobId, idbScene); // warm L1 from L2
      return idbScene;
    }

    console.log(`[getResult] fetching job=${jobId}`);
    const response = await fetch(`${API_BASE}/story/result/${jobId}`);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to get result: ${response.status} ${text}`);
    }
    let scene: Scene = await response.json();

    // ── Dev overrides ──────────────────────────────────────────────────────
    if (_TEST_IMAGE.length > 0 || _TEST_AUDIO.length > 0) {
      const [imgB64, audB64] = await Promise.all([
        _TEST_IMAGE.length > 0 ? _publicFileToB64(_TEST_IMAGE).catch(() => scene.illustration_b64) : Promise.resolve(scene.illustration_b64),
        _TEST_AUDIO.length > 0 ? _publicFileToB64(_TEST_AUDIO).catch(() => scene.narration_audio_b64) : Promise.resolve(scene.narration_audio_b64),
      ]);
      scene = { ...scene, illustration_b64: imgB64, narration_audio_b64: audB64 };
      console.log(`[getResult] DEV: applied test overrides  image=${!!_TEST_IMAGE}  audio=${!!_TEST_AUDIO}`);
    }
    // ──────────────────────────────────────────────────────────────────────

      // Write-through to L1 always; only write L2 if media is present
      // (avoids caching skeleton scenes produced while test-skip flags were active)
      resultCache.set(jobId, scene);
      if (scene.illustration_b64 && scene.narration_audio_b64) {
        storyCache.saveScene(jobId, scene).catch(() => { });
      } else {
        console.log(`[getResult] Skipping IDB write for job=${jobId} — media incomplete (illustration=${!!scene.illustration_b64} audio=${!!scene.narration_audio_b64})`);
      }

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
    if (resultCache.has(jobId)) return; // Already in L1

    try {
      const statusRes = await fetch(`${API_BASE}/story/status/${jobId}`);
      if (!statusRes.ok) return;
      const statusData = await statusRes.json();

      if (statusData.status === 'complete') {
        // It's ready! Download payload silently (getResult handles L1+L2 write-through).
        console.log(`[checkAndCache] Job ${jobId} is ready. Downloading...`);
        await this.getResult(jobId);
      }
    } catch (e) {
      // Silent fail for background tasks
    }
  },
  // ──────────────────────────────────────────────────────────────────────────

  // ── IDB-backed session / prefired helpers ─────────────────────────────────

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

    /** Clear all IDB stores (called when user starts a fresh story). */
    clearCache(): Promise<void> {
      return storyCache.clearAll();
    },

    /** Remove stale entries from IDB (called at app startup). */
    clearOldEntries(): Promise<void> {
      return storyCache.clearOldEntries();
    },

    saveConfig(config: StoryConfig): Promise<void> {
        return storyCache.saveConfig(config);
    },

    loadConfig(): Promise<StoryConfig | null> {
        return storyCache.loadConfig();
    },
    // ── Housekeeping ───────────────────────────────────────────────────────────

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