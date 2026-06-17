import { describe, it, expect } from "vitest";
import { sampleSegment } from "./lineprofile";

// z[row*w + col] = col  → height equals the x pixel index
function gradX(w: number, h: number): Float32Array {
  const z = new Float32Array(w * h);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) z[r * w + c] = c;
  return z;
}

describe("sampleSegment", () => {
  it("horizontal line over an x-gradient: distance runs 0..length, height increases", () => {
    const w = 8, h = 8;
    const seg = { id: "a", x0: 0, y0: 0.5, x1: 1, y1: 0.5 };
    const { dist, height } = sampleSegment(gradX(w, h), w, h, [10, 10], seg);

    expect(dist[0]).toBeCloseTo(0, 6);
    expect(dist[dist.length - 1]).toBeCloseTo(10, 4); // full width = 10 µm
    for (let i = 1; i < dist.length; i++) expect(dist[i]).toBeGreaterThan(dist[i - 1]);
    expect(height[height.length - 1]).toBeGreaterThan(height[0]);
  });

  it("endpoints sample the corner values", () => {
    const w = 8, h = 8;
    const seg = { id: "e", x0: 0, y0: 0.5, x1: 1, y1: 0.5 };
    const { height } = sampleSegment(gradX(w, h), w, h, [5, 5], seg);
    expect(height[0]).toBeCloseTo(0, 5);          // column 0
    expect(height[height.length - 1]).toBeCloseTo(w - 1, 5); // column 7
  });

  it("non-square pixel grid: diagonal length is physical (µm)", () => {
    const w = 16, h = 4;
    const seg = { id: "d", x0: 0, y0: 0, x1: 1, y1: 1 };
    const { dist } = sampleSegment(new Float32Array(w * h), w, h, [10, 10], seg);
    expect(dist[dist.length - 1]).toBeCloseTo(Math.hypot(10, 10), 4);
  });

  it("vertical line over an x-gradient is flat (height constant)", () => {
    const w = 8, h = 8;
    const seg = { id: "v", x0: 0.5, y0: 0, x1: 0.5, y1: 1 };
    const { height } = sampleSegment(gradX(w, h), w, h, [10, 10], seg);
    for (let i = 1; i < height.length; i++) expect(height[i]).toBeCloseTo(height[0], 5);
  });
});
