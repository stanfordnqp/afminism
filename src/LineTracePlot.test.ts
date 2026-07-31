import { describe, expect, it } from "vitest";
import { fmtTick, linTicks } from "./LineTracePlot";

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
});
