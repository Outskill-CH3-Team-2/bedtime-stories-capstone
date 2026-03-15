/**
 * storyCache.ts
 * ─────────────────────────────────────────────────────────────
 * IndexedDB wrapper for Dream Weaver.
 *
 * Object stores
 *   scenes   — keyed by jobId, stores {scene, savedAt}
 *   sessions — keyed by sessionId, stores active session pointer
 *   prefired — keyed by sessionId, stores PrefiredJob[]
 *   config   — single record keyed 'story_config'
 *
 * Entries automatically expire after MAX_AGE_MS (24 h).
 *
 * Dev: set VITE_DELETE_DB=true in .env to wipe all stores on startup
 * (simulates a clean first-run without touching config permanently).
 */

import { Scene, PrefiredJob, StoryConfig } from '../types';

const DB_NAME = 'dreamweaver-cache';
const DB_VERSION = 2; // Incremented version to add config store
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

// ── Internal types ────────────────────────────────────────────────────────────

interface SceneRecord {
    jobId: string;
    scene: Scene;
    savedAt: number; // Date.now()
}

interface SessionRecord {
    sessionId: string;
    jobId: string;
    savedAt: number;
}

interface PrefiredRecord {
    sessionId: string;
    jobs: PrefiredJob[];
    savedAt: number;
}

interface ConfigRecord {
    id: 'story_config';
    config: StoryConfig;
    savedAt: number;
}

// ── DB singleton ──────────────────────────────────────────────────────────────

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;

            if (!db.objectStoreNames.contains('scenes')) {
                db.createObjectStore('scenes', { keyPath: 'jobId' });
            }
            if (!db.objectStoreNames.contains('sessions')) {
                db.createObjectStore('sessions', { keyPath: 'sessionId' });
            }
            if (!db.objectStoreNames.contains('prefired')) {
                db.createObjectStore('prefired', { keyPath: 'sessionId' });
            }
            if (!db.objectStoreNames.contains('config')) {
                db.createObjectStore('config', { keyPath: 'id' });
            }
        };

        request.onsuccess = (event) => {
            resolve((event.target as IDBOpenDBRequest).result);
        };

        request.onerror = (event) => {
            console.error('[storyCache] Failed to open IndexedDB:', (event.target as IDBOpenDBRequest).error);
            reject((event.target as IDBOpenDBRequest).error);
            // Reset so next call retries
            dbPromise = null;
        };
    });

    return dbPromise;
}

/**
 * Delete and re-create the entire database.
 * Called at startup when VITE_DELETE_DB=true.
 */
export async function deleteDb(): Promise<void> {
    // Close any open connection first
    if (dbPromise) {
        try {
            const db = await dbPromise;
            db.close();
        } catch { /* ignore */ }
        dbPromise = null;
    }
    await new Promise<void>((resolve, reject) => {
        const req = indexedDB.deleteDatabase(DB_NAME);
        req.onsuccess = () => {
            console.log('[storyCache] IDB deleted (VITE_DELETE_DB=true)');
            resolve();
        };
        req.onerror = () => reject(req.error);
        req.onblocked = () => {
            console.warn('[storyCache] IDB delete blocked — close other tabs and reload');
            resolve(); // proceed anyway
        };
    });
}

// ── Generic helpers ───────────────────────────────────────────────────────────

function idbGet<T>(store: string, key: string): Promise<T | undefined> {
    return openDB().then(
        (db) =>
            new Promise<T | undefined>((resolve, reject) => {
                const tx = db.transaction(store, 'readonly');
                const req = tx.objectStore(store).get(key);
                req.onsuccess = () => resolve(req.result as T | undefined);
                req.onerror = () => reject(req.error);
            }),
    );
}

function idbPut(store: string, value: unknown): Promise<void> {
    return openDB().then(
        (db) =>
            new Promise<void>((resolve, reject) => {
                const tx = db.transaction(store, 'readwrite');
                const req = tx.objectStore(store).put(value);
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            }),
    );
}

function idbGetAll<T>(store: string): Promise<T[]> {
    return openDB().then(
        (db) =>
            new Promise<T[]>((resolve, reject) => {
                const tx = db.transaction(store, 'readonly');
                const req = tx.objectStore(store).getAll();
                req.onsuccess = () => resolve(req.result as T[]);
                req.onerror = () => reject(req.error);
            }),
    );
}

function idbDelete(store: string, key: string): Promise<void> {
    return openDB().then(
        (db) =>
            new Promise<void>((resolve, reject) => {
                const tx = db.transaction(store, 'readwrite');
                const req = tx.objectStore(store).delete(key);
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            }),
    );
}

function idbClearStore(store: string): Promise<void> {
    return openDB().then(
        (db) =>
            new Promise<void>((resolve, reject) => {
                const tx = db.transaction(store, 'readwrite');
                const req = tx.objectStore(store).clear();
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            }),
    );
}

// ── Public API ────────────────────────────────────────────────────────────────

