import { useEffect, useRef } from "react";

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  life: number; decay: number;
  size: number; color: string;
  rotation: number; rotationSpeed: number;
  shape: 0 | 1 | 2; // 0=star, 1=diamond, 2=circle
}

interface Unicorn {
  x: number; y: number;
  vy: number;
  life: number;
  size: number;
}

const COLORS = [
  "#FFD700", "#FF69B4", "#FF1493", "#00CFFF", "#7CFC00", "#FF6347",
  "#C084FC", "#F9A8D4", "#67E8F9", "#86EFAC", "#FDBA74",
  "#FDE68A", "#E0E0FF", "#ffffff", "#FFAAFF", "#AAFFFF",
];

function spawnBurst(particles: Particle[], x: number, y: number, count: number, burst = false) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = burst ? Math.random() * 11 + 3 : Math.random() * 4 + 1;
    const shapeRoll = Math.random();
    const shape = (shapeRoll < 0.6 ? 0 : shapeRoll < 0.8 ? 1 : 2) as 0 | 1 | 2;
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - (burst ? 4 : 2),
      life: 1,
      decay: burst ? Math.random() * 0.010 + 0.005 : Math.random() * 0.018 + 0.010,
      size: burst ? Math.random() * 10 + 4 : Math.random() * 6 + 2,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 0.35,
      shape,
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
  ctx.shadowBlur = p.size * 2.5;
  ctx.shadowColor = p.color;
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
  const unicornsRef = useRef<Unicorn[]>([]);
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

      // Particles
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

      // Unicorns — float upward and fade
      unicornsRef.current = unicornsRef.current.filter(u => u.life > 0);
      for (const u of unicornsRef.current) {
        u.y += u.vy;
        u.life -= 0.007;
        ctx.save();
        ctx.globalAlpha = Math.max(0, u.life);
        ctx.font = `${u.size}px serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.shadowBlur = 12;
        ctx.shadowColor = "#f9a8d4";
        ctx.fillText("🦄", u.x, u.y);
        ctx.restore();
      }

      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, []);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!enabledRef.current) return;
      spawnBurst(particlesRef.current, e.clientX, e.clientY, 55, true);
      // ~15% chance of a unicorn
      if (Math.random() < 0.15) {
        unicornsRef.current.push({
          x: e.clientX + (Math.random() - 0.5) * 40,
          y: e.clientY,
          vy: -(Math.random() * 1.5 + 1.2),
          life: 1,
          size: Math.round(Math.random() * 20 + 28),
        });
      }
    }
    function onMouseUp(e: MouseEvent) {
      if (!enabledRef.current) return;
      spawnBurst(particlesRef.current, e.clientX, e.clientY, 30, true);
    }
    window.addEventListener("click", onClick);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("click", onClick);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  return <canvas ref={canvasRef} style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 9999 }} />;
}
