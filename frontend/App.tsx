import React, { useState, useEffect, useCallback, useRef } from 'react';
import { StoryState, Scene, Choice, PrefiredJob, StoryConfig, DEFAULT_CONFIG, FamilyMember } from './types';
import { storyService } from './services/storyService';

// Migrates saved configs from older formats to the current shape
function migrateConfig(raw: any): StoryConfig {
  const base: StoryConfig = { ...DEFAULT_CONFIG, ...raw };

  // ── Favorites: old string → new string[] ─────────────────────────────────
  if (!Array.isArray(base.favoriteFoods)) {
    const old = (raw.favoriteFood || raw.favoriteFoods || '') as string;
    base.favoriteFoods = old ? [old] : [];
  }
  if (!Array.isArray(base.favoriteColors)) {
    const old = (raw.favoriteColor || raw.favoriteColors || '') as string;
    base.favoriteColors = old ? [old] : [];
  }
  if (!Array.isArray(base.favoriteActivities)) {
    const old = (raw.favoriteActivity || raw.favoriteActivities || '') as string;
    base.favoriteActivities = old ? [old] : [];
  }

  // ── Family arrays ─────────────────────────────────────────────────────────
  if (typeof raw.siblings === 'string') base.siblings = [];
  if (typeof raw.parents === 'string') base.parents = DEFAULT_CONFIG.parents;
  if (typeof raw.grandparents === 'string') base.grandparents = DEFAULT_CONFIG.grandparents;
  if (typeof raw.privacyAcknowledged !== 'boolean') base.privacyAcknowledged = false;

  const toMembers = (arr: any[]): FamilyMember[] =>
    arr.filter(m => m && typeof m === 'object').map(m => ({
      name:     typeof m.name     === 'string' ? m.name     : '',
      relation: typeof m.relation === 'string' ? m.relation : '',
      photo:    typeof m.photo    === 'string' ? m.photo    : undefined,
    }));
  base.siblings     = toMembers(base.siblings     as any[]);
  base.parents      = toMembers(base.parents      as any[]);
  base.grandparents = toMembers(base.grandparents as any[]);

  return base;
}

/**
 * For each named family member: register their reference image with the backend.
 * If they have an uploaded photo, register it directly.
 * If not, call /story/avatar to generate a storybook portrait then register that.
 * Runs entirely in the background — does NOT block story display.
 */
async function registerSideCharacters(sessionId: string, config: StoryConfig): Promise<void> {
  const members: FamilyMember[] = [
    ...config.siblings,
    ...config.parents,
    ...config.grandparents,
  ].filter(m => m.name.trim());

  for (const member of members) {
    try {
      let imageB64 = member.photo;
      if (!imageB64) {
        console.log(`[App] Generating avatar for ${member.name} (${member.relation})…`);
        imageB64 = await storyService.generateAvatar(member.name, member.relation);
      }
      await storyService.addCharacter(sessionId, {
        name:        member.name,
        role:        'side',
        image_b64:   imageB64,
        description: member.relation,
      });
      console.log(`[App] Registered side character: ${member.name}`);
    } catch (err) {
      console.warn(`[App] Could not register ${member.name}:`, err);
    }
  }
}
import Book from './components/Book';
import ConfigurationPage from './components/ConfigurationPage';
import LandingCanvas from './components/LandingCanvas';

const APP_TITLE = "Dream Weaver";

// ── Intro video player shown while the story is generating ──────────────────
interface IntroScreenProps {
  storyReady: boolean;
  onContinue: () => void;
}

