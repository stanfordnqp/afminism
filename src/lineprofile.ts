// Line-profile sampling: trace height along a user-drawn segment over a scan.
// Segments are stored in normalized display coords [0,1] so they survive resize;
// (x0,y0) is the arrow tail / x=0 origin of the profile.

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
