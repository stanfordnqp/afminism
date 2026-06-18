import { useEffect, useRef } from "react";
import { drawClimStrip } from "./colormap";
import type { ColormapName } from "./colormap";

const MIN_GAP = 0.04; // smallest allowed window width (fraction)

type Mode = "low" | "high" | "band";

// Draggable color-scale window: drag the middle band to shift the center, drag
// the end handles to set the low/high limits. Values outside clamp to the end
// colors (previewed in the strip). Double-click resets to the full range.
export default function ClimControl({
  colormap, low, high, onChange,
}: {
  colormap: ColormapName;
  low: number;
  high: number;
  onChange: (low: number, high: number) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ mode: Mode; startX: number; startLow: number; startHigh: number } | null>(null);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    function draw() {
      if (!c) return;
      const w = c.clientWidth, h = c.clientHeight;
      if (!w || !h) return;
      const dpr = window.devicePixelRatio || 1;
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      drawClimStrip(c.getContext("2d")!, c.width, c.height, colormap, low, high);
    }
    const obs = new ResizeObserver(draw);
    obs.observe(c);
    draw();
    return () => obs.disconnect();
  }, [colormap, low, high]);

  function fracOf(clientX: number) {
    const r = wrapRef.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  }

  function update(f: number) {
    const d = drag.current;
    if (!d) return;
    if (d.mode === "low") {
      onChange(Math.max(0, Math.min(f, d.startHigh - MIN_GAP)), d.startHigh);
    } else if (d.mode === "high") {
      onChange(d.startLow, Math.min(1, Math.max(f, d.startLow + MIN_GAP)));
    } else {
      const width = d.startHigh - d.startLow;
      let lo = d.startLow + (f - d.startX);
      lo = Math.max(0, Math.min(lo, 1 - width));
      onChange(lo, lo + width);
    }
  }

  function onPointerDown(e: React.PointerEvent) {
    const r = wrapRef.current!.getBoundingClientRect();
    const f = fracOf(e.clientX);
    const tol = 9 / r.width;
    let mode: Mode;
    if (Math.abs(f - low) <= tol) mode = "low";
    else if (Math.abs(f - high) <= tol) mode = "high";
    else if (f > low && f < high) mode = "band";
    else mode = Math.abs(f - low) < Math.abs(f - high) ? "low" : "high";
    drag.current = { mode, startX: f, startLow: low, startHigh: high };
    wrapRef.current!.setPointerCapture(e.pointerId);
    if (mode !== "band") update(f); // jump the grabbed handle to the cursor
    e.preventDefault();
  }

  function onPointerMove(e: React.PointerEvent) {
    if (drag.current) update(fracOf(e.clientX));
  }

  function endDrag(e: React.PointerEvent) {
    drag.current = null;
    if (wrapRef.current!.hasPointerCapture(e.pointerId)) wrapRef.current!.releasePointerCapture(e.pointerId);
  }

  const cursor = drag.current?.mode === "band" ? "grabbing" : "ew-resize";

  return (
    <div
      ref={wrapRef}
      className="clim-bar"
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => onChange(0, 1)}
      title="Drag the band to shift, the edges to set contrast. Double-click to reset."
    >
      <canvas ref={canvasRef} className="clim-bar-canvas" />
      <div className="clim-handle" style={{ left: `${low * 100}%` }} />
      <div className="clim-handle" style={{ left: `${high * 100}%` }} />
    </div>
  );
}
