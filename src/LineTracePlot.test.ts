import { describe, expect, it } from "vitest";
import { fmtTick, lineTraceRange, linTicks } from "./LineTracePlot";

describe("line-profile ticks", () => {
  it("uses a smaller nice step when alignment leaves fewer than two ticks", () => {
    expect(linTicks(-0.4, 4.4, 88)).toEqual([0, 2, 4]);
    expect(linTicks(-0.04, 0.44, 88)).toEqual([0, 0.2, 0.4]);
    const offsetTicks = linTicks(0.21, 0.69, 88);
    expect(offsetTicks).toHaveLength(2);
    expect(offsetTicks[0]).toBeCloseTo(0.4);
    expect(offsetTicks[1]).toBeCloseTo(0.6);
    expect(linTicks(-4.4, -0.1, 88)).toEqual([-4, -2]);
  });

  it("formats nice ticks without unnecessary trailing zeros", () => {
    expect([0.1, 0.2, 0.5, 1, 2, 4].map(fmtTick)).toEqual(["0.1", "0.2", "0.5", "1", "2", "4"]);
  });

  it("builds one padded range from every unclipped trace value", () => {
    const traces = [
      { id: "a", label: "1", color: "blue", dist: new Float32Array([0, 1]), height: new Float32Array([-1, 1]) },
      { id: "b", label: "1", color: "red", dist: new Float32Array([0, 1]), height: new Float32Array([2, 100]) },
    ];
    const range = lineTraceRange(traces);
    expect(range?.[0]).toBeCloseTo(-9.08);
    expect(range?.[1]).toBeCloseTo(108.08);
  });
});