const IntroScreen: React.FC<IntroScreenProps> = ({ storyReady, onContinue }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(true);

  // Stop video immediately when component unmounts to free up audio context
  useEffect(() => {
    return () => {
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.src = "";
      }
    };
  }, []);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play(); setPlaying(true); }
    else { v.pause(); setPlaying(false); }
  };

  const restart = () => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = 0;
    v.play();
    setPlaying(true);
  };

  return (
    <div className="relative z-10 w-full max-w-3xl animate-fadeIn flex flex-col items-center px-4 gap-5">
      <div className="w-full book-shadow" style={{ border: '10px solid #2c1810', borderRadius: 2, overflow: 'hidden', background: '#0a0705' }}>
        <div style={{ position: 'relative', width: '100%', aspectRatio: '16/9' }}>
          <video
            ref={videoRef}
            src="/BedtimeStoryIntro.mp4"
            autoPlay
            loop
            playsInline
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
          />
          <div style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            background: 'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.55) 100%)',
          }} />
          <div style={{
            position: 'absolute', top: 14, right: 14,
            display: 'flex', alignItems: 'center', gap: 7,
            background: 'rgba(10,7,5,0.75)', backdropFilter: 'blur(4px)',
            border: '1px solid rgba(242,232,207,0.15)',
            borderRadius: 20, padding: '5px 12px',
          }}>
            {storyReady ? (
              <>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#4caf50', boxShadow: '0 0 6px #4caf50', flexShrink: 0 }} />
                <span className="font-cinzel" style={{ fontSize: 10, color: '#f2e8cf', letterSpacing: '0.2em', textTransform: 'uppercase' }}>Ready</span>
              </>
            ) : (
              <>
                <span className="spin-ring-sm" />
                <span className="font-cinzel" style={{ fontSize: 10, color: '#f2e8cf80', letterSpacing: '0.2em', textTransform: 'uppercase' }}>Writing your story…</span>
              </>
            )}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, width: '100%', maxWidth: 480 }}>
        <button onClick={togglePlay} className="ink-btn-dark" title={playing ? 'Pause' : 'Play'}
          style={{ width: 44, height: 44, borderRadius: '50%', flexShrink: 0 }}>
          {playing
            ? <svg height="18" width="18" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
            : <svg height="18" width="18" fill="currentColor" viewBox="0 0 24 24" style={{ marginLeft: 2 }}><path d="M8 5v14l11-7z" /></svg>
          }
        </button>
        <button onClick={restart} className="ink-btn-dark" title="Restart video"
          style={{ width: 44, height: 44, borderRadius: '50%', flexShrink: 0 }}>
          <svg height="18" width="18" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" />
          </svg>
        </button>
        <button
          onClick={onContinue}
          disabled={!storyReady}
          className="font-cinzel"
          style={{
            flex: 1, height: 44,
            background: storyReady ? '#8b4513' : 'rgba(139,69,19,0.25)',
            color: storyReady ? '#f2e8cf' : 'rgba(242,232,207,0.35)',
            border: `1px solid ${storyReady ? '#8b4513' : 'rgba(139,69,19,0.3)'}`,
            borderRadius: 2, fontSize: 11, letterSpacing: '0.3em',
            textTransform: 'uppercase' as const,
            cursor: storyReady ? 'pointer' : 'not-allowed',
            transition: 'all 0.4s ease',
            boxShadow: storyReady ? '0 4px 18px rgba(139,69,19,0.4)' : 'none',
          }}
        >
          {storyReady ? 'Open the Book  ›' : 'Preparing your tale…'}
        </button>
      </div>
    </div>
  );
};

