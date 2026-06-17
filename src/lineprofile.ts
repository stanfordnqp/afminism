// Line-profile sampling: trace height along a user-drawn segment over a scan.
// Segments are stored in normalized display coords [0,1] so they survive resize;
// (x0,y0) is the arrow tail / x=0 origin of the profile.

import { currentDims } from "./processing";
import type { ScanRecord } from "./types";

export interface LineSegment {
  id: string;
  x0: number; y0: number; // tail (profile origin)
  x1: number; y1: number; // head (arrowhead)
}

export interface LineTrace {
  id: string;
  label: string;
  color: string;
  dist: Float32Array;   // µm from the tail
  height: Float32Array; // nm
}

// Distinct from the PSD palette colors so traces read as their own thing.
export const TRACE_PALETTE = [
  "#2196f3", "#e91e63", "#ff9800", "#4caf50", "#9c27b0", "#00bcd4", "#795548", "#607d8b",
];

// Bilinear sample of a row-major width×height array at fractional pixel-center coords.
function bilinear(z: Float32Array, w: number, h: number, fx: number, fy: number): number {
  fx = Math.max(0, Math.min(w - 1, fx));
  fy = Math.max(0, Math.min(h - 1, fy));
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
  const tx = fx - x0, ty = fy - y0;
  const v00 = z[y0 * w + x0], v10 = z[y0 * w + x1];
  const v01 = z[y1 * w + x0], v11 = z[y1 * w + x1];
  const a = v00 + (v10 - v00) * tx;
  const b = v01 + (v11 - v01) * tx;
  return a + (b - a) * ty;
}

// Sample z along a segment. Distances are physical (µm), using per-axis pixel
// size, so they're correct for diagonal lines and non-square pixel grids.
export function sampleSegment(
  z: Float32Array,
  curW: number,
  curH: number,
  scanUm: [number, number],
  seg: LineSegment
): { dist: Float32Array; height: Float32Array } {
  const pxLen = Math.hypot((seg.x1 - seg.x0) * curW, (seg.y1 - seg.y0) * curH);
  const n = Math.max(2, Math.ceil(pxLen) + 1);
  const lenUm = Math.hypot((seg.x1 - seg.x0) * scanUm[0], (seg.y1 - seg.y0) * scanUm[1]);
  const dist = new Float32Array(n);
  const height = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const nx = seg.x0 + (seg.x1 - seg.x0) * t;
    const ny = seg.y0 + (seg.y1 - seg.y0) * t;
    height[i] = bilinear(z, curW, curH, nx * curW - 0.5, ny * curH - 0.5);
    dist[i] = t * lenUm;
  }
  return { dist, height };
}

// Recompute traces for a record's segments against its current processed data.
export function buildTraces(record: ScanRecord): LineTrace[] {
  const [curW, curH] = currentDims(record.width, record.height, record.rotation);
  return record.segments.map((seg, i) => ({
    id: seg.id,
    label: `${i + 1}`,
    color: TRACE_PALETTE[i % TRACE_PALETTE.length],
    ...sampleSegment(record.z, curW, curH, record.scanUm, seg),
  }));
}

// Draw the line-profile segments (tail dot + arrowhead + number) onto a context
// sized w×h CSS px. selectedId highlights one segment; scale grows markers for
// high-res figure export.
export function drawSegments(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  segments: LineSegment[],
  selectedId: string | null,
  scale = 1,
) {
  segments.forEach((seg, i) => {
    const color = TRACE_PALETTE[i % TRACE_PALETTE.length];
    const x0 = seg.x0 * w, y0 = seg.y0 * h, x1 = seg.x1 * w, y1 = seg.y1 * h;
    const sel = seg.id === selectedId;
    const lw = (sel ? 3.5 : 2) * scale;
    const dot = (sel ? 5 : 4) * scale;
    ctx.lineCap = "round";

    // Selected: a bright glow halo behind the line so it clearly stands out.
    if (sel) {
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.3;
      ctx.lineWidth = lw + 9 * scale;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Dark halo for contrast on any background, then the colored line.
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.lineWidth = lw + 2 * scale;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.strokeStyle = sel ? "#fff" : color;
    ctx.lineWidth = lw;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    if (sel) {
      // Thin colored core over the white so the series color still reads.
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1, lw - 2 * scale);
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    }

    // Arrowhead at the head (x1,y1) — sized to cover the line width.
    const ang = Math.atan2(y1 - y0, x1 - x0);
    const aLen = 15 * scale, aW = Math.PI / 5;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - aLen * Math.cos(ang - aW), y1 - aLen * Math.sin(ang - aW));
    ctx.lineTo(x1 - aLen * Math.cos(ang + aW), y1 - aLen * Math.sin(ang + aW));
    ctx.closePath();
    ctx.fill();

    // Tail dot (profile origin, x=0)
    ctx.fillStyle = color;
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.lineWidth = 1.5 * scale;
    ctx.beginPath(); ctx.arc(x0, y0, dot, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

    // Selected: white draggable handle rings at both endpoints.
    if (sel) {
      ctx.lineWidth = 2 * scale;
      for (const [hx, hy] of [[x0, y0], [x1, y1]] as const) {
        ctx.beginPath(); ctx.arc(hx, hy, dot + 2 * scale, 0, Math.PI * 2);
        ctx.fillStyle = "#fff"; ctx.fill();
        ctx.strokeStyle = color; ctx.stroke();
      }
    }

    // Number label near the tail
    ctx.font = `bold ${11 * scale}px Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const lx = x0 - 10 * scale * Math.cos(ang), ly = y0 - 10 * scale * Math.sin(ang);
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillText(`${i + 1}`, lx + scale, ly + scale);
    ctx.fillStyle = "#fff";
    ctx.fillText(`${i + 1}`, lx, ly);
  });
}
