
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
  photo?: string; // base64 data URI — optional reference picture
}

export interface StoryConfig {
  childName: string;
  age: number | string;
  // ── Favorites (multi-select arrays) ──────────────────────────────────────
  favoriteFoods: string[];
  favoriteColors: string[];
  favoriteActivities: string[];
  // ── Companions ───────────────────────────────────────────────────────────
  petName: string;
  petType: string;
  friendName: string;
  siblings: FamilyMember[];
  parents: FamilyMember[];
  grandparents: FamilyMember[];
  childPhoto: string;
  privacyAcknowledged: boolean;
}

export const DEFAULT_CONFIG: StoryConfig = {
  childName: '',
  age: '',
  favoriteFoods: [],
  favoriteColors: [],
  favoriteActivities: [],
  petName: '',
  petType: '',
  friendName: '',
  siblings: [],
  parents: [
    { name: '', relation: 'Mother' },
    { name: '', relation: 'Father' },
  ],
  grandparents: [
    { name: '', relation: 'Grandma' },
    { name: '', relation: 'Grandpa' },
    { name: '', relation: 'Grandma' },
    { name: '', relation: 'Grandpa' },
  ],
  childPhoto: '',
  privacyAcknowledged: false,
};
