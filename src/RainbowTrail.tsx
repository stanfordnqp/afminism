import { useEffect, useRef } from "react";

interface Arc {
  x: number;
  y: number;
  vy: number;
  vx: number;
  life: number; // 1 → 0
  radius: number;
}

// Outer → inner bands
const BANDS = ["#FF5555", "#FF9933", "#FFE033", "#55DD55", "#4499FF", "#AA44EE"];
const BAND_W = 2.0;
const BAND_GAP = 1.1;

function drawArc(ctx: CanvasRenderingContext2D, arc: Arc) {
  ctx.save();
  ctx.globalAlpha = arc.life * 0.36;
  ctx.lineWidth = BAND_W;
  ctx.lineCap = "round";
  for (let i = 0; i < BANDS.length; i++) {
    const r = arc.radius - i * (BAND_W + BAND_GAP);
    if (r < 1) break;
    ctx.beginPath();
    // anticlockwise arc from π→0 = top half = arch ∩ shape
    ctx.arc(arc.x, arc.y, r, Math.PI, 0, true);
    ctx.strokeStyle = BANDS[i];
    ctx.stroke();
  }
  ctx.restore();
}

export default function RainbowTrail({ enabled }: { enabled: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const arcsRef = useRef<Arc[]>([]);
  const enabledRef = useRef(enabled);
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);

  // Animation loop
  useEffect(() => {
    const canvas = canvasRef.current!;
    function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
    resize();
    window.addEventListener("resize", resize);

    let raf = 0;
    function tick() {
      const ctx = canvas.getContext("2d")!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      arcsRef.current = arcsRef.current.filter(a => a.life > 0);
      for (const a of arcsRef.current) {
        a.y += a.vy;
        a.x += a.vx;
        a.vy -= 0.012;       // gentle upward acceleration
        a.life -= 0.018;
        drawArc(ctx, a);
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, []);

  // Emit arcs on mouse move
  useEffect(() => {
    let last = 0;
    function onMove(e: MouseEvent) {
      if (!enabledRef.current) return;
      const now = Date.now();
      if (now - last < 45) return;
      last = now;
      arcsRef.current.push({
        x: e.clientX + (Math.random() - 0.5) * 8,
        y: e.clientY + (Math.random() - 0.5) * 4,
        vx: (Math.random() - 0.5) * 0.4,
        vy: -(Math.random() * 0.6 + 0.3),
        life: 0.7 + Math.random() * 0.3,
        radius: 13 + Math.random() * 9,
      });
    }
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  return <canvas ref={canvasRef} style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 9998 }} />;
}
