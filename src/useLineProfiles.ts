import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { ScanRecord } from "./types";
import type { LineSegment } from "./lineprofile";
import { buildTraces, drawSegments } from "./lineprofile";

let segCounter = 0;
const segUid = () => `seg-${++segCounter}`;

// Shared line-profile interaction for both the grid card and the expanded view.
// Selection is owned by the caller (lifted to App) so Delete only ever affects
// one card; everything else (drawing, dragging, the overlay, hover cursor) is
// encapsulated here.
export function useLineProfiles(opts: {
  record: ScanRecord;
  onSegmentsChange: (segs: LineSegment[]) => void;
  dataCanvasRef: RefObject<HTMLCanvasElement | null>;
  lineCanvasRef: RefObject<HTMLCanvasElement | null>;
  selectedSegId: string | null;
  onSelectSeg: (id: string | null) => void;
  showPsd: boolean;
  // Hold the plot back until the first segment is released (expanded view only,
  // where the right column resizes the scan).
  enableSuppress: boolean;
}) {
  const { record, onSegmentsChange, dataCanvasRef, lineCanvasRef, selectedSegId, onSelectSeg, showPsd, enableSuppress } = opts;

  const segments = record.segments;
  const hasSegments = segments.length > 0;
  const traces = useMemo(() => buildTraces(record), [record]);

  const [suppressPlot, setSuppressPlot] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [hoverMode, setHoverMode] = useState<"endpoint" | "body" | null>(null);

  // Latest values for window-drag closures (avoid stale captures).
  const segmentsRef = useRef(segments);
  useEffect(() => { segmentsRef.current = segments; }, [segments]);
  const onSegmentsChangeRef = useRef(onSegmentsChange);
  onSegmentsChangeRef.current = onSegmentsChange;
  const onSelectRef = useRef(onSelectSeg);
  onSelectRef.current = onSelectSeg;

  // Draw the segment overlay (segments + arrowheads) on its own canvas.
  useEffect(() => {
    const data = dataCanvasRef.current;
    const lc = lineCanvasRef.current;
    if (!data || !lc) return;
    function draw() {
      if (!data || !lc) return;
      const dpr = window.devicePixelRatio || 1;
      const w = data.clientWidth, h = data.clientHeight;
      if (!w || !h) return;
      lc.width = Math.round(w * dpr);
      lc.height = Math.round(h * dpr);
      const ctx = lc.getContext("2d")!;
      ctx.clearRect(0, 0, lc.width, lc.height);
      ctx.save();
      ctx.scale(dpr, dpr);
      drawSegments(ctx, w, h, segments, selectedSegId);
      ctx.restore();
    }
    const obs = new ResizeObserver(draw);
    obs.observe(data);
    draw();
    return () => obs.disconnect();
  }, [segments, selectedSegId, dataCanvasRef, lineCanvasRef]);

  // Distance from point (px,py) to segment a→b, all in client px.
  function distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  function hoverModeAt(cx: number, cy: number): "endpoint" | "body" | null {
    const canvas = dataCanvasRef.current;
    if (!canvas) return null;
    const r = canvas.getBoundingClientRect();
    const segs = segmentsRef.current;
    for (let i = segs.length - 1; i >= 0; i--) {
      const s = segs[i];
      if (Math.hypot(cx - (r.left + s.x0 * r.width), cy - (r.top + s.y0 * r.height)) <= 11) return "endpoint";
      if (Math.hypot(cx - (r.left + s.x1 * r.width), cy - (r.top + s.y1 * r.height)) <= 11) return "endpoint";
    }
    for (let i = segs.length - 1; i >= 0; i--) {
      const s = segs[i];
      if (distToSeg(cx, cy, r.left + s.x0 * r.width, r.top + s.y0 * r.height, r.left + s.x1 * r.width, r.top + s.y1 * r.height) <= 6) return "body";
    }
    return null;
  }

  function onCanvasMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return;
    const canvas = dataCanvasRef.current;
    if (!canvas) return;
    const r = canvas.getBoundingClientRect();
    const cx = e.clientX, cy = e.clientY;
    const segs = segmentsRef.current;
    const HIT = 11; // endpoint grab radius (px)

    type Drag =
      | { kind: "end"; id: string; end: 0 | 1; isNew: boolean }
      | { kind: "whole"; id: string; ox0: number; oy0: number; ox1: number; oy1: number; gfx: number; gfy: number };
    let drag: Drag | null = null;

    // 1) endpoint grab (topmost first)
    for (let i = segs.length - 1; i >= 0 && !drag; i--) {
      const s = segs[i];
      const ends: Array<[number, number, 0 | 1]> = [
        [r.left + s.x0 * r.width, r.top + s.y0 * r.height, 0],
        [r.left + s.x1 * r.width, r.top + s.y1 * r.height, 1],
      ];
      for (const [ex, ey, end] of ends) {
        if (Math.hypot(cx - ex, cy - ey) <= HIT) { drag = { kind: "end", id: s.id, end, isNew: false }; break; }
      }
    }

    // 2) body grab → translate the whole segment (keep length + orientation)
    if (!drag) {
      for (let i = segs.length - 1; i >= 0 && !drag; i--) {
        const s = segs[i];
        const d = distToSeg(cx, cy, r.left + s.x0 * r.width, r.top + s.y0 * r.height, r.left + s.x1 * r.width, r.top + s.y1 * r.height);
        if (d <= 6) {
          drag = { kind: "whole", id: s.id, ox0: s.x0, oy0: s.y0, ox1: s.x1, oy1: s.y1, gfx: (cx - r.left) / r.width, gfy: (cy - r.top) / r.height };
        }
      }
    }

    // 3) otherwise start a brand-new segment, dragging its head
    if (!drag) {
      const nx = Math.max(0, Math.min(1, (cx - r.left) / r.width));
      const ny = Math.max(0, Math.min(1, (cy - r.top) / r.height));
      const id = segUid();
      const next = [...segs, { id, x0: nx, y0: ny, x1: nx, y1: ny }];
      if (enableSuppress && segs.length === 0 && !showPsd) setSuppressPlot(true);
      segmentsRef.current = next;
      onSegmentsChangeRef.current(next);
      drag = { kind: "end", id, end: 1, isNew: true };
    }

    onSelectRef.current(drag.id);
    setDragging(true);
    e.preventDefault();

    const move = (ev: MouseEvent) => {
      const d = drag!;
      let next;
      if (d.kind === "whole") {
        const rawDx = (ev.clientX - r.left) / r.width - d.gfx;
        const rawDy = (ev.clientY - r.top) / r.height - d.gfy;
        const dx = Math.max(-Math.min(d.ox0, d.ox1), Math.min(1 - Math.max(d.ox0, d.ox1), rawDx));
        const dy = Math.max(-Math.min(d.oy0, d.oy1), Math.min(1 - Math.max(d.oy0, d.oy1), rawDy));
        next = segmentsRef.current.map((s) =>
          s.id !== d.id ? s : { ...s, x0: d.ox0 + dx, y0: d.oy0 + dy, x1: d.ox1 + dx, y1: d.oy1 + dy }
        );
      } else {
        const nx = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
        const ny = Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height));
        next = segmentsRef.current.map((s) =>
          s.id !== d.id ? s : d.end ? { ...s, x1: nx, y1: ny } : { ...s, x0: nx, y0: ny }
        );
      }
      segmentsRef.current = next;
      onSegmentsChangeRef.current(next);
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      setDragging(false);
      setSuppressPlot(false);
      const d = drag!;
      // Discard a "new" segment that's really just a click (too short).
      if (d.kind === "end" && d.isNew) {
        const seg = segmentsRef.current.find((s) => s.id === d.id);
        if (seg && Math.hypot((seg.x1 - seg.x0) * r.width, (seg.y1 - seg.y0) * r.height) < 5) {
          const next = segmentsRef.current.filter((s) => s.id !== d.id);
          segmentsRef.current = next;
          onSegmentsChangeRef.current(next);
          onSelectRef.current(null);
        }
      }
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  const cursor = dragging ? "grabbing" : hoverMode === "endpoint" ? "grab" : hoverMode === "body" ? "move" : "crosshair";

  return {
    traces,
    hasSegments,
    showTracePlot: hasSegments && !suppressPlot,
    dragging,
    cursor,
    onCanvasMouseDown,
    onHoverMove: (cx: number, cy: number) => setHoverMode(hoverModeAt(cx, cy)),
    onHoverLeave: () => setHoverMode(null),
    clearTraces: () => { onSegmentsChange([]); onSelectSeg(null); },
  };
}
