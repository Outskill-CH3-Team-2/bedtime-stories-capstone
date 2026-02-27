import React, { useEffect, useRef, useState, useCallback } from 'react';
import { PageFlip } from 'page-flip';
import { Scene, Choice } from '../types';

export interface BookHandle {
  playAudio: () => void;
}

interface BookProps {
  scene: Scene;
  onChoice: (choice: Choice) => void;
  isGenerating: boolean;
  appTitle?: string;
  audioRef?: React.MutableRefObject<HTMLAudioElement | null>;
}

const Book: React.FC<BookProps> = ({
  scene,
  onChoice,
  isGenerating,
  appTitle = 'Dream Weaver',
  audioRef: audioRefProp,
}) => {
  const containerRef   = useRef<HTMLDivElement>(null);
  const flipRef        = useRef<PageFlip | null>(null);
  const _ownAudioRef   = useRef<HTMLAudioElement | null>(null);
  const pagesRef       = useRef<HTMLElement[]>([]);
  const prevSceneRef   = useRef<Scene | null>(null);
  const pendingPlayRef = useRef<boolean>(false);
  const textScrollRef  = useRef<HTMLDivElement>(null);

  const [isPlaying,    setIsPlaying]    = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [bookW,        setBookW]        = useState(0);
  const [bookH,        setBookH]        = useState(0);

  const audioRef = audioRefProp ?? _ownAudioRef;

  // ── Measure wrapper for PageFlip ──────────────────────────────────────────
  const wrapperRef = useRef<HTMLDivElement>(null);
  const measure = useCallback(() => {
    if (!wrapperRef.current) return;
    const { offsetWidth: W, offsetHeight: H } = wrapperRef.current;
    setBookW(Math.floor(W / 2));
    setBookH(H);
  }, []);

  useEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (wrapperRef.current) ro.observe(wrapperRef.current);
    return () => ro.disconnect();
  }, [measure]);

  // ── Audio Event Listeners ────────────────────────────────────────────────
  useEffect(() => {
    if (!audioRefProp) return;
    const audio = audioRefProp.current;
    if (!audio) return;

    const onEnded  = () => setIsPlaying(false);
    const onPlay   = () => { setIsPlaying(true);  setAudioBlocked(false); };
    const onPause  = () => setIsPlaying(false);
    const onCanPlay = () => {
      if (!pendingPlayRef.current) return;
      pendingPlayRef.current = false;
      audio.play()
        .then(() => { setIsPlaying(true); setAudioBlocked(false); })
        .catch((err) => {
          console.warn('[Book] onCanPlay play() blocked:', err.name);
          setAudioBlocked(true);
        });
    };

    audio.addEventListener('ended',   onEnded);
    audio.addEventListener('play',    onPlay);
    audio.addEventListener('pause',   onPause);
    audio.addEventListener('canplay', onCanPlay);
    return () => {
      audio.removeEventListener('ended',   onEnded);
      audio.removeEventListener('play',    onPlay);
      audio.removeEventListener('pause',   onPause);
      audio.removeEventListener('canplay', onCanPlay);
    };
  }, []);

  // ── Helper: Base64 to Blob ──────────────────────────────────────────────
  const base64ToBlob = (b64: string, type: string) => {
    const byteCharacters = atob(b64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    return URL.createObjectURL(new Blob([byteArray], { type }));
  };

  // ── PageFlip Initialization ───────────────────────────────────────────────
  function makeBlankPage(): HTMLElement {
    const div = document.createElement('div');
    div.style.cssText = 'width:100%;height:100%;background:transparent;';
    return div;
  }

  useEffect(() => {
    if (!bookW || !bookH) return;
    const container = containerRef.current!;

    // [FIX] REMOVED THE LINES THAT WERE KILLING THE AUDIO HERE
    // previously: if (audioRefProp?.current) { ... pause ... } 
    
    if (flipRef.current) {
      try { flipRef.current.destroy(); } catch {}
      flipRef.current = null;
    }
    while (container.firstChild) container.removeChild(container.firstChild);
    pagesRef.current = [];

    const p0 = makeBlankPage();
    const p1 = makeBlankPage();
    pagesRef.current = [p0, p1];
    container.appendChild(p0);
    container.appendChild(p1);

    const pf = new PageFlip(container, {
      width:  bookW,
      height: bookH,
      size: 'fixed' as any,
      drawShadow: true,
      flippingTime: 900,
      usePortrait: false,
      showCover: false,
      mobileScrollSupport: false,
      useMouseEvents: false,
      showPageCorners: false,
      disableFlipByClick: true,
      maxShadowOpacity: 0.5,
      startPage: 0,
      autoSize: false,
    });

    pf.loadFromHTML(pagesRef.current);
    flipRef.current = pf;
    prevSceneRef.current = null;

    return () => { try { pf.destroy(); } catch {} };
  }, [bookW, bookH]);

  // ── Page-flip Animation ──────────────────────────────────────────────────
  useEffect(() => {
    if (!flipRef.current || !bookW) return;
    if (prevSceneRef.current === scene) return;

    if (prevSceneRef.current !== null) {
      const container = containerRef.current!;
      const p0 = makeBlankPage();
      const p1 = makeBlankPage();
      pagesRef.current = [...pagesRef.current, p0, p1];
      container.appendChild(p0);
      container.appendChild(p1);
      flipRef.current.updateFromHtml(pagesRef.current as any);
      setTimeout(() => flipRef.current?.flipNext(), 80);
    }

    prevSceneRef.current = scene;
  }, [scene]);

  // ── Scroll Reset ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (textScrollRef.current) {
      textScrollRef.current.scrollTop = 0;
    }
  }, [scene]);

  // ── Audio Loading Strategy ───────────────────────────────────────────────
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    // 1. Missing Audio Handling
    if (!scene.narration_audio_b64) {
       console.log('[Book] No audio for this scene. Clearing player.');
       audio.pause();
       audio.src = "";
       audio.removeAttribute('data-scene-id');
       setIsPlaying(false);
       return;
    }

    // 2. Check Tag (Instant Play)
    const currentId = audio.dataset.sceneId;
    const targetId  = `${scene.session_id}_${scene.step_number}`;

    if (currentId === targetId) {
       console.log('[Book] Audio matches (App loaded it). Handing over.');
       setAudioBlocked(false);
       if (audio.paused) {
           audio.play().catch(() => setAudioBlocked(true));
       }
       return; 
    }

    // 3. Load New Audio (Fallback)
    console.log('[Book] Loading audio via Blob...');
    audio.pause();
    
    const blobUrl = base64ToBlob(scene.narration_audio_b64, 'audio/wav');
    audio.src = blobUrl;
    audio.dataset.sceneId = targetId;
    audio.load();
    
    pendingPlayRef.current = true;

  }, [scene]);

  const toggleAudio = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio.play()
        .then(() => { setIsPlaying(true); setAudioBlocked(false); })
        .catch((err) => {
          console.warn('[Book] toggleAudio play() rejected:', err);
          setAudioBlocked(true);
        });
    }
  };

  const chapterLabel = scene.step_number <= 0 ? 'The Journey Begins' : 'The Story Continues…';

  return (
    <div style={{
      position: 'relative',
      width: 'min(96vw, calc(96vh * 1.462))',
      aspectRatio: '1826 / 1249',
      flexShrink: 0,
      filter: 'drop-shadow(0 40px 80px rgba(0,0,0,0.9)) drop-shadow(0 10px 20px rgba(0,0,0,0.5))',
    }}>
      <img
        src="/background_02.png"
        alt=""
        aria-hidden
        style={{
          position: 'absolute', inset: 0,
          width: '100%', height: '100%',
          objectFit: 'fill',
          borderRadius: 2,
          pointerEvents: 'none',
          userSelect: 'none',
          zIndex: 0,
        }}
      />

      <div
        ref={wrapperRef}
        style={{
          position: 'absolute',
          top: '8%', bottom: '9%',
          left: '8%', right: '6.5%',
          overflow: 'hidden',
          zIndex: 1,
        }}
      >
        <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      </div>

      <div style={{
        position: 'absolute',
        top: 'calc(8% - 4%)', bottom: '9%',
        left: '8%', right: '50%',
        zIndex: 2,
        display: 'flex', flexDirection: 'column',
        padding: '10% 9% 13% 10%',
        boxSizing: 'border-box', overflow: 'hidden', gap: '2%',
      }}>
        <div style={{ flex: '1 1 0', minHeight: 0, overflow: 'hidden', borderRadius: 2 }}>
          {scene.illustration_b64 ? (
            <img
              src={`data:image/png;base64,${scene.illustration_b64}`}
              alt="scene illustration"
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          ) : (
            <div style={{
              width: '100%', height: '100%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 28, color: 'rgba(139,69,19,0.2)',
            }}>✦</div>
          )}
        </div>
        <p style={{
          fontFamily: "'Cinzel', serif",
          fontSize: 'clamp(6px, 0.7vw, 9px)',
          color: 'rgba(139,69,19,0.5)',
          textTransform: 'uppercase', letterSpacing: '0.3em',
          textAlign: 'center', margin: 0, flexShrink: 0,
        }}>
          {appTitle} — Chapter {scene.step_number + 1}
        </p>
      </div>

      <div style={{
        position: 'absolute',
        top: 'calc(8% - 4%)', bottom: '8%',
        left: 'calc(50% - 3.5%)', right: '6.5%',
        zIndex: 2,
        display: 'flex', flexDirection: 'column',
        padding: '9% 13% 2% 9%',
        boxSizing: 'border-box', overflow: 'hidden',
      }}>
        <h2 style={{
          fontFamily: "'Cinzel', serif",
          fontSize: 'clamp(10px, 1.1vw, 15px)',
          color: '#1a0f0a', margin: '0 0 4% 0',
          paddingBottom: '3%', borderBottom: '1px solid rgba(61,31,13,0.18)',
          lineHeight: 1.2, flexShrink: 0,
        }}>
          {chapterLabel}
        </h2>

        <div 
          ref={textScrollRef}
          style={{
            flex: '0 1 auto', maxHeight: '45%',
            overflowY: 'auto', overflowX: 'hidden',
            paddingRight: '4px', scrollbarWidth: 'thin',
            scrollbarColor: 'rgba(139,69,19,0.25) transparent',
          } as React.CSSProperties}>
          <p style={{
            fontFamily: "'Crimson Text', serif",
            fontSize: 'clamp(14px, 1.4vw, 17px)',
            color: '#2c1810', lineHeight: 1.7,
            textAlign: 'justify', fontStyle: 'italic', margin: 0,
          }}>
            {scene.story_text}
          </p>
        </div>

        <div style={{ flexShrink: 0, paddingTop: 'calc(4% + 50px)' }}>
          {scene.is_ending ? (
            <div style={{ textAlign: 'center', padding: '8% 0' }}>
              <div style={{ width: 30, height: 1, background: 'rgba(139,69,19,0.3)', margin: '0 auto 8px' }} />
              <p style={{ fontFamily: "'Cinzel',serif", fontSize: 'clamp(10px,1.1vw,14px)', color: '#3d1f0d', margin: 0 }}>
                The End
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3%' }}>
              {scene.choices.map(c => (
                <button
                  key={c.id}
                  disabled={isGenerating}
                  onClick={() => {
                    const audio = audioRef.current;
                    if (audio) { audio.pause(); }
                    onChoice(c);
                  }}
                  style={{
                    width: '100%', textAlign: 'left',
                    padding: '3% 4%', background: 'transparent',
                    border: '1px solid rgba(139,69,19,0.28)', borderRadius: 2,
                    fontFamily: "'Crimson Text', serif",
                    fontSize: 'clamp(10px, 1vw, 13px)', color: '#2c1810',
                    cursor: isGenerating ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', gap: '4%',
                    opacity: isGenerating ? 0.4 : 1, transition: 'opacity 0.2s',
                  }}
                >
                  <span style={{ color: 'rgba(139,69,19,0.45)', fontSize: '0.85em', flexShrink: 0 }}>❧</span>
                  <span style={{ flex: 1 }}>{c.text}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {!audioRefProp && (
        <audio
          ref={_ownAudioRef}
          onEnded={() => setIsPlaying(false)}
          onPlay={() => { setIsPlaying(true); setAudioBlocked(false); }}
          onPause={() => setIsPlaying(false)}
          onCanPlay={() => {
            if (!pendingPlayRef.current) return;
            pendingPlayRef.current = false;
            _ownAudioRef.current?.play()
              .then(() => { setIsPlaying(true); setAudioBlocked(false); })
              .catch((err) => {
                console.warn('[Book] own audio autoplay blocked:', err.name);
                setAudioBlocked(true);
              });
          }}
        />
      )}

      <div style={{
        position: 'absolute', bottom: '11.5%', left: '10%',
        display: 'flex', alignItems: 'center', gap: 8, zIndex: 10,
      }}>
        <button onClick={toggleAudio} className="pf-audio-btn"
          title={isPlaying ? 'Pause narration' : 'Play narration'}>
          {isPlaying
            ? <svg height="14" width="14" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
            : <svg height="14" width="14" fill="currentColor" viewBox="0 0 24 24" style={{ marginLeft: 2 }}><path d="M8 5v14l11-7z"/></svg>
          }
        </button>
        <div className="pf-wave-bars">
          {[0, 0.1, 0.2, 0.15, 0.05].map((delay, i) => (
            <div key={i} className={`pf-wave-bar${isPlaying ? ' playing' : ''}`}
              style={{ animationDelay: `${delay}s`, animationDuration: `${0.5 + i * 0.07}s` }} />
          ))}
        </div>
        {audioBlocked && (
          <span style={{
            fontFamily: "'Cinzel',serif", fontSize: 8, color: '#8b4513',
            letterSpacing: '0.15em', textTransform: 'uppercase', opacity: 0.75,
          }}>
            ▶ tap to hear
          </span>
        )}
      </div>

      {isGenerating && (
        <div style={{
          position: 'absolute', top: '10.5%', right: '10%',
          display: 'flex', alignItems: 'center', gap: 6, zIndex: 10,
        }}>
          <span className="spin-ring-sm" style={{ borderTopColor: '#8b4513' }} />
          <span style={{
            fontFamily: "'Cinzel',serif", fontSize: 9, color: '#8b4513',
            letterSpacing: '0.2em', textTransform: 'uppercase',
          }}>Writing…</span>
        </div>
      )}
    </div>
  );
};

export default Book;