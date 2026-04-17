import { useCallback, useEffect, useRef, useState } from "react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy } from "@dnd-kit/sortable";
import { createPortal } from "react-dom";
import Sidebar from "./Sidebar";
import ScanCard from "./ScanCard";
import Sparkles from "./Sparkles";
import RainbowTrail from "./RainbowTrail";
import { parseParkTiff } from "./tiff";
import { reprocess, computeRms } from "./processing";
import { toImageData, renderScanForExport, drawScaleBar } from "./colormap";
import type { ScanRecord, ProcessingOptions } from "./types";

const DEFAULT_OPTS: ProcessingOptions = {
  doPlane: true,
  planeSigma: 6,
  doLines: true,
  doClip: true,
  climSigma: 5,
  climMin: 0.5,
  climMax: 20,
  columns: 2,
};

let idCounter = 0;
const uid = () => `scan-${++idCounter}`;

export default function App() {
  const [scans, setScans] = useState<ScanRecord[]>([]);
  const [opts, setOpts] = useState<ProcessingOptions>(DEFAULT_OPTS);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sparkles, setSparkles] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [figureUrl, setFigureUrl] = useState<string | null>(null);
  const [figureBlob, setFigureBlob] = useState<Blob | null>(null);
  const [generatingFigure, setGeneratingFigure] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  // ── Escape closes modals ─────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setExpandedId(null);
        if (figureUrl) { URL.revokeObjectURL(figureUrl); setFigureUrl(null); setFigureBlob(null); }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [figureUrl]);

  // ── processing ────────────────────────────────────────────────────────────

  function buildRecord(
    id: string, filename: string, label: string,
    zRaw: Float32Array, side: number, scanUm: [number, number],
    rotation: number, o: ProcessingOptions
  ): ScanRecord {
    const z = reprocess(zRaw, side, o, rotation);
    const { rms, rmsClipped, ptp } = computeRms(z, o.climSigma);
    return { id, filename, label, zRaw, side, scanUm, rotation, minimized: false, z, rms, rmsClipped, ptp };
  }

  function applyOpts(prevScans: ScanRecord[], newOpts: ProcessingOptions): ScanRecord[] {
    return prevScans.map((s) => {
      const z = reprocess(s.zRaw, s.side, newOpts, s.rotation);
      const { rms, rmsClipped, ptp } = computeRms(z, newOpts.climSigma);
      return { ...s, z, rms, rmsClipped, ptp };
    });
  }

  const handleOptsChange = useCallback((patch: Partial<ProcessingOptions>) => {
    setOpts((prev) => {
      const next = { ...prev, ...patch };
      setScans((s) => applyOpts(s, next));
      return next;
    });
  }, []);

  // ── file loading ─────────────────────────────────────────────────────────

  async function loadFiles(files: FileList | File[]) {
    const arr = Array.from(files).filter(
      (f) => f.name.toLowerCase().endsWith(".tiff") || f.name.toLowerCase().endsWith(".tif")
    );
    if (!arr.length) return;
    const newScans: ScanRecord[] = [];
    for (const file of arr) {
      try {
        const buf = await file.arrayBuffer();
        const { data, side, scanUm } = parseParkTiff(buf, file.name);
        const base = file.name.split("_")[0] ?? file.name.replace(/\.[^.]+$/, "");
        const label = base.charAt(0).toUpperCase() + base.slice(1);
        newScans.push(buildRecord(uid(), file.name, label, data, side, scanUm, 0, opts));
      } catch (e) {
        console.error(`Failed to load ${file.name}:`, e);
        alert(`Could not parse ${file.name}:\n${e}`);
      }
    }
    if (newScans.length) setScans((s) => [...s, ...newScans]);
  }

  // ── drop zone ─────────────────────────────────────────────────────────────

  function onDragEnter(e: React.DragEvent) { e.preventDefault(); setDragOver(true); }
  function onDragLeave(e: React.DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false);
  }
  function onDragOver(e: React.DragEvent) { e.preventDefault(); }
  function onDrop(e: React.DragEvent) { e.preventDefault(); setDragOver(false); loadFiles(e.dataTransfer.files); }

  // ── card callbacks ────────────────────────────────────────────────────────

  function removeCard(id: string) { setScans((s) => s.filter((r) => r.id !== id)); }
  function labelCard(id: string, label: string) { setScans((s) => s.map((r) => r.id === id ? { ...r, label } : r)); }
  function rotateCard(id: string) {
    setScans((s) => s.map((r) => {
      if (r.id !== id) return r;
      const rotation = (r.rotation + 90) % 360;
      const z = reprocess(r.zRaw, r.side, opts, rotation);
      const { rms, rmsClipped, ptp } = computeRms(z, opts.climSigma);
      return { ...r, rotation, z, rms, rmsClipped, ptp };
    }));
  }
  function minimizeCard(id: string) { setScans((s) => s.map((r) => r.id === id ? { ...r, minimized: !r.minimized } : r)); }

  // ── dnd reorder ───────────────────────────────────────────────────────────

  function onDndStart(e: DragStartEvent) { setDragging(String(e.active.id)); }
  function onDndEnd(e: DragEndEvent) {
    setDragging(null);
    const { active, over } = e;
    if (over && active.id !== over.id) {
      setScans((s) => {
        const from = s.findIndex((r) => r.id === active.id);
        const to = s.findIndex((r) => r.id === over.id);
        return arrayMove(s, from, to);
      });
    }
  }

  // ── generate figure ───────────────────────────────────────────────────────

  async function generateFigure() {
    const visible = scans.filter((s) => !s.minimized);
    if (!visible.length) return;
    setGeneratingFigure(true);

    const cols = opts.columns;
    const rows = Math.ceil(visible.length / cols);
    const scanSize = 700; // px per cell image (high-res)
    const titleH = 36;
    const statsH = 30;
    const gap = 20;
    const padding = 24;

    const cellW = scanSize;
    const cellH = scanSize + titleH + statsH;
    const W = cols * cellW + (cols - 1) * gap + 2 * padding;
    const H = rows * cellH + (rows - 1) * gap + 2 * padding;

    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);

    visible.forEach((r, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = padding + col * (cellW + gap);
      const y = padding + row * (cellH + gap);

      let maxAbs = 0;
      for (let j = 0; j < r.z.length; j++) if (Math.abs(r.z[j]) > maxAbs) maxAbs = Math.abs(r.z[j]);
      const lim = opts.doClip ? opts.climSigma * r.rmsClipped : maxAbs || 1;

      const scanCanvas = renderScanForExport(r.z, r.side, r.scanUm, -lim, lim, opts.doClip, scanSize);
      ctx.drawImage(scanCanvas, x, y + titleH);

      // Title
      ctx.fillStyle = "#111";
      ctx.font = "bold 18px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(r.label, x + cellW / 2, y + titleH / 2);

      // Stats
      const parts = [`Rq = ${fmt(r.rms)} nm`];
      if (opts.doClip) parts.push(`Rq* = ${fmt(r.rmsClipped)} nm`);
      parts.push(`PtP = ${fmt(r.ptp)} nm`, `${r.scanUm[0]}×${r.scanUm[1]} µm`);
      ctx.fillStyle = "#555";
      ctx.font = "13px sans-serif";
      ctx.fillText(parts.join("   "), x + cellW / 2, y + titleH + scanSize + statsH / 2);
    });

    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      setFigureUrl(url);
      setFigureBlob(blob);
      setGeneratingFigure(false);
    }, "image/png");
  }

  async function copyFigure() {
    if (!figureBlob) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": figureBlob })]);
    } catch (e) {
      console.error(e);
    }
  }

  function saveFigure() {
    if (!figureUrl) return;
    const a = document.createElement("a");
    a.href = figureUrl;
    a.download = "afm_figure.png";
    a.click();
  }

  function closeFigureModal() {
    if (figureUrl) URL.revokeObjectURL(figureUrl);
    setFigureUrl(null);
    setFigureBlob(null);
  }

  const draggingRecord = scans.find((s) => s.id === dragging);
  const expandedRecord = expandedId ? scans.find((s) => s.id === expandedId) : null;

  return (
    <DndContext sensors={sensors} onDragStart={onDndStart} onDragEnd={onDndEnd}>
      <style>{`:root { --sidebar-w: ${sidebarOpen ? 260 : 0}px; }`}</style>

      <Sidebar
        open={sidebarOpen}
        onToggle={() => setSidebarOpen((v) => !v)}
        opts={opts}
        onChange={handleOptsChange}
        scans={scans}
        onGenerateFigure={generateFigure}
        generatingFigure={generatingFigure}
        sparkles={sparkles}
        onSparklesToggle={() => setSparkles(v => !v)}
      />

      <button className="sidebar-toggle" onClick={() => setSidebarOpen((v) => !v)}
        title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}>
        {sidebarOpen ? "‹" : "›"}
      </button>

      <main className="main">
        <div
          className={`drop-zone${dragOver ? " drag-over" : ""}`}
          onDragEnter={onDragEnter}
          onDragLeave={onDragLeave}
          onDragOver={onDragOver}
          onDrop={onDrop}
        >
          {scans.length === 0 && (
            <div className="empty-hint">
              <DropIcon />
              <p>Drop Park Systems TIFF files here</p>
              <small>or click to browse</small>
              <button className="add-files-btn" onClick={() => fileInputRef.current?.click()}>
                Browse files
              </button>
            </div>
          )}

          {scans.length > 0 && (
            <>
              <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
                <button className="add-files-btn" onClick={() => fileInputRef.current?.click()}>
                  + Add files
                </button>
              </div>
              <SortableContext items={scans.map((s) => s.id)} strategy={rectSortingStrategy}>
                <div className="card-grid" style={{ "--cols": opts.columns } as React.CSSProperties}>
                  {scans.map((r) => (
                    <ScanCard
                      key={r.id}
                      record={r}
                      opts={opts}
                      onRemove={() => removeCard(r.id)}
                      onLabelChange={(l) => labelCard(r.id, l)}
                      onRotate={() => rotateCard(r.id)}
                      onMinimize={() => minimizeCard(r.id)}
                      onExpand={() => setExpandedId(r.id)}
                    />
                  ))}
                </div>
              </SortableContext>
            </>
          )}
        </div>
      </main>

      {/* ── dnd drag overlay ── */}
      {createPortal(
        <DragOverlay>
          {draggingRecord && (
            <div className="dnd-overlay">
              <ScanCard
                record={draggingRecord} opts={opts}
                onRemove={() => {}} onLabelChange={() => {}} onRotate={() => {}} onMinimize={() => {}} onExpand={() => {}}
                isOverlay
              />
            </div>
          )}
        </DragOverlay>,
        document.body
      )}

      {/* ── fullscreen card modal ── */}
      {expandedRecord && createPortal(
        <FullscreenModal record={expandedRecord} opts={opts} onClose={() => setExpandedId(null)} />,
        document.body
      )}

      {/* ── figure preview modal ── */}
      {figureUrl && createPortal(
        <div className="modal-backdrop" onClick={closeFigureModal}>
          <div className="figure-modal" onClick={(e) => e.stopPropagation()}>
            <div className="figure-modal-header">
              <span style={{ fontWeight: 600, fontSize: 14 }}>Figure preview</span>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="modal-action-btn" onClick={copyFigure}>Copy PNG</button>
                <button className="modal-action-btn primary" onClick={saveFigure}>Save PNG</button>
                <button className="icon-btn danger" onClick={closeFigureModal} style={{ marginLeft: 4 }}>✕</button>
              </div>
            </div>
            <div className="figure-modal-preview">
              <img src={figureUrl} alt="figure preview" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", display: "block" }} />
            </div>
            <div style={{ padding: "8px 16px", fontSize: 11, color: "#888" }}>
              Escape or click outside to close
            </div>
          </div>
        </div>,
        document.body
      )}

      <Sparkles enabled={sparkles} />
      <RainbowTrail enabled={sparkles} />

      <input ref={fileInputRef} type="file" multiple accept=".tiff,.tif" style={{ display: "none" }}
        onChange={(e) => { if (e.target.files) loadFiles(e.target.files); e.target.value = ""; }} />
    </DndContext>
  );
}

