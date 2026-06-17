// In-place radix-2 Cooley-Tukey FFT (bit-reversal + butterfly).
// re/im are length N (must be power of 2).
function fft1d(re: Float64Array, im: Float64Array): void {
  const N = re.length;
  // Bit-reversal permutation
  let j = 0;
  for (let i = 1; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  // Butterfly stages
  for (let len = 2; len <= N; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < N; i += len) {
      let curRe = 1, curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const uRe = re[i + k], uIm = im[i + k];
        const vRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm;
        const vIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe;
        re[i + k] = uRe + vRe; im[i + k] = uIm + vIm;
        re[i + k + len / 2] = uRe - vRe; im[i + k + len / 2] = uIm - vIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

// 2D FFT: row-wise (length W) then column-wise (length H) on W×H data stored
// row-major. Both W and H must be powers of 2.
function fft2d(re: Float64Array, im: Float64Array, W: number, H: number): void {
  const rowRe = new Float64Array(W);
  const rowIm = new Float64Array(W);
  // Rows (the x / column direction, length W)
  for (let i = 0; i < H; i++) {
    for (let j = 0; j < W; j++) { rowRe[j] = re[i * W + j]; rowIm[j] = im[i * W + j]; }
    fft1d(rowRe, rowIm);
    for (let j = 0; j < W; j++) { re[i * W + j] = rowRe[j]; im[i * W + j] = rowIm[j]; }
  }
  // Columns (the y / row direction, length H)
  const colRe = new Float64Array(H);
  const colIm = new Float64Array(H);
  for (let j = 0; j < W; j++) {
    for (let i = 0; i < H; i++) { colRe[i] = re[i * W + j]; colIm[i] = im[i * W + j]; }
    fft1d(colRe, colIm);
    for (let i = 0; i < H; i++) { re[i * W + j] = colRe[i]; im[i * W + j] = colIm[i]; }
  }
}

const isPow2 = (n: number) => n > 0 && (n & (n - 1)) === 0;

export function computePSD(
  z: Float32Array,
  width: number,
  height: number,
  scanUm: [number, number]
): { freqs: Float32Array; power: Float32Array } {
  const W = width;
  const H = height;
  const N2 = W * H;

  // The radix-2 FFT needs power-of-2 dimensions. AFM scans almost always are
  // (256, 512, 16, …); bail gracefully on anything else rather than hang.
  if (!isPow2(W) || !isPow2(H)) return { freqs: new Float32Array(0), power: new Float32Array(0) };

  // Mean subtract
  let mean = 0;
  for (let i = 0; i < N2; i++) mean += z[i];
  mean /= N2;

  // 2D Hann window (separable, per-axis)
  const hannX = new Float64Array(W);
  for (let k = 0; k < W; k++) hannX[k] = 0.5 * (1 - Math.cos((2 * Math.PI * k) / Math.max(1, W - 1)));
  const hannY = new Float64Array(H);
  for (let k = 0; k < H; k++) hannY[k] = 0.5 * (1 - Math.cos((2 * Math.PI * k) / Math.max(1, H - 1)));

  // Apply window and compute RMS before/after for energy preservation
  const re = new Float64Array(N2);
  const im = new Float64Array(N2);
  let rmsBefore = 0, rmsAfter = 0;
  for (let i = 0; i < H; i++) {
    for (let j = 0; j < W; j++) {
      const v = z[i * W + j] - mean;
      rmsBefore += v * v;
      const w = hannY[i] * hannX[j];
      re[i * W + j] = v * w;
      rmsAfter += (v * w) * (v * w);
    }
  }
  rmsBefore = Math.sqrt(rmsBefore / N2);
  rmsAfter = Math.sqrt(rmsAfter / N2);
  if (rmsAfter > 0 && rmsBefore > 0) {
    const scale = rmsBefore / rmsAfter;
    for (let i = 0; i < N2; i++) re[i] *= scale;
  }

  fft2d(re, im, W, H);

  // Normalized power (fftshifted on-the-fly per axis)
  const halfX = W / 2;
  const halfY = H / 2;
  const dx = scanUm[0] / W;
  const dy = scanUm[1] / H;

  // Bin width: coarser physical axis sets the radial resolution.
  // Extend bin range to the LARGER axis Nyquist so we don't truncate the
  // spectrum in the more-finely-sampled direction. Annuli beyond the smaller
  // Nyquist are partial (only a slice contributes), so the radial mean there
  // samples a subset of angles; this is unavoidable for rectangular scans.
  const df = 1 / Math.max(scanUm[0], scanUm[1]);
  const fNyqX = W / (2 * scanUm[0]);
  const fNyqY = H / (2 * scanUm[1]);
  const fNyq = Math.max(fNyqX, fNyqY);
  const nBins = Math.ceil(fNyq / df);
  const binSum = new Float64Array(nBins + 1);
  const binCount = new Int32Array(nBins + 1);

  for (let i = 0; i < H; i++) {
    const fi = ((i + halfY) % H) - halfY; // centered freq index (y)
    for (let j = 0; j < W; j++) {
      const fj = ((j + halfX) % W) - halfX; // centered freq index (x)
      // Physical spatial frequencies (µm⁻¹)
      const fx = fj / scanUm[0];
      const fy = fi / scanUm[1];
      const fr = Math.sqrt(fx * fx + fy * fy);
      const ri = Math.round(fr / df);
      if (ri < 1 || ri > nBins) continue;
      // Correctly normalized 2D PSD: S_2D = (dx·dy / N²) · |F|²
      // Units: µm² · nm² = nm²·µm²
      const p = (dx * dy / N2) * (re[i * W + j] * re[i * W + j] + im[i * W + j] * im[i * W + j]);
      binSum[ri] += p;
      binCount[ri]++;
    }
  }

  // Build output arrays (skip DC at r=0)
  const freqs = new Float32Array(nBins);
  const power = new Float32Array(nBins);
  for (let r = 1; r <= nBins; r++) {
    freqs[r - 1] = r * df; // 1/µm
    power[r - 1] = binCount[r] > 0 ? binSum[r] / binCount[r] : 0;
  }

  return { freqs, power };
}
