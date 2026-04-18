import { useEffect, useRef, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ScanRecord, ProcessingOptions } from "./types";
import { toImageData, renderScanForExport, drawScaleBar } from "./colormap";
import Colorbar from "./Colorbar";

interface Props {
  record: ScanRecord;
  opts: ProcessingOptions;
  onRemove: () => void;
  onLabelChange: (label: string) => void;
  onRotate: () => void;
  onMinimize: () => void;
  onExpand: () => void;
  isNew?: boolean;
  /** When true the card is rendered inside the dnd overlay — no sortable hooks needed */
  isOverlay?: boolean;
}

export default function ScanCard({
  record, opts, onRemove, onLabelChange, onRotate, onMinimize, onExpand, isNew, isOverlay,
}: Props) {
  const dataCanvasRef = useRef<HTMLCanvasElement>(null);
  const scaleBarCanvasRef = useRef<HTMLCanvasElement>(null);
  const [copying, setCopying] = useState<null | "scaled" | "raw">(null);
  const [cursorH, setCursorH] = useState<{ cx: number; cy: number; v: number } | null>(null);

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

  // ── render raw pixel data (always, including when minimized for preview) ──
  useEffect(() => {
    const canvas = dataCanvasRef.current;
    if (!canvas) return;
    canvas.width = record.side;
    canvas.height = record.side;
    const img = toImageData(record.z, record.side, -lim, lim, opts.doClip);
    canvas.getContext("2d")!.putImageData(img, 0, 0);
  }, [record.z, record.side, lim, opts.doClip]);

  // ── render scale bar on HiDPI overlay canvas via ResizeObserver ───────────
  useEffect(() => {
    const dataCanvas = dataCanvasRef.current;
    const sbCanvas = scaleBarCanvasRef.current;
    if (!dataCanvas || !sbCanvas) return;

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
      // Don't draw scale bar on minimized preview
      if (record.minimized) return;
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

  // ── copy / download helpers ───────────────────────────────────────────────
  async function doCopy(data: boolean) {
    setCopying(data ? "raw" : "scaled");
    try {
      const cvs = data ? dataCanvasRef.current! : renderScanForExport(record.z, record.side, record.scanUm, -lim, lim, opts.doClip, Math.max(record.side, 800));
      await navigator.clipboard.write([new ClipboardItem({ "image/png": await canvasToBlob(cvs) })]);
    } catch {
      const cvs = data ? dataCanvasRef.current! : renderScanForExport(record.z, record.side, record.scanUm, -lim, lim, opts.doClip, Math.max(record.side, 800));
      download(cvs.toDataURL("image/png"), `${record.label}${data ? "_data" : "_figure"}.png`);
    } finally {
      setCopying(null);
    }
  }

  function doDownload(data: boolean) {
    const cvs = data ? dataCanvasRef.current! : renderScanForExport(record.z, record.side, record.scanUm, -lim, lim, opts.doClip, Math.max(record.side, 800));
    download(cvs.toDataURL("image/png"), `${record.label}${data ? "_data" : "_figure"}.png`);
  }

  const { rms, rmsClipped, ptp, scanUm } = record;
  const statsLine = [
    `Rq = ${fmt(rms)} nm`,
    ...(opts.doClip ? [`Rq* = ${fmt(rmsClipped)} nm`] : []),
    `PtP = ${fmt(ptp)} nm`,
    `${scanUm[0]}×${scanUm[1]} µm`,
  ].join("   ");

  const classes = [
    "scan-card",
    record.minimized ? "minimized" : "",
    isNew ? "is-new" : "",
  ].filter(Boolean).join(" ");

  return (
    <div ref={setRef} style={style} className={classes}>
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
          <button className="icon-btn" onClick={onExpand} title="Expand fullscreen">
            <ExpandIcon />
          </button>
          <button className="icon-btn" onClick={onMinimize} title={record.minimized ? "Show" : "Hide"}>
            {record.minimized ? <EyeOffIcon /> : <EyeIcon />}
          </button>
          <button className="icon-btn danger" onClick={onRemove} title="Remove">✕</button>
        </div>
      </div>
      <div
        className="card-body"
        onDoubleClick={!record.minimized ? onExpand : undefined}
        title={!record.minimized ? "Double-click to expand" : undefined}
      >
        <div className="canvas-row">
          <div
            className="card-canvas-wrap"
            style={{ position: "relative" }}
            onMouseMove={!record.minimized ? (e) => {
              const canvas = dataCanvasRef.current;
              if (!canvas) return;
              const r = canvas.getBoundingClientRect();
              const px = (e.clientX - r.left) / r.width;
              const py = (e.clientY - r.top) / r.height;
              const ix = Math.min(record.side - 1, Math.max(0, Math.floor(px * record.side)));
              const iy = Math.min(record.side - 1, Math.max(0, Math.floor(py * record.side)));
              setCursorH({ cx: e.clientX - r.left, cy: e.clientY - r.top, v: record.z[iy * record.side + ix] });
            } : undefined}
            onMouseLeave={() => setCursorH(null)}
          >
            <canvas ref={dataCanvasRef} className="data-canvas" />
            <canvas ref={scaleBarCanvasRef} className="scalebar-canvas" />
            {/* Rotate button — top-right of image */}
            <button className="canvas-rotate-btn" onClick={(e) => { e.stopPropagation(); onRotate(); }} title="Rotate 90°">↻</button>
            {cursorH && !record.minimized && (
              <div className="cursor-readout" style={{ left: cursorH.cx, top: cursorH.cy }}>
                {fmt(cursorH.v)} nm
              </div>
            )}
            {/* Copy / download overlay — bottom of image on hover */}
            {!record.minimized && (
              <div className="card-img-actions">
                <button className="card-img-btn" onClick={(e) => { e.stopPropagation(); doCopy(true); }} disabled={copying !== null} title="Copy data">
                  {copying === "raw" ? "…" : <CopyIcon />}<span>data</span>
                </button>
                <button className="card-img-btn" onClick={(e) => { e.stopPropagation(); doCopy(false); }} disabled={copying !== null} title="Copy figure">
                  {copying === "scaled" ? "…" : <CopyIcon />}<span>figure</span>
                </button>
                <button className="card-img-btn" onClick={(e) => { e.stopPropagation(); doDownload(true); }} disabled={copying !== null} title="Download data">
                  <DownloadIcon /><span>data</span>
                </button>
                <button className="card-img-btn" onClick={(e) => { e.stopPropagation(); doDownload(false); }} disabled={copying !== null} title="Download figure">
                  <DownloadIcon /><span>figure</span>
                </button>
              </div>
            )}
          </div>
          {!record.minimized && <Colorbar vmin={-lim} vmax={lim} />}
        </div>
        {!record.minimized && (
          <>
            <div className="card-stats">{statsLine}</div>
            <div className="card-filename" title={record.filename}>{record.filename}</div>
          </>
        )}
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

function DownloadIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8 2v9M4 7l4 4 4-4"/><path d="M2 13h12"/>
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

function EyeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z"/>
      <circle cx="8" cy="8" r="2"/>
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 2l12 12M6.7 6.7A2 2 0 0 0 9.3 9.3M4.1 4.1C2.4 5.2 1 8 1 8s2.5 5 7 5c1.4 0 2.7-.4 3.9-1.1M7 3.1C7.3 3 7.7 3 8 3c4.5 0 7 5 7 5s-.7 1.4-1.9 2.7"/>
    </svg>
  );
}