// ── Fullscreen modal ──────────────────────────────────────────────────────────

function FullscreenModal({ record, opts, onClose }: { record: ScanRecord; opts: ProcessingOptions; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scaleBarRef = useRef<HTMLCanvasElement>(null);

  let maxAbs = 0;
  for (let j = 0; j < record.z.length; j++) if (Math.abs(record.z[j]) > maxAbs) maxAbs = Math.abs(record.z[j]);
  const lim = opts.doClip ? opts.climSigma * record.rmsClipped : maxAbs || 1;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = record.side;
    canvas.height = record.side;
    const img = toImageData(record.z, record.side, -lim, lim, opts.doClip);
    canvas.getContext("2d")!.putImageData(img, 0, 0);
  }, [record.z, record.side, lim, opts.doClip]);

  // Scale bar on overlay canvas
  useEffect(() => {
    const data = canvasRef.current;
    const sb = scaleBarRef.current;
    if (!data || !sb) return;
    function draw() {
      if (!data || !sb) return;
      const dpr = window.devicePixelRatio || 1;
      const w = data.clientWidth;
      if (!w) return;
      sb.width = Math.round(w * dpr);
      sb.height = Math.round(w * dpr);
      const ctx = sb.getContext("2d")!;
      ctx.clearRect(0, 0, sb.width, sb.height);
      ctx.save();
      ctx.scale(dpr, dpr);
      drawScaleBar(ctx, record.scanUm[0], w);
      ctx.restore();
    }
    const obs = new ResizeObserver(draw);
    obs.observe(data);
    draw();
    return () => obs.disconnect();
  }, [record.scanUm]);

  const statsLine = [
    `Rq = ${fmt(record.rms)} nm`,
    ...(opts.doClip ? [`Rq* = ${fmt(record.rmsClipped)} nm`] : []),
    `PtP = ${fmt(record.ptp)} nm`,
    `${record.scanUm[0]}×${record.scanUm[1]} µm`,
  ].join("   ");

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="fullscreen-modal" onClick={(e) => e.stopPropagation()}>
        <div className="fullscreen-modal-header">
          <span style={{ fontWeight: 700, fontSize: 16 }}>{record.label}</span>
          <button className="icon-btn danger" onClick={onClose} title="Close (Esc)">✕</button>
        </div>
        <div className="card-canvas-wrap fullscreen-canvas-wrap">
          <canvas ref={canvasRef} className="data-canvas" />
          <canvas ref={scaleBarRef} className="scalebar-canvas" />
        </div>
        <div style={{ padding: "10px 16px", textAlign: "center", fontSize: 13, color: "#555" }}>
          {statsLine}
        </div>
      </div>
    </div>
  );
}


function fmt(n: number) {
  if (n === 0) return "0";
  const mag = Math.floor(Math.log10(Math.abs(n)));
  return n.toFixed(Math.max(0, 2 - mag));
}

function DropIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="#aaa" strokeWidth="2">
      <rect x="6" y="6" width="36" height="36" rx="6" strokeDasharray="4 3"/>
      <path d="M24 16v16M16 26l8 8 8-8"/>
    </svg>
  );
}
