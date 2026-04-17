import { useEffect, useRef } from "react";

interface Pt { x: number; y: number; t: number; }

const DURATION = 320; // ms the tail lives

export default function RainbowTrail({ enabled }: { enabled: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trailRef = useRef<Pt[]>([]);
  const enabledRef = useRef(enabled);
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);

  // Animation loop — always runs so tail finishes fading after toggle-off
  useEffect(() => {
    const canvas = canvasRef.current!;
    function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
    resize();
    window.addEventListener("resize", resize);

    let raf = 0;
    function tick() {
      const ctx = canvas.getContext("2d")!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const now = Date.now();
      // Drop expired points
      const cutoff = now - DURATION;
      const pts = trailRef.current.filter(p => p.t >= cutoff);
      trailRef.current = pts;

      if (pts.length >= 2) {
        // Draw segments from tail (oldest) to head (newest)
        for (let i = 1; i < pts.length; i++) {
          const frac = i / (pts.length - 1);   // 0=tail, 1=head
          const age = now - pts[i].t;
          const ageFrac = age / DURATION;        // 0=fresh, 1=dead

          // Rainbow: head=red, tail=violet — full ROYGBIV arc
          const hue = (1 - frac) * 270;
          const alpha = (1 - ageFrac) * (0.55 + frac * 0.35);
          const width = 1 + frac * 9;           // tapers thin at tail

          ctx.beginPath();
          ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
          ctx.lineTo(pts[i].x, pts[i].y);
          ctx.strokeStyle = `hsla(${hue}, 100%, 62%, ${alpha})`;
          ctx.lineWidth = width;
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          ctx.stroke();
        }
      }

      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, []);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!enabledRef.current) return;
      trailRef.current.push({ x: e.clientX, y: e.clientY, t: Date.now() });
      // Cap array size to avoid unbounded growth during fast movement
      if (trailRef.current.length > 120) trailRef.current.splice(0, 20);
    }
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  return <canvas ref={canvasRef} style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 9998 }} />;
}
