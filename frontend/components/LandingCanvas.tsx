import React, { useMemo } from 'react';

interface LandingCanvasProps {
    paused: boolean;
}

// Deterministic pseudo-random — stable across re-renders, no state needed
function seededRng(seed: number): number {
    const x = Math.sin(seed + 1) * 10000;
    return x - Math.floor(x);
}

const PARTICLE_COUNT = 18;
const MOBILE_BREAKPOINT = 768;

const LandingCanvas: React.FC<LandingCanvasProps> = ({ paused }) => {
    // ── Hooks must come before any early return ───────────────────────────────
    const particles = useMemo(() =>
        Array.from({ length: PARTICLE_COUNT }, (_, i) => {
            const isStar = i >= 14;
            return {
                id: i,
                left:     seededRng(i * 7.31) * 100,
                size:     isStar ? 5 + seededRng(i * 3.71) * 3 : 2 + seededRng(i * 2.13) * 3,
                duration: 14 + seededRng(i * 5.17) * 14,   // 14–28 s
                delay:    -(seededRng(i * 4.33) * 22),      // pre-start in cycle
                isStar,
            };
        }),
    []);

    // ── Early-exit after hooks ────────────────────────────────────────────────
    const prefersReduced = typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const isMobile = typeof window !== 'undefined' &&
        window.innerWidth < MOBILE_BREAKPOINT;

    if (prefersReduced || isMobile) return null;

    return (
        <div
            aria-hidden="true"
            style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 1 }}
        >
            {particles.map(p => (
                <div
                    key={p.id}
                    style={{
                        position: 'absolute',
                        left: `${p.left}%`,
                        bottom: -10,
                        width:  p.size,
                        height: p.size,
                        borderRadius: p.isStar ? '2px' : '50%',
                        background: p.isStar
                            ? 'rgba(240, 248, 255, 0.9)'
                            : 'rgba(210, 225, 255, 1)',
                        transform: p.isStar ? 'rotate(45deg)' : undefined,
                        // Hardcoded keyframe names — no CSS var() in keyframes so the
                        // browser can fully GPU-composite both transform AND opacity
                        animationName: p.isStar ? 'dustFloatBright' : 'dustFloatDim',
                        animationDuration: `${p.duration}s`,
                        animationDelay: `${p.delay}s`,
                        animationTimingFunction: 'linear',
                        animationIterationCount: 'infinite',
                        animationPlayState: paused ? 'paused' : 'running',
                        willChange: 'transform, opacity',
                    } as React.CSSProperties}
                />
            ))}
        </div>
    );
};

export default LandingCanvas;
