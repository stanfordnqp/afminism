// Port of afm_gui.py processing functions to TypeScript.
// All arrays are flat Float32Array, row-major, width×height (cols×rows).

import type { ProcessingOptions } from "./types";

// Display dimensions of the processed (rotated) grid. A 90°/270° rotation
// swaps columns and rows; flipX preserves dimensions.
export function currentDims(rawW: number, rawH: number, rotation: number): [number, number] {
  const k = ((rotation / 90) % 4 + 4) % 4;
  return k % 2 === 1 ? [rawH, rawW] : [rawW, rawH];
}

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

// All monomials x^i * y^j with i+j <= order, highest degree first.
// Number of terms = (order+1)(order+2)/2.
function polyBasis(x: number, y: number, order: number): number[] {
  const terms: number[] = [];
  for (let deg = order; deg >= 0; deg--) {
    for (let i = deg; i >= 0; i--) {
      terms.push(Math.pow(x, i) * Math.pow(y, deg - i));
    }
  }
  return terms;
}

export function fitPoly(
  z: Float32Array,
  width: number,
  height: number,
  order: number,
  sigmaClip = 6.0,
  iterations = 2
): Float32Array {
  const n = width * height;
  const normX = Math.max(1, width - 1);
  const normY = Math.max(1, height - 1);
  const xs = new Float32Array(n);
  const ys = new Float32Array(n);
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      xs[row * width + col] = col / normX;
      ys[row * width + col] = row / normY;
    }
  }

  const p = (order + 1) * (order + 2) / 2;
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
  width: number,
  height: number
): Float32Array {
  const out = new Float32Array(z);
  const row = new Float32Array(width);
  for (let r = 0; r < height; r++) {
    const offset = r * width;
    row.set(z.subarray(offset, offset + width));
    const m = median(row);
    for (let c = 0; c < width; c++) out[offset + c] -= m;
  }
  return out;
}

// Per-row 1D polynomial leveling: fits z = c0·x^order + … + c_order to each
// row independently with iterative sigma clipping, then subtracts the fit.
export function polyLineLevel(
  z: Float32Array,
  width: number,
  height: number,
  order: number,
  sigmaClip = 6.0,
  iterations = 2
): Float32Array {
  const out = new Float32Array(z);
  const norm = Math.max(1, width - 1);
  const p = order + 1;

  const xs = new Float32Array(width);
  for (let c = 0; c < width; c++) xs[c] = c / norm;

  // 1D monomial basis [x^order, …, x, 1] for a single point.
  const basis = (x: number): number[] => {
    const b = new Array(p);
    for (let d = 0; d < p; d++) b[d] = Math.pow(x, order - d);
    return b;
  };

  for (let r = 0; r < height; r++) {
    const offset = r * width;
    let mask = new Uint8Array(width).fill(1);
    let coeffs = new Array(p).fill(0);

    for (let iter = 0; iter <= iterations; iter++) {
      const AtA = Array.from({ length: p }, () => new Array(p).fill(0));
      const Atb = new Array(p).fill(0);
      for (let c = 0; c < width; c++) {
        if (!mask[c]) continue;
        const bv = basis(xs[c]);
        const zv = z[offset + c];
        for (let j = 0; j < p; j++) {
          Atb[j] += bv[j] * zv;
          for (let k = 0; k < p; k++) AtA[j][k] += bv[j] * bv[k];
        }
      }
      coeffs = solveLinear(AtA, Atb);

      // Residuals and sigma-clip mask update
      let sumSq = 0, cnt = 0;
      const res = new Float32Array(width);
      for (let c = 0; c < width; c++) {
        const bv = basis(xs[c]);
        let fit = 0;
        for (let j = 0; j < p; j++) fit += coeffs[j] * bv[j];
        res[c] = z[offset + c] - fit;
        if (mask[c]) { sumSq += res[c] * res[c]; cnt++; }
      }
      if (cnt < 2) break;
      const std = Math.sqrt(sumSq / cnt);
      if (std === 0) break;
      const threshold = sigmaClip * std;
      mask = new Uint8Array(width);
      for (let c = 0; c < width; c++) mask[c] = Math.abs(res[c]) < threshold ? 1 : 0;
    }

    for (let c = 0; c < width; c++) {
      const bv = basis(xs[c]);
      let fit = 0;
      for (let j = 0; j < p; j++) fit += coeffs[j] * bv[j];
      out[offset + c] -= fit;
    }
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

// Rotate k×90° clockwise. Returns rotated array; dimensions swap on odd k
// (use currentDims to get the resulting width/height).
function rot90cw(z: Float32Array, width: number, height: number, k: number): Float32Array {
  let cur = z;
  let cw = width, ch = height;
  for (let t = 0; t < k; t++) {
    const next = new Float32Array(cur.length);
    const nw = ch; // new column count after a 90° CW turn
    for (let r = 0; r < ch; r++) {
      for (let c = 0; c < cw; c++) {
        next[c * nw + (ch - 1 - r)] = cur[r * cw + c];
      }
    }
    cur = next;
    [cw, ch] = [ch, cw];
  }
  return cur;
}

// Mirror left-right (across the vertical axis).
function flipHoriz(z: Float32Array, width: number, height: number): Float32Array {
  const out = new Float32Array(z.length);
  for (let r = 0; r < height; r++) {
    const offset = r * width;
    for (let c = 0; c < width; c++) out[offset + c] = z[offset + (width - 1 - c)];
  }
  return out;
}

export function reprocess(
  zRaw: Float32Array,
  rawWidth: number,
  rawHeight: number,
  opts: Pick<ProcessingOptions, "doPoly" | "polySigma" | "polyOrder" | "doLines" | "lineMethod" | "lineOrder" | "lineSigma">,
  rotation: number,
  flipX: boolean
): Float32Array {
  let z: Float32Array = new Float32Array(zRaw);
  const k = ((rotation / 90) % 4 + 4) % 4;
  if (k) z = rot90cw(z, rawWidth, rawHeight, k);
  const [width, height] = currentDims(rawWidth, rawHeight, rotation);
  if (flipX) z = flipHoriz(z, width, height);
  if (opts.doLines) {
    z = opts.lineMethod === "polynomial"
      ? polyLineLevel(z, width, height, opts.lineOrder, opts.lineSigma)
      : horizontalLineLevel(z, width, height);
  }
  if (opts.doPoly) {
    const surface = fitPoly(z, width, height, opts.polyOrder, opts.polySigma);
    for (let i = 0; i < z.length; i++) z[i] -= surface[i];
  }
  return z;
}
