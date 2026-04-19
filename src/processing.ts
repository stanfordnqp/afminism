// Port of afm_gui.py processing functions to TypeScript.
// All arrays are flat Float32Array, row-major, side×side.

import type { ProcessingOptions } from "./types";

function median(arr: Float32Array): number {
  const sorted = arr.slice().sort();
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Gauss-Jordan elimination with partial pivoting — solves Ax = b in-place.
function solveLinear(A: number[][], b: number[]): number[] {
  const n = A.length;
  const aug = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) maxRow = row;
    }
    [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];
    if (Math.abs(aug[col][col]) < 1e-30) continue;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const f = aug[row][col] / aug[col][col];
      for (let k = col; k <= n; k++) aug[row][k] -= f * aug[col][k];
    }
  }
  return aug.map((row, i) => Math.abs(aug[i][i]) < 1e-30 ? 0 : row[n] / aug[i][i]);
}

// Basis vectors for polynomial orders:
//   0 → [1]
//   1 → [x, y, 1]
//   2 → [x², xy, y², x, y, 1]
function polyBasis(x: number, y: number, order: number): number[] {
  if (order === 0) return [1];
  if (order === 1) return [x, y, 1];
  return [x * x, x * y, y * y, x, y, 1];
}

export function fitPoly(
  z: Float32Array,
  side: number,
  order: number,
  sigmaClip = 6.0,
  iterations = 2
): Float32Array {
  const n = side * side;
  const norm = Math.max(1, side - 1);
  const xs = new Float32Array(n);
  const ys = new Float32Array(n);
  for (let row = 0; row < side; row++) {
    for (let col = 0; col < side; col++) {
      xs[row * side + col] = col / norm;
      ys[row * side + col] = row / norm;
    }
  }

  const p = order === 0 ? 1 : order === 1 ? 3 : 6;
  let mask = new Uint8Array(n).fill(1);
  let coeffs = new Array(p).fill(0);

  for (let iter = 0; iter <= iterations; iter++) {
    const AtA = Array.from({ length: p }, () => new Array(p).fill(0));
    const Atb = new Array(p).fill(0);
    for (let i = 0; i < n; i++) {
      if (!mask[i]) continue;
      const bv = polyBasis(xs[i], ys[i], order);
      const zv = z[i];
      for (let j = 0; j < p; j++) {
        Atb[j] += bv[j] * zv;
        for (let k = 0; k < p; k++) AtA[j][k] += bv[j] * bv[k];
      }
    }
    coeffs = solveLinear(AtA, Atb);

    // Compute residuals and update sigma-clip mask
    let sumSq = 0, cnt = 0;
    const res = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const bv = polyBasis(xs[i], ys[i], order);
      let fit = 0;
      for (let j = 0; j < p; j++) fit += coeffs[j] * bv[j];
      res[i] = z[i] - fit;
      if (mask[i]) { sumSq += res[i] * res[i]; cnt++; }
    }
    if (cnt < 2) break;
    const std = Math.sqrt(sumSq / cnt);
    if (std === 0) break;
    const threshold = sigmaClip * std;
    mask = new Uint8Array(n);
    for (let i = 0; i < n; i++) mask[i] = Math.abs(res[i]) < threshold ? 1 : 0;
  }

  const surface = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const bv = polyBasis(xs[i], ys[i], order);
    let fit = 0;
    for (let j = 0; j < p; j++) fit += coeffs[j] * bv[j];
    surface[i] = fit;
  }
  return surface;
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

function rot90cw(z: Float32Array, side: number, k: number): Float32Array {
  let cur = z;
  for (let t = 0; t < k; t++) {
    const next = new Float32Array(side * side);
    for (let r = 0; r < side; r++) {
      for (let c = 0; c < side; c++) {
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
  opts: Pick<ProcessingOptions, "doPoly" | "polySigma" | "polyOrder" | "doLines">,
  rotation: number
): Float32Array {
  let z: Float32Array = new Float32Array(zRaw);
  const k = ((rotation / 90) % 4 + 4) % 4;
  if (k) z = rot90cw(z, side, k);
  if (opts.doPoly) {
    const surface = fitPoly(z, side, opts.polyOrder, opts.polySigma);
    for (let i = 0; i < z.length; i++) z[i] -= surface[i];
  }
  if (opts.doLines) z = horizontalLineLevel(z, side);
  return z;
}
