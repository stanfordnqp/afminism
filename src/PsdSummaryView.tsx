import { useRef, useCallback } from "react";
import type { ScanRecord } from "./types";
import PsdPlot, { drawPsd } from "./PsdPlot";
import type { PsdSeries } from "./PsdPlot";

export const PALETTE = ["#e41a1c", "#377eb8", "#4daf4a", "#984ea3", "#ff7f00", "#a65628"];

interface Props {
  scans: ScanRecord[];
}

export default function PsdSummaryView({ scans }: Props) {
  const canvasRef = useRef<HTMLDivElement>(null);

  const allSeries: PsdSeries[] = scans.map((s, i) => ({
    freqs: s.psd.freqs,
    power: s.psd.power,
    color: PALETTE[i % PALETTE.length],
    label: s.label,
  }));

  const handleExport = useCallback(() => {
    const W = 800, H = 500;
    const dpr = window.devicePixelRatio || 1;
    const c = document.createElement("canvas");
    c.width = W * dpr; c.height = H * dpr;
    const ctx = c.getContext("2d")!;
    ctx.scale(dpr, dpr);
    drawPsd(ctx, W, H, allSeries, true);
    c.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "psd_summary.png"; a.click();
      URL.revokeObjectURL(url);
    });
  }, [allSeries]);

  if (scans.length === 0) {
    return <div className="psd-summary-empty">Load scans to see PSD summary</div>;
  }

  return (
    <div className="psd-summary-view">
      <div className="psd-summary-toolbar">
        <span className="psd-summary-title">PSD Summary</span>
        <button className="sidebar-btn" onClick={handleExport}>Export PNG</button>
      </div>
      <div className="psd-summary-plot" ref={canvasRef}>
        <PsdPlot
          freqs={allSeries[0].freqs}
          power={allSeries[0].power}
          color={allSeries[0].color}
          showAxes={true}
          allSeries={allSeries}
        />
      </div>
    </div>
  );
}
