// Port of afm_gui.py processing functions to TypeScript.
// All arrays are flat Float32Array, row-major, side×side.

import type { ProcessingOptions } from "./types";

// ── median of a sorted or unsorted Float32Array slice ─────────────────────────

function median(arr: Float32Array): number {
  const sorted = arr.slice().sort();
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ── 3-parameter least squares: z ≈ ax + by + c ────────────────────────────────
// Solves the 3×3 normal equations directly (no library needed).

function solve3(A: number[][], b: number[]): [number, number, number] {
  // Cramer's rule on 3×3
  const det = (m: number[][]) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const d = det(A);
  if (Math.abs(d) < 1e-30) return [0, 0, 0];
  const sub = (col: number) =>
    A.map((row, i) => row.map((v, j) => (j === col ? b[i] : v)));
  return [det(sub(0)) / d, det(sub(1)) / d, det(sub(2)) / d];
}

export function fitPlane(
  z: Float32Array,
  side: number,
  sigmaClip = 6.0,
  iterations = 2
): Float32Array {
  const n = side * side;
  // x and y coordinates normalised to [0,1]
  const xs = new Float32Array(n);
  const ys = new Float32Array(n);
  for (let row = 0; row < side; row++) {
    for (let col = 0; col < side; col++) {
      xs[row * side + col] = col / (side - 1);
      ys[row * side + col] = row / (side - 1);
    }
  }

  let mask = new Uint8Array(n).fill(1);
  let a = 0, b = 0, c = 0;

  for (let iter = 0; iter <= iterations; iter++) {
    // Build normal equations AtA x = Atb (3×3 system)
    let sx2 = 0, sxy = 0, sx = 0, sy2 = 0, sy = 0, s1 = 0;
    let sxz = 0, syz = 0, sz = 0;
    for (let i = 0; i < n; i++) {
      if (!mask[i]) continue;
      const x = xs[i], y = ys[i], zv = z[i];
      sx2 += x * x; sxy += x * y; sx += x;
      sy2 += y * y; sy += y; s1 += 1;
      sxz += x * zv; syz += y * zv; sz += zv;
    }
    const AtA = [
      [sx2, sxy, sx],
      [sxy, sy2, sy],
      [sx,  sy,  s1],
    ];
    const Atb = [sxz, syz, sz];
    [a, b, c] = solve3(AtA, Atb);

    // Compute residuals and sigma-clip
    let sumSq = 0, cnt = 0;
    const res = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      res[i] = z[i] - (a * xs[i] + b * ys[i] + c);
      if (mask[i]) { sumSq += res[i] * res[i]; cnt++; }
    }
    if (cnt < 2) break;
    const std = Math.sqrt(sumSq / cnt);
    if (std === 0) break;
    const threshold = sigmaClip * std;
    mask = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      mask[i] = Math.abs(res[i]) < threshold ? 1 : 0;
    }
  }

  const plane = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    plane[i] = a * xs[i] + b * ys[i] + c;
  }
  return plane;
}

export function horizontalLineLevel(
  z: Float32Array,
  side: number
): Float32Array {
  const out = new Float32Array(z);
  const row = new Float32Array(side);
  for (let r = 0; r < side; r++) {
    const offset = r * side;
    row.set(z.subarray(offset, offset + side));
    const m = median(row);
    for (let c = 0; c < side; c++) out[offset + c] -= m;
  }
  return out;
}

export function computeRms(
  z: Float32Array,
  sigmaClip = 5.0
): { rms: number; rmsClipped: number; ptp: number } {
  let sum = 0, sum2 = 0, min = Infinity, max = -Infinity;
  for (let i = 0; i < z.length; i++) {
    sum += z[i]; sum2 += z[i] * z[i];
    if (z[i] < min) min = z[i];
    if (z[i] > max) max = z[i];
  }
  const mean = sum / z.length;
  const rms = Math.sqrt(sum2 / z.length - mean * mean);
  const ptp = max - min;

  const threshold = sigmaClip * rms;
  let sum2c = 0, meanc = 0, cnt = 0;
  for (let i = 0; i < z.length; i++) {
    if (Math.abs(z[i]) < threshold) { meanc += z[i]; cnt++; }
  }
  if (cnt < 2) return { rms, rmsClipped: rms, ptp };
  meanc /= cnt;
  for (let i = 0; i < z.length; i++) {
    if (Math.abs(z[i]) < threshold) sum2c += (z[i] - meanc) ** 2;
  }
  return { rms, rmsClipped: Math.sqrt(sum2c / cnt), ptp };
}

// Rotate flat side×side array 90° clockwise k times
function rot90cw(z: Float32Array, side: number, k: number): Float32Array {
  let cur = z;
  for (let t = 0; t < k; t++) {
    const next = new Float32Array(side * side);
    for (let r = 0; r < side; r++) {
      for (let c = 0; c < side; c++) {
        // 90° CW: new[c][side-1-r] = old[r][c]
        next[c * side + (side - 1 - r)] = cur[r * side + c];
      }
    }
    cur = next;
  }
  return cur;
}

export function reprocess(
  zRaw: Float32Array,
  side: number,
  opts: Pick<ProcessingOptions, "doPlane" | "planeSigma" | "doLines">,
  rotation: number
): Float32Array {
  let z = zRaw.slice();
  const k = ((rotation / 90) % 4 + 4) % 4;
  if (k) z = rot90cw(z, side, k);
  if (opts.doPlane) {
    const plane = fitPlane(z, side, opts.planeSigma);
    for (let i = 0; i < z.length; i++) z[i] -= plane[i];
  }
  if (opts.doLines) z = horizontalLineLevel(z, side);
  for (let i = 0; i < z.length; i++) z[i] = -z[i]; // sign flip matches Python
  return z;
}