export const storyCache = {
    // ── Scenes ──────────────────────────────────────────────────────────────────

    async saveScene(jobId: string, scene: Scene): Promise<void> {
        try {
            const record: SceneRecord = { jobId, scene, savedAt: Date.now() };
            await idbPut('scenes', record);
            console.log(`[storyCache] 💾 Saved scene for jobId=${jobId} (step ${scene.step_number})`);
        } catch (e) {
            console.warn('[storyCache] saveScene failed:', e);
        }
    },

    async loadScene(jobId: string): Promise<Scene | null> {
        try {
            const record = await idbGet<SceneRecord>('scenes', jobId);
            if (!record) return null;
            if (Date.now() - record.savedAt > MAX_AGE_MS) {
                // Stale — delete and return null
                await idbDelete('scenes', jobId);
                return null;
            }
            console.log(`[storyCache] ⚡ IDB hit for jobId=${jobId}`);
            return record.scene;
        } catch (e) {
            console.warn('[storyCache] loadScene failed:', e);
            return null;
        }
    },

    // ── Sessions ─────────────────────────────────────────────────────────────────

    async saveSession(sessionId: string, jobId: string): Promise<void> {
        try {
            const record: SessionRecord = { sessionId, jobId, savedAt: Date.now() };
            await idbPut('sessions', record);
            console.log(`[storyCache] 💾 Saved session pointer: sessionId=${sessionId} jobId=${jobId}`);
        } catch (e) {
            console.warn('[storyCache] saveSession failed:', e);
        }
    },

    /**
     * Returns the most recently saved session, or null if none or if it's stale.
     * Because we only ever want ONE active session, we grab all and pick newest.
     */
    async loadSession(): Promise<{ sessionId: string; jobId: string } | null> {
        try {
            const all = await idbGetAll<SessionRecord>('sessions');
            if (!all.length) return null;

            // Sort newest first
            all.sort((a, b) => b.savedAt - a.savedAt);
            const newest = all[0];

            if (Date.now() - newest.savedAt > MAX_AGE_MS) {
                await idbClearStore('sessions');
                return null;
            }
            return { sessionId: newest.sessionId, jobId: newest.jobId };
        } catch (e) {
            console.warn('[storyCache] loadSession failed:', e);
            return null;
        }
    },

    // ── Prefired jobs ─────────────────────────────────────────────────────────────

    async savePrefired(sessionId: string, jobs: PrefiredJob[]): Promise<void> {
        try {
            const record: PrefiredRecord = { sessionId, jobs, savedAt: Date.now() };
            await idbPut('prefired', record);
            console.log(`[storyCache] 💾 Saved ${jobs.length} prefired jobs for sessionId=${sessionId}`);
        } catch (e) {
            console.warn('[storyCache] savePrefired failed:', e);
        }
    },

    async loadPrefired(sessionId: string): Promise<PrefiredJob[] | null> {
        try {
            const record = await idbGet<PrefiredRecord>('prefired', sessionId);
            if (!record) return null;
            if (Date.now() - record.savedAt > MAX_AGE_MS) {
                await idbDelete('prefired', sessionId);
                return null;
            }
            return record.jobs;
        } catch (e) {
            console.warn('[storyCache] loadPrefired failed:', e);
            return null;
        }
    },

    // ── Config ────────────────────────────────────────────────────────────────────

    async saveConfig(config: StoryConfig): Promise<void> {
        try {
            const record: ConfigRecord = { id: 'story_config', config, savedAt: Date.now() };
            await idbPut('config', record);
            console.log('[storyCache] 💾 Saved story configuration');
        } catch (e) {
            console.warn('[storyCache] saveConfig failed:', e);
        }
    },

    async loadConfig(): Promise<StoryConfig | null> {
        try {
            const record = await idbGet<ConfigRecord>('config', 'story_config');
            if (!record) return null;
            // Config usually doesn't expire like scenes do, but we could check if needed.
            return record.config;
        } catch (e) {
            console.warn('[storyCache] loadConfig failed:', e);
            return null;
        }
    },

    // ── Housekeeping ──────────────────────────────────────────────────────────────

    /**
     * Removes all entries older than MAX_AGE_MS from every store.
     * Called at app startup.
     */
    async clearOldEntries(): Promise<void> {
        try {
            const now = Date.now();

            const scenes = await idbGetAll<SceneRecord>('scenes');
            for (const r of scenes) {
                if (now - r.savedAt > MAX_AGE_MS) {
                    await idbDelete('scenes', r.jobId);
                    console.log(`[storyCache] 🗑 Pruned stale scene jobId=${r.jobId}`);
                }
            }

            const sessions = await idbGetAll<SessionRecord>('sessions');
            for (const r of sessions) {
                if (now - r.savedAt > MAX_AGE_MS) {
                    await idbDelete('sessions', r.sessionId);
                }
            }

            const prefired = await idbGetAll<PrefiredRecord>('prefired');
            for (const r of prefired) {
                if (now - r.savedAt > MAX_AGE_MS) {
                    await idbDelete('prefired', r.sessionId);
                }
            }
        } catch (e) {
            console.warn('[storyCache] clearOldEntries failed:', e);
        }
    },

    /**
     * Wipe all stores — call when user starts a brand-new story.
     */
    async clearAll(): Promise<void> {
        try {
            await Promise.all([
                idbClearStore('scenes'),
                idbClearStore('sessions'),
                idbClearStore('prefired'),
            ]);
            console.log('[storyCache] 🗑 Cleared all IDB stores (new story started)');
        } catch (e) {
            console.warn('[storyCache] clearAll failed:', e);
        }
    },
};
