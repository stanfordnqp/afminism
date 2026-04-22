import { useEffect, useRef } from "react";

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  life: number; decay: number;
  size: number; color: string;
  rotation: number; rotationSpeed: number;
  shape: 0 | 1 | 2;
}

interface Unicorn {
  x: number; y: number;
  vy: number;
  life: number;
  size: number;
  emoji: string;
}

const EMOJIS = ["🦄", "✨", "🌈", "⭐", "🎉", "💫", "🌟", "🎊", "🦋", "🔮"];

const COLORS = [
  "#FFD700", "#FF69B4", "#FF1493", "#00CFFF", "#7CFC00", "#FF6347",
  "#C084FC", "#F9A8D4", "#67E8F9", "#86EFAC", "#FDBA74",
  "#FDE68A", "#E0E0FF", "#ffffff", "#FFAAFF", "#AAFFFF",
];

const MAX_PARTICLES = 600;

function spawnBurst(particles: Particle[], x: number, y: number, count: number, burst = false) {
  const room = MAX_PARTICLES - particles.length;
  if (room <= 0) return;
  const actual = Math.min(count, room);
  for (let i = 0; i < actual; i++) {
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

function spawnDrip(particles: Particle[], x: number, y: number) {
  if (particles.length >= MAX_PARTICLES) return;
  const angle = Math.random() * Math.PI * 2;
  const speed = Math.random() * 1.2 + 0.3;
  const shapeRoll = Math.random();
  const shape = (shapeRoll < 0.65 ? 0 : shapeRoll < 0.85 ? 1 : 2) as 0 | 1 | 2;
  particles.push({
    x: x + (Math.random() - 0.5) * 8,
    y: y + (Math.random() - 0.5) * 8,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed - 0.5,
    life: 0.8 + Math.random() * 0.2,
    decay: Math.random() * 0.022 + 0.014,
    size: Math.random() * 4 + 1.5,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    rotation: Math.random() * Math.PI * 2,
    rotationSpeed: (Math.random() - 0.5) * 0.4,
    shape,
  });
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
  // Cursor drip throttle
  const lastDripRef = useRef<{ x: number; y: number; t: number }>({ x: 0, y: 0, t: 0 });
  // Click burst throttle — prevent lag on rapid clicking
  const lastBurstRef = useRef<number>(0);

  useEffect(() => { enabledRef.current = enabled; }, [enabled]);

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
        ctx.fillText(u.emoji, u.x, u.y);
        ctx.restore();
      }

      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, []);

  // Continuous cursor drip
  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!enabledRef.current) return;
      const now = Date.now();
      const last = lastDripRef.current;
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      // Spawn 1-3 drips every ~20ms or 6px of movement, whichever triggers first
      if (now - last.t < 20 && dist < 6) return;
      lastDripRef.current = { x: e.clientX, y: e.clientY, t: now };
      const count = dist > 20 ? 3 : dist > 8 ? 2 : 1;
      for (let i = 0; i < count; i++) spawnDrip(particlesRef.current, e.clientX, e.clientY);
    }
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  // Click bursts — throttled to prevent lag on rapid clicking
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!enabledRef.current) return;
      const now = Date.now();
      if (now - lastBurstRef.current < 150) return;
      lastBurstRef.current = now;
      spawnBurst(particlesRef.current, e.clientX, e.clientY, 15, true);
      if (Math.random() < 0.4) {
        unicornsRef.current.push({
          x: e.clientX + (Math.random() - 0.5) * 40,
          y: e.clientY,
          vy: -(Math.random() * 1.5 + 1.2),
          life: 1,
          size: Math.round(Math.random() * 20 + 28),
          emoji: EMOJIS[Math.floor(Math.random() * EMOJIS.length)],
        });
      }
    }
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, []);

  return <canvas ref={canvasRef} style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 9999 }} />;
}
