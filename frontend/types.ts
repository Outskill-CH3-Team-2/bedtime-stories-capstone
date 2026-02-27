
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

export interface StoryConfig {
  childName: string;
  age: number | string;
  favoriteFood: string;
  favoriteColor: string;
  favoriteActivity: string;
  petName: string;
  petType: string;
  friendName: string;
  siblings: string;
  parents: string;
  grandparents: string;
  childPhoto: string;
}

export const DEFAULT_CONFIG: StoryConfig = {
  childName: '',
  age: '',
  favoriteFood: '',
  favoriteColor: '',
  favoriteActivity: '',
  petName: '',
  petType: '',
  friendName: '',
  siblings: '',
  parents: '',
  grandparents: '',
  childPhoto: '',
};
