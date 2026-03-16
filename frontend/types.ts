
export interface Choice {
  id: string;
  text: string;
}

export interface Scene {
  step_number: number;
  story_text: string;
  illustration_b64: string;
  narration_audio_b64: string;
  choices: Choice[];
  is_ending: boolean;
  session_id: string;
}

/** Tracks one pre-generated branch: the choice that was sent and the resulting job. */
export interface PrefiredJob {
  choiceText: string;
  jobId: string;
}

export interface StoryState {
  sessionId: string | null;
  currentScene: Scene | null;
  status: 'idle' | 'starting' | 'polling' | 'scene_ready' | 'ready' | 'error';
  error: string | null;
}

export interface FamilyMember {
  name: string;
  relation: string;
  age?: string;
  photo?: string; // base64 data URI — optional reference picture
  favourites?: string; // short free-text, e.g. "loves pizza and dinosaurs"
}

export interface StoryConfig {
  childName: string;
  age: number | string;
  // ── Favorites (multi-select arrays) ──────────────────────────────────────
  favoriteFoods: string[];
  favoriteColors: string[];
  favoriteActivities: string[];
  // ── Companions (pets, friends — open-ended carousel) ─────────────────────
  companions: FamilyMember[];
  // ── Family ───────────────────────────────────────────────────────────────
  siblings: FamilyMember[];
  parents: FamilyMember[];
  grandparents: FamilyMember[];
  childPhoto: string;
  privacyAcknowledged: boolean;
  // Legacy fields kept for migration / backward-compat
  petName?: string;
  petType?: string;
  friendName?: string;
}

export const DEFAULT_CONFIG: StoryConfig = {
  childName: '',
  age: '',
  favoriteFoods: [],
  favoriteColors: [],
  favoriteActivities: [],
  companions: [
    { name: '', relation: 'Pet', age: '', favourites: '' },
    { name: '', relation: 'Best Friend', age: '', favourites: '' },
  ],
  siblings: [],
  parents: [
    { name: '', relation: 'Mother', age: '', favourites: '' },
    { name: '', relation: 'Father', age: '', favourites: '' },
  ],
  grandparents: [
    { name: '', relation: 'Grandma', age: '', favourites: '' },
    { name: '', relation: 'Grandpa', age: '', favourites: '' },
    { name: '', relation: 'Grandma', age: '', favourites: '' },
    { name: '', relation: 'Grandpa', age: '', favourites: '' },
  ],
  childPhoto: '',
  privacyAcknowledged: false,
};