// ── Main App ─────────────────────────────────────────────────────────────────
const App: React.FC = () => {
  const [idea, setIdea] = useState('');
  const [displayScene, setDisplayScene] = useState<Scene | null>(null);
  const [pendingScene, setPendingScene] = useState<Scene | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [config, setConfig] = useState<StoryConfig>(DEFAULT_CONFIG);
  const [animPaused, setAnimPaused] = useState(false);
  // true only when every prefired job for the current scene is downloaded & cached
  const [choicesReady, setChoicesReady] = useState(false);

  const [state, setState] = useState<StoryState>({
    sessionId: null,
    currentScene: null,
    status: 'idle',
    error: null,
  });

  const prefiredJobsRef = useRef<Map<string, PrefiredJob>>(new Map());
  const activeJobIdRef = useRef<string | null>(null);
  const selectedJobRef = useRef<{ jobId: string; choiceText: string } | null>(null);
  const pollingRef = useRef<{ active: boolean; intervalId: ReturnType<typeof setInterval> | null; }>({ active: false, intervalId: null });
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const stopPolling = () => {
    pollingRef.current.active = false;
    if (pollingRef.current.intervalId !== null) {
      clearInterval(pollingRef.current.intervalId);
      pollingRef.current.intervalId = null;
    }
  };

  // Background Poller — downloads prefired results and tracks when all are ready
  useEffect(() => {
    const backgroundInterval = setInterval(() => {
      const jobs: PrefiredJob[] = Array.from(prefiredJobsRef.current.values()) as PrefiredJob[];
      if (jobs.length === 0) return;

      jobs.forEach((job) => {
        if (!storyService.isResultCached(job.jobId)) {
          storyService.checkAndCache(job.jobId).catch(() => { });
        }
      });

      // Enable choices only when EVERY prefired job is in cache
      const allReady = jobs.every((job) => storyService.isResultCached(job.jobId));
      setChoicesReady(allReady);
    }, 2000);

    return () => clearInterval(backgroundInterval);
  }, []);

  // Prune stale IDB entries on startup; open config screen if no saved config
  useEffect(() => {
    storyService.clearOldEntries().catch(() => { });
    storyService.loadConfig().then((loaded) => {
      if (loaded && loaded.childName) {
        console.log('[App] Loaded saved configuration from IDB');
        setConfig(migrateConfig(loaded));
      } else {
        console.log('[App] No saved config found — opening configuration screen');
        setShowConfig(true);
      }
    }).catch(() => {
      // IDB unavailable — open config so user can fill in details
      setShowConfig(true);
    });
  }, []);
  // ─────────────────────────────────────────────────────────────────────────

  const prefireNextChapterJobs = useCallback(async (
    sessionId: string,
    choices: Choice[],
  ) => {
    if (!choices.length) return;

    prefiredJobsRef.current.clear();
    setChoicesReady(false); // lock buttons until all prefired jobs are downloaded
    const prevSelected = selectedJobRef.current;
    selectedJobRef.current = null;

    // Fire all choices in parallel — pass prevSelected to EVERY request so the
    // backend commits the selected branch's history regardless of which request
    // the server processes first (the backend deduplicates via last_committed_job_id).
    const promises = choices.map(async (choice) => {
      try {
        const job = await storyService.pregenerateNextChapter(
          sessionId,
          choice.text,
          prevSelected?.jobId,
          prevSelected?.choiceText,
        );
        prefiredJobsRef.current.set(choice.text, job);
        console.log(`[App] Pre-fired job ${job.jobId} for choice: "${choice.text.slice(0, 40)}"`);
      } catch (err: any) {
        console.error(`[App] Failed to pre-fire job for choice "${choice.text}":`, err);
      }
    });

    await Promise.all(promises);

    // Persist prefired jobs so IDB can serve them across refresh
    const allJobs = Array.from(prefiredJobsRef.current.values()) as PrefiredJob[];
    if (allJobs.length > 0) {
      storyService.savePrefired(sessionId, allJobs).catch(() => { });
    }
  }, []);

  const startPolling = useCallback((jobId: string, isFirstScene: boolean) => {
    stopPolling();
    activeJobIdRef.current = jobId;
    pollingRef.current.active = true;

    pollingRef.current.intervalId = setInterval(async () => {
      if (!pollingRef.current.active) return;
      try {
        const status = await storyService.checkStatus(jobId);
        if (status === 'complete') {
          stopPolling();
          const result = await storyService.getResult(jobId);

          if (isFirstScene) {
            setPendingScene(result);
            setState(prev => ({ ...prev, status: 'scene_ready', currentScene: result }));
            // Persist the session pointer so refresh can resume here
            storyService.saveSession(result.session_id, jobId).catch(() => { });
          } else {
            setDisplayScene(result);
            setState(prev => ({ ...prev, status: 'ready', currentScene: result }));
            // Persist the session pointer so refresh can resume from this step
            storyService.saveSession(result.session_id, jobId).catch(() => { });
            if (!result.is_ending && result.choices.length > 0) {
              prefireNextChapterJobs(result.session_id, result.choices);
            }
          }
          if (result.narration_audio_b64) {
            storyService.debugStt(jobId, result.narration_audio_b64, result.story_text);
          }
        } else if (status === 'failed') {
          stopPolling();
          setState(prev => ({ ...prev, status: 'error', error: 'The ink failed to bind to the page.' }));
        }
      } catch (err: any) {
        console.error('[App] polling error:', err);
      }
    }, 2000);
  }, [prefireNextChapterJobs]);

  useEffect(() => () => stopPolling(), []);

  const handleStart = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!idea.trim()) return;
    try {
      // Clear any previous session from IDB before starting fresh
      storyService.clearCache().catch(() => { });

      setState(prev => ({ ...prev, status: 'starting' }));

      const childInfo = {
        name: config.childName || "Arlo",
        age: config.age ? Number(config.age) : 7,
        personalization: { ...config }
      };

      const { sessionId, jobId } = await storyService.startStory(idea, childInfo);
      setState(prev => ({ ...prev, sessionId, status: 'polling' }));
      startPolling(jobId, true);

      // Background: register side characters while intro video plays
      registerSideCharacters(sessionId, config).catch(err =>
        console.warn('[App] Side character registration error:', err)
      );
    } catch (err: any) {
      setState(prev => ({ ...prev, status: 'error', error: err.message }));
    }
  };

  const handleContinue = useCallback(() => {
    if (!pendingScene || !state.sessionId) return;

    // [FIX] Play First Page Audio synchronously
    const audio = audioRef.current;
    if (audio && pendingScene.narration_audio_b64) {
      audio.pause();
      audio.currentTime = 0;
      audio.src = `data:audio/wav;base64,${pendingScene.narration_audio_b64}`;
      // Tag it so Book.tsx knows we started it
      audio.dataset.sceneId = `${pendingScene.session_id}_${pendingScene.step_number}`;
      audio.load();
      audio.play().catch((err) => console.warn('[App] First page play blocked:', err));
    }

    setDisplayScene(pendingScene);
    setPendingScene(null);
    setState(prev => ({ ...prev, status: 'ready' }));

    if (!pendingScene.is_ending) {
      prefireNextChapterJobs(state.sessionId, pendingScene.choices);
    }
  }, [pendingScene, state.sessionId, prefireNextChapterJobs]);

  const handleChoice = useCallback(async (choice: Choice) => {
    const sessionId = state.sessionId;
    if (!sessionId) return;

    const prefiredJob = prefiredJobsRef.current.get(choice.text);
    if (!prefiredJob) {
      setState(prev => ({ ...prev, status: 'error', error: 'Pre-generated branch not found — please try again.' }));
      return;
    }

    const audio = audioRef.current;
    if (audio) audio.pause(); // Stop old track

    selectedJobRef.current = { jobId: prefiredJob.jobId, choiceText: choice.text };

    // Instant Swap Logic
    const cachedResult = await storyService.getCompletedResult(prefiredJob.jobId);
    if (cachedResult) {
      console.log(`⚡ [App] Instant transition to Step ${cachedResult.step_number}`);

      // Play Instant Audio
      if (audio && cachedResult.narration_audio_b64) {
        audio.src = `data:audio/wav;base64,${cachedResult.narration_audio_b64}`;
        audio.dataset.sceneId = `${cachedResult.session_id}_${cachedResult.step_number}`;
        audio.load();
        audio.play().catch(e => console.warn("Instant play blocked:", e));
      }

      setDisplayScene(cachedResult);
      setPendingScene(null);
      setState(prev => ({ ...prev, status: 'ready', currentScene: cachedResult }));

      if (!cachedResult.is_ending && cachedResult.choices.length > 0) {
        prefireNextChapterJobs(sessionId, cachedResult.choices);
      }
      return;
    }

    // Fallback Polling
    // Clear audio data-scene-id so Book.tsx will take over when polling finishes
    if (audio) audio.removeAttribute('data-scene-id');

    setState(prev => ({ ...prev, status: 'polling' }));
    startPolling(prefiredJob.jobId, false);
  }, [state.sessionId, startPolling, prefireNextChapterJobs]);

  const isGenerating = state.status === 'polling';
  const showIntro = state.status === 'starting' || state.status === 'polling' || state.status === 'scene_ready';
  const showBook = displayScene !== null && (state.status === 'ready' || state.status === 'polling');

  return (
    <div style={{
      position: 'fixed', inset: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#fdf6e9',
      overflow: 'hidden',
    }}>
      {/* Dynamic Background Layer */}
      <div style={{
        position: 'absolute', inset: 0,
        background: state.status === 'idle'
          ? 'linear-gradient(to bottom, #070b19 0%, #1a2542 60%, #301f1a 100%)'
          : 'radial-gradient(ellipse at 50% 40%, #fef3d7 0%, #f5e6c8 45%, #ecdbb0 100%)',
        transition: 'background 1.5s ease',
      }} />

      {/* Very faint paper texture overlay */}
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='300' height='300' filter='url(%23noise)' opacity='0.04'/%3E%3C/svg%3E")`,
        backgroundRepeat: 'repeat',
        opacity: state.status === 'idle' ? 0.3 : 0.6,
        pointerEvents: 'none',
        transition: 'opacity 1.5s ease',
      }} />

      {/* Canvas particle layer — lightweight starry dust in idle state */}
      {state.status === 'idle' && <LandingCanvas paused={animPaused} />}

      <audio ref={audioRef} style={{ display: 'none' }} />

      {/* Top-right controls: Pause | Settings */}
      {state.status === 'idle' && (
        <div className="fixed top-4 right-4 flex items-center gap-2" style={{ zIndex: 60 }}>
          {/* Pause / Resume animation toggle */}
          <button
            onClick={() => setAnimPaused(p => !p)}
            className="p-2.5 text-[#6b3a1f] hover:text-[#f2e8cf] hover:bg-[#8b4513] transition-all rounded-full flex items-center justify-center opacity-70 hover:opacity-100 bg-white/60 border border-[#c9a87c]/50 backdrop-blur-sm shadow-sm"
            title={animPaused ? 'Resume animations' : 'Pause animations'}
            aria-label={animPaused ? 'Resume animations' : 'Pause animations'}
          >
            {animPaused ? (
              // Play icon
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            ) : (
              // Pause icon
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
              </svg>
            )}
          </button>

          {/* Settings / Configuration button */}
          <button
            onClick={() => setShowConfig(true)}
            className="p-3 text-[#6b3a1f] hover:text-[#f2e8cf] hover:bg-[#8b4513] transition-all rounded-full flex items-center justify-center opacity-80 hover:opacity-100 bg-white/60 border border-[#c9a87c]/50 backdrop-blur-sm shadow-sm"
            title="Personalize Story"
            aria-label="Configuration Settings"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
          </button>
        </div>
      )}

      {state.status === 'idle' && (
        <div className="relative z-10 flex flex-col items-center animate-fadeIn px-6 w-full max-w-lg" style={{ marginTop: '2vh' }}>

          {/* Animated tagline — stagger-letter fade above title */}
          <div aria-label="Every night, a new adventure" style={{
            position: 'relative', zIndex: 1,
            fontFamily: "'Cinzel', serif",
            fontSize: 10,
            letterSpacing: '0.25em',
            textTransform: 'uppercase',
            color: '#cbd5e1', // silver
            textAlign: 'center',
            whiteSpace: 'nowrap',
            marginBottom: 10,
          }}>
            {'Every night, a new adventure'.split('').map((char, i) => (
              <span key={i} className="tagline-letter" style={{ animationDelay: `${0.6 + i * 0.035}s` }}>
                {char === ' ' ? ' ' : char}
              </span>
            ))}
          </div>

          <h1 className="font-cinzel text-5xl md:text-[52px] text-[#f8fafc] mb-8 tracking-tight whitespace-nowrap" style={{ textShadow: '0 4px 16px rgba(0,0,0,0.5)' }}>
            Dream Weaver
          </h1>

          <div className="relative p-4 rounded-2xl backdrop-blur-xl bg-white/10 border border-white/20 shadow-[0_12px_40px_rgba(0,0,0,0.8)] mb-8 w-[85%] max-w-[340px]">
            <img src="/ClosedBook.png" alt="A closed storybook"
              className="book-float rounded-xl"
              style={{ width: '100%', height: 'auto', display: 'block', filter: 'drop-shadow(0 8px 20px rgba(0,0,0,0.4))', position: 'relative', zIndex: 1 }} />
          </div>

          <form onSubmit={handleStart} className="w-full flex flex-col items-center space-y-6">
            <textarea
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              placeholder="Begin a tale about… a brave knight who befriends a dragon"
              rows={2}
              className="prompt-reveal w-full max-w-sm bg-black/20 border border-white/10 backdrop-blur-md rounded-xl p-4 text-center text-lg font-serif italic outline-none text-[#f8fafc] placeholder:text-[#94a3b8] focus:border-white/30 focus:bg-black/30 transition-all resize-none shadow-inner"
              style={{ lineHeight: '1.4', textShadow: '0 2px 4px rgba(0,0,0,0.5)' }}
            />
            <button type="submit"
              className="cta-reveal w-[260px] py-3.5 bg-gradient-to-b from-[#4a2411] to-[#2d1205] text-[#fef3d7] font-cinzel text-[13px] rounded-full tracking-[0.2em] shadow-[0_4px_14px_rgba(0,0,0,0.5)] uppercase hover:from-[#5c2d15] hover:to-[#3e1806] transition-all border border-[#5c351c] flex items-center justify-center">
              Open the Book
            </button>
          </form>
        </div>
      )}

      {showConfig && (
        <ConfigurationPage
          config={config}
          onSave={(newConfig) => {
            setConfig(newConfig);
            storyService.saveConfig(newConfig).catch(() => { });
            setShowConfig(false);
          }}
          onClose={() => setShowConfig(false)}
        />
      )}

      {showIntro && !showBook && (
        <IntroScreen storyReady={state.status === 'scene_ready'} onContinue={handleContinue} />
      )}

      {showBook && (
        <div className="relative z-10 animate-fadeIn" style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Book
            audioRef={audioRef}
            scene={displayScene!}
            onChoice={handleChoice}
            isGenerating={isGenerating}
            choicesReady={choicesReady}
            appTitle={APP_TITLE}
          />
        </div>
      )}

      {state.status === 'error' && (
        <div className="relative z-10 max-w-md w-full p-12 bg-[#2c1810] text-[#f2e8cf] rounded-sm text-center font-cinzel border-4 border-[#8b4513] book-shadow">
          <div className="text-4xl mb-6">✦</div>
          <p className="text-xl mb-4 tracking-widest uppercase">A Great Calamity</p>
          <p className="text-sm opacity-60 mb-10 font-serif italic leading-relaxed">{state.error}</p>
          <button
            onClick={() => {
              stopPolling();
              prefiredJobsRef.current.clear();
              selectedJobRef.current = null;
              setState(p => ({ ...p, status: 'idle', error: null, sessionId: null }));
              setDisplayScene(null);
              setPendingScene(null);
            }}
            className="w-full py-4 bg-[#f2e8cf] text-[#2c1810] font-bold hover:bg-white transition-all uppercase tracking-widest text-sm"
          >
            Rewind the Clock
          </button>
        </div>
      )}
    </div>
  );
};

export default App;