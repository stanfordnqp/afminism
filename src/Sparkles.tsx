import { useEffect, useRef } from "react";

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  life: number; decay: number;
  size: number; color: string;
  rotation: number; rotationSpeed: number;
  shape: 0 | 1 | 2; // 0=star, 1=diamond, 2=circle
}

const COLORS = [
  "#FFD700", "#FF69B4", "#00CFFF", "#7CFC00", "#FF6347",
  "#C084FC", "#F9A8D4", "#67E8F9", "#86EFAC", "#FDBA74",
  "#FDE68A", "#E0E0FF", "#ffffff",
];

function spawnBurst(particles: Particle[], x: number, y: number, count: number, burst = false) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = burst ? Math.random() * 7 + 2 : Math.random() * 3 + 0.5;
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - (burst ? 3 : 1.5),
      life: 1,
      decay: burst ? Math.random() * 0.012 + 0.006 : Math.random() * 0.02 + 0.012,
      size: burst ? Math.random() * 8 + 3 : Math.random() * 5 + 2,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 0.25,
      shape: Math.floor(Math.random() * 3) as 0 | 1 | 2,
    });
  }
}

function drawStar(ctx: CanvasRenderingContext2D, r: number) {
  const inner = r * 0.4;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI) / 5 - Math.PI / 2;
    const rad = i % 2 === 0 ? r : inner;
    i === 0 ? ctx.moveTo(rad * Math.cos(a), rad * Math.sin(a))
             : ctx.lineTo(rad * Math.cos(a), rad * Math.sin(a));
  }
  ctx.closePath();
  ctx.fill();
}

function drawParticle(ctx: CanvasRenderingContext2D, p: Particle) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.rotation);
  ctx.globalAlpha = Math.max(0, p.life);
  ctx.fillStyle = p.color;
  if (p.shape === 0) {
    drawStar(ctx, p.size);
  } else if (p.shape === 1) {
    ctx.beginPath();
    ctx.moveTo(0, -p.size);
    ctx.lineTo(p.size * 0.55, 0);
    ctx.lineTo(0, p.size);
    ctx.lineTo(-p.size * 0.55, 0);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.arc(0, 0, p.size * 0.55, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export default function Sparkles({ enabled }: { enabled: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const enabledRef = useRef(enabled);

  useEffect(() => { enabledRef.current = enabled; }, [enabled]);

  // Animation loop — always running so particles finish after toggle-off
  useEffect(() => {
    const canvas = canvasRef.current!;
    function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
    resize();
    window.addEventListener("resize", resize);

    let raf = 0;
    function tick() {
      const ctx = canvas.getContext("2d")!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particlesRef.current = particlesRef.current.filter(p => p.life > 0);
      for (const p of particlesRef.current) {
        p.vy += 0.18;
        p.vx *= 0.985;
        p.x += p.vx;
        p.y += p.vy;
        p.life -= p.decay;
        p.rotation += p.rotationSpeed;
        drawParticle(ctx, p);
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, []);

  // Input listeners
  useEffect(() => {
    let lastMove = 0;
    function onMove(e: MouseEvent) {
      if (!enabledRef.current) return;
      const now = Date.now();
      if (now - lastMove < 25) return;
      lastMove = now;
      spawnBurst(particlesRef.current, e.clientX, e.clientY, 4);
    }
    function onClick(e: MouseEvent) {
      if (!enabledRef.current) return;
      spawnBurst(particlesRef.current, e.clientX, e.clientY, 35, true);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("click", onClick);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("click", onClick); };
  }, []);

  return <canvas ref={canvasRef} style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 9999 }} />;
}
