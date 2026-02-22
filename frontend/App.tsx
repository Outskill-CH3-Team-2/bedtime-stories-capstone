
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { StoryState, Scene, Choice } from './types';
import { storyService } from './services/storyService';
import Book from './components/Book';

const APP_TITLE = "Dream Weaver";

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
      {/* Video frame */}
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
          {/* Status badge top-right */}
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

      {/* Controls row */}
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

  const [childInfo] = useState({ name: "Arlo", age: 7, personalization: {} });

  const pollingRef = useRef<{
    active: boolean;
    sessionId: string | null;
    intervalId: ReturnType<typeof setInterval> | null;
  }>({ active: false, sessionId: null, intervalId: null });

  const stopPolling = () => {
    pollingRef.current.active = false;
    if (pollingRef.current.intervalId !== null) {
      clearInterval(pollingRef.current.intervalId);
      pollingRef.current.intervalId = null;
    }
  };

  const startPolling = (sessionId: string, isFirstScene: boolean) => {
    stopPolling();
    pollingRef.current.active = true;
    pollingRef.current.sessionId = sessionId;

    pollingRef.current.intervalId = setInterval(async () => {
      if (!pollingRef.current.active) return;
      try {
        const status = await storyService.checkStatus(sessionId);
        if (status === 'complete') {
          stopPolling();
          const result = await storyService.getResult(sessionId);

          if (isFirstScene) {
            setPendingScene(result);
            setState(prev => ({ ...prev, status: 'scene_ready', currentScene: result }));
          } else {
            setDisplayScene(result);
            setState(prev => ({ ...prev, status: 'ready', currentScene: result }));
          }
        } else if (status === 'failed') {
          stopPolling();
          setState(prev => ({ ...prev, status: 'error', error: 'The ink failed to bind to the page.' }));
        }
      } catch (err: any) {
        console.error('[App] polling error:', err);
      }
    }, 2000);
  };

  useEffect(() => () => stopPolling(), []);

  const handleStart = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!idea.trim()) return;
    try {
      setState(prev => ({ ...prev, status: 'starting' }));
      const sessionId = await storyService.startStory(idea, childInfo);
      setState(prev => ({ ...prev, sessionId, status: 'polling' }));
      startPolling(sessionId, true);
    } catch (err: any) {
      setState(prev => ({ ...prev, status: 'error', error: err.message }));
    }
  };

  const handleContinue = () => {
    if (!pendingScene) return;
    setDisplayScene(pendingScene);
    setPendingScene(null);
    setState(prev => ({ ...prev, status: 'ready' }));
  };

  const handleChoice = useCallback(async (choice: Choice) => {
    const sessionId = pollingRef.current.sessionId ?? state.sessionId;
    if (!sessionId) return;
    try {
      setState(prev => ({ ...prev, status: 'polling' }));
      await storyService.submitChoice(sessionId, choice);
      startPolling(sessionId, false);
    } catch (err: any) {
      setState(prev => ({ ...prev, status: 'error', error: 'The story took an unexpected turn…' }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.sessionId]);

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
      {/* Full-window ambient background */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'radial-gradient(ellipse at 50% 60%, #2a1c0a 0%, #0a0602 100%)',
      }} />

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
              setState(p => ({ ...p, status: 'idle', error: null }));
              setDisplayScene(null); setPendingScene(null);
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
