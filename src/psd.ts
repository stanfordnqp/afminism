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

// 2D FFT: row-wise then column-wise on N×N data stored in row-major flat arrays.
function fft2d(re: Float64Array, im: Float64Array, N: number): void {
  const rowRe = new Float64Array(N);
  const rowIm = new Float64Array(N);
  // Rows
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) { rowRe[j] = re[i * N + j]; rowIm[j] = im[i * N + j]; }
    fft1d(rowRe, rowIm);
    for (let j = 0; j < N; j++) { re[i * N + j] = rowRe[j]; im[i * N + j] = rowIm[j]; }
  }
  // Columns
  const colRe = new Float64Array(N);
  const colIm = new Float64Array(N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) { colRe[i] = re[i * N + j]; colIm[i] = im[i * N + j]; }
    fft1d(colRe, colIm);
    for (let i = 0; i < N; i++) { re[i * N + j] = colRe[i]; im[i * N + j] = colIm[i]; }
  }
}

export function computePSD(
  z: Float32Array,
  side: number,
  scanUm: [number, number]
): { freqs: Float32Array; power: Float32Array } {
  const N = side;
  const N2 = N * N;

  // Mean subtract
  let mean = 0;
  for (let i = 0; i < N2; i++) mean += z[i];
  mean /= N2;

  // 2D Hann window (separable)
  const hann = new Float64Array(N);
  for (let k = 0; k < N; k++) hann[k] = 0.5 * (1 - Math.cos((2 * Math.PI * k) / (N - 1)));

  // Apply window and compute RMS before/after for energy preservation
  const re = new Float64Array(N2);
  const im = new Float64Array(N2);
  let rmsBefore = 0, rmsAfter = 0;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const v = z[i * N + j] - mean;
      rmsBefore += v * v;
      const w = hann[i] * hann[j];
      re[i * N + j] = v * w;
      rmsAfter += (v * w) * (v * w);
    }
  }
  rmsBefore = Math.sqrt(rmsBefore / N2);
  rmsAfter = Math.sqrt(rmsAfter / N2);
  if (rmsAfter > 0 && rmsBefore > 0) {
    const scale = rmsBefore / rmsAfter;
    for (let i = 0; i < N2; i++) re[i] *= scale;
  }

  fft2d(re, im, N);

  // Normalized power (fftshifted on-the-fly: bin (i,j) → (i+N/2)%N, (j+N/2)%N)
  const half = N / 2;
  const nBins = half; // radial bins 1..N/2
  const binSum = new Float64Array(nBins + 1);
  const binCount = new Int32Array(nBins + 1);

  // Physical frequency ratio: dy/dx handles non-square pixels
  const dx = scanUm[0] / N;
  const dy = scanUm[1] / N;
  const ratio = dy / dx; // scale ky axis to match kx units

  for (let i = 0; i < N; i++) {
    const fi = ((i + half) % N) - half; // centered freq index
    for (let j = 0; j < N; j++) {
      const fj = ((j + half) % N) - half;
      const r = Math.sqrt(fi * fi * ratio * ratio + fj * fj);
      const ri = Math.round(r);
      if (ri < 1 || ri > nBins) continue;
      const p = (re[i * N + j] * re[i * N + j] + im[i * N + j] * im[i * N + j]) / N2;
      binSum[ri] += p;
      binCount[ri]++;
    }
  }

  // Build output arrays (skip DC at r=0)
  const freqs = new Float32Array(nBins);
  const power = new Float32Array(nBins);
  for (let r = 1; r <= nBins; r++) {
    freqs[r - 1] = r / scanUm[0]; // 1/µm
    power[r - 1] = binCount[r] > 0 ? binSum[r] / binCount[r] : 0;
  }

  return { freqs, power };
}
