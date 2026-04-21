import { useRef, useCallback, useState, useEffect } from "react";
import type { ScanRecord } from "./types";
import PsdPlot, { drawPsd } from "./PsdPlot";
import type { PsdSeries } from "./PsdPlot";

export const PALETTE = ["#e41a1c", "#377eb8", "#4daf4a", "#984ea3", "#ff7f00", "#a65628"];

interface Props {
  scans: ScanRecord[];
  onDrop: (files: FileList) => void;
  onSizeChange?: (w: number, h: number) => void;
  title: string;
  onTitleChange: (t: string) => void;
}

const MIN_W = 300, MIN_H = 180;

export default function PsdSummaryView({ scans, onDrop, onSizeChange, title, onTitleChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const resizeDrag = useRef<{ startX: number; startY: number; startW: number; startH: number } | null>(null);

  useEffect(() => {
    if (size || !containerRef.current) return;
    const el = containerRef.current;
    const w = el.offsetWidth, h = Math.max(MIN_H, el.offsetHeight);
    setSize({ w, h });
    onSizeChange?.(w, h);
  });

  const onResizeDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const el = containerRef.current;
    if (!el) return;
    const startX = e.clientX, startY = e.clientY;
    const startW = el.offsetWidth, startH = el.offsetHeight;
    resizeDrag.current = { startX, startY, startW, startH };
    function onMove(ev: MouseEvent) {
      const w = Math.max(MIN_W, startW + ev.clientX - startX);
      const h = Math.max(MIN_H, startH + ev.clientY - startY);
      setSize({ w, h });
      onSizeChange?.(w, h);
    }
    function onUp() {
      resizeDrag.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [onSizeChange]);

  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); setDragOver(true); }, []);
  const handleDragLeave = useCallback(() => setDragOver(false), []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    if (e.dataTransfer.files.length) onDrop(e.dataTransfer.files);
  }, [onDrop]);

  if (scans.length === 0) {
    return (
      <div
        className={`psd-summary-empty${dragOver ? " drag-active" : ""}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        Load scans to see PSD summary
      </div>
    );
  }

  const allSeries: PsdSeries[] = scans.map((s, i) => ({
    freqs: s.psd.freqs,
    power: s.psd.power,
    color: PALETTE[i % PALETTE.length],
    label: s.label,
  }));

  const plotStyle: React.CSSProperties = size
    ? { width: size.w, height: size.h }
    : { width: "100%", height: "100%" };

  return (
    <div
      className={`psd-summary-view${dragOver ? " drag-active" : ""}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="psd-summary-content">
        <input
          className="psd-title-input"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder="Figure title"
        />
        <div className="psd-summary-plot-wrap" style={plotStyle} ref={containerRef}>
          <PsdPlot
            freqs={allSeries[0].freqs}
            power={allSeries[0].power}
            color={allSeries[0].color}
            showAxes={true}
            allSeries={allSeries}
          />
          <div className="psd-resize-handle" onMouseDown={onResizeDown} title="Drag to resize" />
        </div>
      </div>
    </div>
  );
}

export function buildPsdSummaryCanvas(scans: ScanRecord[], W: number, H: number, title: string): HTMLCanvasElement {
  const dpr = window.devicePixelRatio || 1;
  const canvas = document.createElement("canvas");
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);
  const allSeries: PsdSeries[] = scans.map((s, i) => ({
    freqs: s.psd.freqs, power: s.psd.power,
    color: PALETTE[i % PALETTE.length], label: s.label,
  }));
  drawPsd(ctx, W, H, allSeries, true, undefined, title);
  return canvas;
}
