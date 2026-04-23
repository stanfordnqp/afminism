import { describe, it, expect } from "vitest";
import { computePSD } from "./psd";

// Variance of a Float32Array (mean-subtracted)
function variance(z: Float32Array): number {
  let mean = 0;
  for (let i = 0; i < z.length; i++) mean += z[i];
  mean /= z.length;
  let v = 0;
  for (let i = 0; i < z.length; i++) v += (z[i] - mean) ** 2;
  return v / z.length;
}

// Integrate radial PSD: σ² ≈ Σ 2π·f·S_rad(f)·Δf
function integratePSD(freqs: Float32Array, power: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < freqs.length - 1; i++) {
    if (power[i] <= 0) continue;
    const df = freqs[i + 1] - freqs[i];
    sum += 2 * Math.PI * freqs[i] * power[i] * df;
  }
  return sum;
}

// Seeded LCG random for reproducible tests
function makeRng(seed: number) {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; };
}

describe("computePSD", () => {
  it("Parseval: integrating radial PSD recovers variance of input", () => {
    const N = 128;
    const scanUm: [number, number] = [5, 5];
    const rng = makeRng(42);
    const z = new Float32Array(N * N).map(() => (rng() - 0.5) * 10);

    const { freqs, power } = computePSD(z, N, scanUm);
    const sigma2_data = variance(z);
    const sigma2_psd = integratePSD(freqs, power);

    // Radial binning excludes FFT square corners (fr > f_Nyquist), which for
    // white noise is ~1 - π/4 ≈ 21% of total power. Real AFM surfaces are
    // low-pass so error is much smaller in practice. Allow 25% here.
    const relErr = Math.abs(sigma2_psd - sigma2_data) / sigma2_data;
    expect(relErr).toBeLessThan(0.25);
  });

  it("normalization is scan-size-independent: Parseval holds at 5 µm and 10 µm", () => {
    // The dx·dy factor in S_2D = (dx·dy/N²)|F|² must scale with scan size so
    // that the integral always recovers σ². This test catches missing or
    // incorrectly fixed normalization.
    const N = 128;
    const rng = makeRng(7);
    const z = new Float32Array(N * N).map(() => (rng() - 0.5) * 10);
    const sigma2 = variance(z);

    for (const scanUm of [[5, 5], [10, 10]] as [number, number][]) {
      const { freqs, power } = computePSD(z, N, scanUm);
      const sigma2_psd = integratePSD(freqs, power);
      const relErr = Math.abs(sigma2_psd - sigma2) / sigma2;
      expect(relErr, `scan ${scanUm[0]} µm`).toBeLessThan(0.25);
    }
  });

  it("sinusoidal surface: PSD peak at correct spatial frequency", () => {
    const N = 256;
    const scanUm: [number, number] = [10, 10];
    const dx = scanUm[0] / N;
    const f0 = 5; // µm⁻¹
    const amp = 3; // nm
    const z = new Float32Array(N * N);
    for (let i = 0; i < N; i++)
      for (let j = 0; j < N; j++)
        z[i * N + j] = amp * Math.sin(2 * Math.PI * f0 * j * dx);

    const { freqs, power } = computePSD(z, N, scanUm);

    let peakIdx = 0;
    for (let i = 1; i < power.length; i++) if (power[i] > power[peakIdx]) peakIdx = i;

    // Peak should land within ±1 frequency bin of f0
    expect(Math.abs(freqs[peakIdx] - f0)).toBeLessThan(1.5 / scanUm[0]);
  });
});
