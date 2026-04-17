import { useEffect, useRef, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ScanRecord, ProcessingOptions } from "./types";
import { toImageData, renderScanForExport, drawScaleBar } from "./colormap";

interface Props {
  record: ScanRecord;
  opts: ProcessingOptions;
  onRemove: () => void;
  onLabelChange: (label: string) => void;
  onRotate: () => void;
  onMinimize: () => void;
  onExpand: () => void;
  /** When true the card is rendered inside the dnd overlay — no sortable hooks needed */
  isOverlay?: boolean;
}

export default function ScanCard({
  record, opts, onRemove, onLabelChange, onRotate, onMinimize, onExpand, isOverlay,
}: Props) {
  const dataCanvasRef = useRef<HTMLCanvasElement>(null);
  const scaleBarCanvasRef = useRef<HTMLCanvasElement>(null);
  const [copying, setCopying] = useState<null | "scaled" | "raw">(null);

  const sortable = useSortable({ id: record.id, disabled: !!isOverlay });
  const style = isOverlay ? {} : {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    opacity: sortable.isDragging ? 0.4 : 1,
  };
  const setRef = isOverlay ? undefined : sortable.setNodeRef;

  // ── compute clim ──────────────────────────────────────────────────────────
  let maxAbs = 0;
  for (let j = 0; j < record.z.length; j++) if (Math.abs(record.z[j]) > maxAbs) maxAbs = Math.abs(record.z[j]);
  const lim = opts.doClip ? opts.climSigma * record.rmsClipped : maxAbs || 1;

  // ── render raw pixel data ─────────────────────────────────────────────────
  useEffect(() => {
    const canvas = dataCanvasRef.current;
    if (!canvas || record.minimized) return;
    canvas.width = record.side;
    canvas.height = record.side;
    const img = toImageData(record.z, record.side, -lim, lim, opts.doClip);
    canvas.getContext("2d")!.putImageData(img, 0, 0);
  }, [record.z, record.side, record.minimized, lim, opts.doClip]);

  // ── render scale bar on HiDPI overlay canvas via ResizeObserver ───────────
  useEffect(() => {
    const dataCanvas = dataCanvasRef.current;
    const sbCanvas = scaleBarCanvasRef.current;
    if (!dataCanvas || !sbCanvas || record.minimized) return;

    function redraw() {
      if (!dataCanvas || !sbCanvas) return;
      const dpr = window.devicePixelRatio || 1;
      const w = dataCanvas.clientWidth;
      const h = dataCanvas.clientHeight;
      if (w === 0) return;
      sbCanvas.width = Math.round(w * dpr);
      sbCanvas.height = Math.round(h * dpr);
      const ctx = sbCanvas.getContext("2d")!;
      ctx.clearRect(0, 0, sbCanvas.width, sbCanvas.height);
      ctx.save();
      ctx.scale(dpr, dpr);
      drawScaleBar(ctx, record.scanUm[0], w);
      ctx.restore();
    }

    const observer = new ResizeObserver(redraw);
    observer.observe(dataCanvas);
    redraw();
    return () => observer.disconnect();
  }, [record.scanUm, record.minimized]);

  // ── copy helpers ──────────────────────────────────────────────────────────
  async function doCopy(raw: boolean) {
    setCopying(raw ? "raw" : "scaled");
    try {
      let blob: Blob;
      if (raw) {
        blob = await canvasToBlob(dataCanvasRef.current!);
      } else {
        const size = Math.max(record.side, 800);
        const out = renderScanForExport(record.z, record.side, record.scanUm, -lim, lim, opts.doClip, size);
        blob = await canvasToBlob(out);
      }
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    } catch {
      const canvas = raw ? dataCanvasRef.current! : renderScanForExport(record.z, record.side, record.scanUm, -lim, lim, opts.doClip, Math.max(record.side, 800));
      download(canvas.toDataURL("image/png"), `${record.label}${raw ? "_raw" : ""}.png`);
    } finally {
      setCopying(null);
    }
  }

  const { rms, rmsClipped, ptp, scanUm } = record;
  const statsLine = [
    `Rq = ${fmt(rms)} nm`,
    ...(opts.doClip ? [`Rq* = ${fmt(rmsClipped)} nm`] : []),
    `PtP = ${fmt(ptp)} nm`,
    `${scanUm[0]}×${scanUm[1]} µm`,
  ].join("   ");

  return (
    <div
      ref={setRef}
      style={style}
      className={`scan-card${record.minimized ? " minimized" : ""}`}
    >
      <div className="card-header">
        <span
          className="drag-handle"
          {...(isOverlay ? {} : sortable.attributes)}
          {...(isOverlay ? {} : sortable.listeners)}
          title="Drag to reorder"
        >
          <DragIcon />
        </span>
        <input
          className="card-title-input"
          value={record.label}
          onChange={(e) => onLabelChange(e.target.value)}
          title="Click to rename"
        />
        <div className="card-actions">
          <button className="icon-btn" onClick={onRotate} title="Rotate 90° clockwise">↻</button>
          <button className="icon-btn" onClick={() => doCopy(false)} title="Copy with scale bar" disabled={copying !== null}>
            {copying === "scaled" ? "…" : <CopyIcon />}
          </button>
          <button className="icon-btn" onClick={() => doCopy(true)} title="Copy raw (no scale bar)" disabled={copying !== null} style={{ fontSize: 10, fontWeight: 600 }}>
            {copying === "raw" ? "…" : "raw"}
          </button>
          <button className="icon-btn" onClick={onExpand} title="Expand fullscreen">
            <ExpandIcon />
          </button>
          <button className="icon-btn" onClick={onMinimize} title={record.minimized ? "Expand card" : "Minimize card"}>
            {record.minimized ? "▿" : "▵"}
          </button>
          <button className="icon-btn danger" onClick={onRemove} title="Remove">✕</button>
        </div>
      </div>
      <div className="card-body">
        <div className="card-canvas-wrap">
          {/* Raw data: pixelated upscale */}
          <canvas ref={dataCanvasRef} className="data-canvas" />
          {/* Scale bar: separate HiDPI overlay, not drawn on data canvas */}
          <canvas ref={scaleBarCanvasRef} className="scalebar-canvas" />
        </div>
        <div className="card-stats">{statsLine}</div>
        <div className="card-filename" title={record.filename}>{record.filename}</div>
      </div>
    </div>
  );
}

// ── utils ─────────────────────────────────────────────────────────────────────

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((res) => canvas.toBlob((b) => res(b!), "image/png"));
}

function download(dataUrl: string, filename: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  a.click();
}

function fmt(n: number): string {
  if (n === 0) return "0";
  const mag = Math.floor(Math.log10(Math.abs(n)));
  return n.toFixed(Math.max(0, 2 - mag));
}

// ── icons ─────────────────────────────────────────────────────────────────────

function DragIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
      <circle cx="4" cy="3" r="1.2"/><circle cx="10" cy="3" r="1.2"/>
      <circle cx="4" cy="7" r="1.2"/><circle cx="10" cy="7" r="1.2"/>
      <circle cx="4" cy="11" r="1.2"/><circle cx="10" cy="11" r="1.2"/>
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="5" y="5" width="9" height="9" rx="1.5"/>
      <path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5"/>
    </svg>
  );
}

function ExpandIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4"/>
    </svg>
  );
}
