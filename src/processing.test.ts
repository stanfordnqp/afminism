import { describe, expect, it } from "vitest";
import { sharedDisplayRange } from "./processing";

describe("shared display range", () => {
  const scans = [
    { z: new Float32Array([-1, 0, 1, 100]) },
    { z: new Float32Array([-2, 0, 2]) },
  ];

  it("uses the full pooled min–max when clipping is off", () => {
    expect(sharedDisplayRange(scans, { doClip: false, climSigma: 2 })).toEqual([-2, 100]);
  });

  it("clips from one mean and standard deviation across every scan", () => {
    expect(sharedDisplayRange(scans, { doClip: true, climSigma: 2 })).toEqual([-2, 2]);
  });

  it("applies the manual window to the shared range once", () => {
    expect(sharedDisplayRange(scans, {
      doClip: true, climSigma: 2, climLow: 0.25, climHigh: 0.75,
    })).toEqual([-1, 1]);
  });

  it("returns null when there are no pixels", () => {
    expect(sharedDisplayRange([], { doClip: true, climSigma: 2 })).toBeNull();
  });
});
