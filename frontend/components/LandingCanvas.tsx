import React, { useEffect, useRef } from 'react';

interface Particle {
    x: number;
    y: number;
    size: number;
    opacity: number;
    speedY: number;
    drift: number;
    phase: number;
    tier: 'dust' | 'sparkle';
    rotation: number;
    rotationSpeed: number;
}

interface LandingCanvasProps {
    paused: boolean;
}

const DUST_COUNT = 14;
const SPARKLE_COUNT = 4;
const MOBILE_BREAKPOINT = 768;

function createDust(width: number, height: number): Particle {
    return {
        x: Math.random() * width,
        y: Math.random() * height,
        size: 1.5 + Math.random() * 2.5,
        opacity: 0,
        speedY: 0.035 + Math.random() * 0.065,
        drift: (Math.random() - 0.5) * 0.14,
        phase: Math.random() * Math.PI * 2,
        tier: 'dust',
        rotation: 0,
        rotationSpeed: 0,
    };
}

function createSparkle(width: number, height: number): Particle {
    return {
        x: Math.random() * width,
        y: Math.random() * height,
        size: 3.5 + Math.random() * 3,
        opacity: 0,
        speedY: 0.08 + Math.random() * 0.09,
        drift: (Math.random() - 0.5) * 0.25,
        phase: Math.random() * Math.PI * 2,
        tier: 'sparkle',
        rotation: Math.random() * Math.PI,
        rotationSpeed: (Math.random() - 0.5) * 0.012,
    };
}

function drawStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, outerR: number, rotation: number, opacity: number) {
    const innerR = outerR * 0.35;
    const pts = 4;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rotation);
    ctx.beginPath();
    for (let i = 0; i < pts * 2; i++) {
        const angle = (i * Math.PI) / pts;
        const r = i % 2 === 0 ? outerR : innerR;
        if (i === 0) ctx.moveTo(r * Math.cos(angle), r * Math.sin(angle));
        else ctx.lineTo(r * Math.cos(angle), r * Math.sin(angle));
    }
    ctx.closePath();
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, outerR);
    grad.addColorStop(0, `rgba(255, 255, 255, ${opacity * 1.5})`);
    grad.addColorStop(0.5, `rgba(215, 230, 255, ${opacity * 0.8})`);
    grad.addColorStop(1, `rgba(215, 230, 255, 0)`);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();
}

const LandingCanvas: React.FC<LandingCanvasProps> = ({ paused }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const rafRef = useRef<number | null>(null);
    const particlesRef = useRef<Particle[]>([]);
    const tRef = useRef(0);
    // Stable references shared between setup and paused-watcher effects
    const ctxRef = useRef<CanvasRenderingContext2D | null>(null);

    const startLoop = () => {
        const canvas = canvasRef.current;
        const ctx = ctxRef.current;
        if (!canvas || !ctx) return;

        const draw = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            tRef.current += 0.008;
            const t = tRef.current;

            for (const p of particlesRef.current) {
                const maxOpacity = p.tier === 'sparkle' ? 0.35 : 0.25;
                p.opacity = (maxOpacity * 0.5) + (maxOpacity * 0.5) * Math.sin(t + p.phase);
                p.y -= p.speedY;
                p.x += p.drift;
                if (p.tier === 'sparkle') p.rotation += p.rotationSpeed;
                if (p.y < -12) { p.y = canvas.height + 12; p.x = Math.random() * canvas.width; }
                if (p.x < 0) p.x = canvas.width;
                if (p.x > canvas.width) p.x = 0;

                if (p.tier === 'sparkle') {
                    drawStar(ctx, p.x, p.y, p.size * 2.2, p.rotation, p.opacity);
                } else {
                    const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 2);
                    gradient.addColorStop(0, `rgba(255, 255, 255, ${p.opacity})`);
                    gradient.addColorStop(0.5, `rgba(230, 240, 255, ${p.opacity * 0.5})`);
                    gradient.addColorStop(1, `rgba(230, 240, 255, 0)`);
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, p.size * 2, 0, Math.PI * 2);
                    ctx.fillStyle = gradient;
                    ctx.fill();
                }
            }
            rafRef.current = requestAnimationFrame(draw);
        };

        rafRef.current = requestAnimationFrame(draw);
    };

    const stopLoop = () => {
        if (rafRef.current !== null) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        }
    };

    // One-time setup: create canvas, particles, start loop
    useEffect(() => {
        const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const isMobile = window.innerWidth < MOBILE_BREAKPOINT;
        if (prefersReduced || isMobile) return;

        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctxRef.current = ctx;

        const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
        resize();
        window.addEventListener('resize', resize);

        particlesRef.current = [
            ...Array.from({ length: DUST_COUNT }, () => createDust(canvas.width, canvas.height)),
            ...Array.from({ length: SPARKLE_COUNT }, () => createSparkle(canvas.width, canvas.height)),
        ];

        if (!paused) startLoop();

        return () => {
            window.removeEventListener('resize', resize);
            stopLoop();
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Respond to pause/resume — start or stop the RAF loop
    useEffect(() => {
        if (paused) {
            stopLoop();
            // Clear canvas so stale frame doesn't sit frozen on screen
            const canvas = canvasRef.current;
            const ctx = ctxRef.current;
            if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
        } else {
            if (rafRef.current === null) startLoop();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [paused]);

    return (
        <canvas
            ref={canvasRef}
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1 }}
            aria-hidden="true"
        />
    );
};

export default LandingCanvas;
