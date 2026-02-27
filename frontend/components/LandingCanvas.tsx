import React, { useEffect, useRef } from 'react';

interface Particle {
    x: number;
    y: number;
    size: number;
    opacity: number;
    speedY: number;
    drift: number;
    phase: number; // for opacity oscillation
}

interface LandingCanvasProps {
    paused: boolean;
}

const MAX_PARTICLES = 7;
const MOBILE_BREAKPOINT = 768;

function createParticle(width: number, height: number): Particle {
    return {
        x: Math.random() * width,
        y: Math.random() * height,
        size: 2 + Math.random() * 3,
        opacity: 0,
        speedY: 0.04 + Math.random() * 0.07, // very slow — ~20s to cross screen
        drift: (Math.random() - 0.5) * 0.15,
        phase: Math.random() * Math.PI * 2,
    };
}

const LandingCanvas: React.FC<LandingCanvasProps> = ({ paused }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const pausedRef = useRef(paused);
    const rafRef = useRef<number | null>(null);
    const particlesRef = useRef<Particle[]>([]);

    // Keep pausedRef in sync without restarting the loop
    useEffect(() => {
        pausedRef.current = paused;
    }, [paused]);

    useEffect(() => {
        const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const isMobile = window.innerWidth < MOBILE_BREAKPOINT;
        if (prefersReduced || isMobile) return; // skip for a11y or mobile

        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const resize = () => {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        };
        resize();
        window.addEventListener('resize', resize);

        // Seed particles
        particlesRef.current = Array.from({ length: MAX_PARTICLES }, () =>
            createParticle(canvas.width, canvas.height)
        );

        let t = 0;

        const draw = () => {
            rafRef.current = requestAnimationFrame(draw);
            if (!canvas || !ctx) return;

            ctx.clearRect(0, 0, canvas.width, canvas.height);

            if (pausedRef.current) return;

            t += 0.008;

            for (const p of particlesRef.current) {
                // Oscillate opacity slowly — very faint (max ~0.04)
                p.opacity = 0.02 + 0.02 * Math.sin(t + p.phase);

                // Move upward with slight drift
                p.y -= p.speedY;
                p.x += p.drift;

                // Wrap around
                if (p.y < -10) {
                    p.y = canvas.height + 10;
                    p.x = Math.random() * canvas.width;
                }
                if (p.x < 0) p.x = canvas.width;
                if (p.x > canvas.width) p.x = 0;

                // Draw a soft golden sparkle dot
                const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 2);
                gradient.addColorStop(0, `rgba(212, 158, 40, ${p.opacity})`);
                gradient.addColorStop(0.5, `rgba(212, 158, 40, ${p.opacity * 0.5})`);
                gradient.addColorStop(1, `rgba(212, 158, 40, 0)`);

                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size * 2, 0, Math.PI * 2);
                ctx.fillStyle = gradient;
                ctx.fill();
            }
        };

        draw();

        return () => {
            window.removeEventListener('resize', resize);
            if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
        };
    }, []);

    return (
        <canvas
            ref={canvasRef}
            style={{
                position: 'absolute',
                inset: 0,
                pointerEvents: 'none',
                zIndex: 1,
            }}
            aria-hidden="true"
        />
    );
};

export default LandingCanvas;
