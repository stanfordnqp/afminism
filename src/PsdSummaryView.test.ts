import { describe, expect, it } from "vitest";
import { psdSeriesColor } from "./PsdSummaryView";

describe("PSD summary colors", () => {
  it("does not repeat colors as the series list grows", () => {
    const colors = Array.from({ length: 100 }, (_, i) => psdSeriesColor(i));
    expect(new Set(colors).size).toBe(colors.length);
  });
});
