
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { StoryState, Scene, Choice, PrefiredJob } from './types';
import { storyService } from './services/storyService';
import Book from './components/Book';

const APP_TITLE = "Dream Weaver";
const CHILD_INFO = { name: "Arlo", age: 7, personalization: {} };

// ── Intro video player shown while the story is generating ──────────────────
interface IntroScreenProps {
  storyReady: boolean;
  onContinue: () => void;
}

const IntroScreen: React.FC<IntroScreenProps> = ({ storyReady, onContinue }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(true);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play(); setPlaying(true); }
    else          { v.pause(); setPlaying(false); }
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
            ? <svg height="18" width="18" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
            : <svg height="18" width="18" fill="currentColor" viewBox="0 0 24 24" style={{ marginLeft: 2 }}><path d="M8 5v14l11-7z"/></svg>
          }
        </button>
        <button onClick={restart} className="ink-btn-dark" title="Restart video"
          style={{ width: 44, height: 44, borderRadius: '50%', flexShrink: 0 }}>
          <svg height="18" width="18" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/>
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

  const [state, setState] = useState<StoryState>({
    sessionId: null,
    currentScene: null,
    status: 'idle',
    error: null,
  });

  // Pre-fired jobs: one per choice in the current scene.
  // Map from choiceText → PrefiredJob so we can look up by what the user picked.
  const prefiredJobsRef = useRef<Map<string, PrefiredJob>>(new Map());

  // The job we're currently polling (first chapter or the selected branch job).
  const activeJobIdRef = useRef<string | null>(null);

  // The job + choice that was selected last round — needed to commit history.
  const selectedJobRef = useRef<{ jobId: string; choiceText: string } | null>(null);

  const pollingRef = useRef<{
    active: boolean;
    intervalId: ReturnType<typeof setInterval> | null;
  }>({ active: false, intervalId: null });

  // App-owned audio element ref — shared with Book so we can call .play()
  // synchronously from gesture handlers (handleContinue, handleChoice) before
  // React has a chance to schedule an async useEffect.
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const stopPolling = () => {
    pollingRef.current.active = false;
    if (pollingRef.current.intervalId !== null) {
      clearInterval(pollingRef.current.intervalId);
      pollingRef.current.intervalId = null;
    }
  };

  /**
   * Pre-fire one job per choice for the upcoming scene.
   * Called as soon as a scene is displayed (not when the user picks).
   * On the first pre-fire of a new round, passes prevJobId + prevChoiceText
   * to commit the selected branch's history in the backend.
   */
  const prefireNextChapterJobs = useCallback(async (
    sessionId: string,
    choices: Choice[],
  ) => {
    if (!choices.length) return;

    prefiredJobsRef.current.clear();
    const prevSelected = selectedJobRef.current;
    selectedJobRef.current = null; // reset; will be set on next pick

    for (let i = 0; i < choices.length; i++) {
      const choice = choices[i];
      try {
        // Only the first pre-fire carries the commit payload
        const isFirst = i === 0;
        const job = await storyService.pregenerateNextChapter(
          sessionId,
          choice.text,
          isFirst ? prevSelected?.jobId : undefined,
          isFirst ? prevSelected?.choiceText : undefined,
        );
        prefiredJobsRef.current.set(choice.text, job);
        console.log(`[App] Pre-fired job ${job.jobId} for choice: "${choice.text.slice(0, 40)}"`);
      } catch (err: any) {
        console.error(`[App] Failed to pre-fire job for choice "${choice.text}":`, err);
      }
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
            } else {
              setDisplayScene(result);
              setState(prev => ({ ...prev, status: 'ready', currentScene: result }));
              // Pre-fire next chapter jobs exactly here — once, with the correct session state.
              // selectedJobRef is already set by handleChoice before startPolling was called.
              if (!result.is_ending && result.choices.length > 0) {
                prefireNextChapterJobs(result.session_id, result.choices);
              }
            }
            // [DEBUG] STT: transcribe the received audio and compare to story_text
            if (result.narration_audio_b64) {
              storyService.debugStt(jobId, result.narration_audio_b64, result.story_text);
            } else {
              console.warn(`[debugStt] job=${jobId} — no audio in result (narration_audio_b64 is empty)`);
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
      setState(prev => ({ ...prev, status: 'starting' }));
      const { sessionId, jobId } = await storyService.startStory(idea, CHILD_INFO);
      setState(prev => ({ ...prev, sessionId, status: 'polling' }));
      startPolling(jobId, true);
    } catch (err: any) {
      setState(prev => ({ ...prev, status: 'error', error: err.message }));
    }
  };

  // User clicks "Open the Book" — move pending scene to display and pre-fire jobs
  const handleContinue = useCallback(() => {
    if (!pendingScene || !state.sessionId) return;

    // ── Play audio synchronously while still in the gesture handler ──────────
    // This is the ONLY reliable way to pass Chrome's autoplay policy:
    // audio.src + audio.play() must be called directly in the click callback,
    // not inside a useEffect (which runs after paint, possibly after gesture window).
    const audio = audioRef.current;
    if (audio && pendingScene.narration_audio_b64) {
      audio.src = `data:audio/wav;base64,${pendingScene.narration_audio_b64}`;
      audio.load();
      audio.play().catch((err) => {
        console.warn('[App] handleContinue play() blocked:', err.name);
      });
    }

    setDisplayScene(pendingScene);
    setPendingScene(null);
    setState(prev => ({ ...prev, status: 'ready' }));

    // Pre-fire next chapter jobs for all choices in the scene
    if (!pendingScene.is_ending) {
      prefireNextChapterJobs(state.sessionId, pendingScene.choices);
    }
  }, [pendingScene, state.sessionId, prefireNextChapterJobs]);

  // User selects a choice — find the pre-fired job and poll it
  const handleChoice = useCallback(async (choice: Choice) => {
    const sessionId = state.sessionId;
    if (!sessionId) return;

    const prefiredJob = prefiredJobsRef.current.get(choice.text);
    if (!prefiredJob) {
      setState(prev => ({ ...prev, status: 'error', error: 'Pre-generated branch not found — please try again.' }));
      return;
    }

    // ── Unlock audio context while inside the gesture handler ────────────────
    // The next scene's audio will arrive from a polling callback (not a gesture).
    // Calling play() NOW (on the current audio) keeps the audio context "active",
    // so that when Book later calls audio.src = newSrc + audio.play(), the browser
    // allows it without requiring another gesture.
    const audio = audioRef.current;
    if (audio) {
      audio.play().catch(() => { /* already playing or blocked — ignore */ });
    }

    // Record this selection so the NEXT round can commit it
    selectedJobRef.current = { jobId: prefiredJob.jobId, choiceText: choice.text };

    setState(prev => ({ ...prev, status: 'polling' }));
    startPolling(prefiredJob.jobId, false);
  }, [state.sessionId, startPolling]);

  const isGenerating = state.status === 'polling';
  const showIntro = state.status === 'starting' || state.status === 'polling' || state.status === 'scene_ready';
  const showBook  = displayScene !== null && (state.status === 'ready' || state.status === 'polling');

  return (
    <div style={{
      position: 'fixed', inset: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#0a0602',
      overflow: 'hidden',
    }}>
      <div style={{
          position: 'absolute', inset: 0,
          background: 'radial-gradient(ellipse at 50% 60%, #2a1c0a 0%, #0a0602 100%)',
        }} />

        {/* Always-mounted audio element so handleContinue/handleChoice can call
            audio.play() synchronously in the gesture handler before Book mounts. */}
        <audio ref={audioRef} style={{ display: 'none' }} />

        {/* Idle: Start Screen */}
      {state.status === 'idle' && (
        <div className="relative z-10 flex flex-col items-center animate-fadeIn px-4 w-full" style={{ maxWidth: 480 }}>
          <img src="/ClosedBook.png" alt="A closed storybook" className="w-full"
            style={{ filter: 'drop-shadow(0 20px 60px rgba(0,0,0,0.8))' }} />
          <form onSubmit={handleStart} className="w-full mt-6 space-y-4">
            <textarea
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              placeholder="Begin a tale about… a brave knight who befriends a dragon"
              rows={2}
              className="w-full bg-[#1a0f0a]/80 border border-[#8b4513]/50 rounded-sm p-4 text-base font-serif italic outline-none text-[#f2e8cf] placeholder:text-[#f2e8cf]/25 focus:border-[#8b4513] transition-all resize-none"
            />
            <button type="submit"
              className="w-full py-3 bg-[#8b4513] text-[#f2e8cf] font-cinzel text-sm rounded-sm hover:bg-[#a0521a] transition-all shadow-xl uppercase tracking-[0.3em]">
              Open the Book
            </button>
          </form>
        </div>
      )}

      {/* Intro video */}
      {showIntro && !showBook && (
        <IntroScreen storyReady={state.status === 'scene_ready'} onContinue={handleContinue} />
      )}

      {/* Book view */}
      {showBook && (
        <div className="relative z-10 animate-fadeIn" style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Book
              audioRef={audioRef}
              scene={displayScene!}
              onChoice={handleChoice}
              isGenerating={isGenerating}
              appTitle={APP_TITLE}
            />
        </div>
      )}

      {/* Error */}
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
