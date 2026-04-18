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
import { toImageData, renderScanForExport, drawScaleBar, drawColorbar } from "./colormap";
import Colorbar from "./Colorbar";
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
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [figureUrl, setFigureUrl] = useState<string | null>(null);
  const [figureBlob, setFigureBlob] = useState<Blob | null>(null);
  const [generatingFigure, setGeneratingFigure] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  // ── Escape closes expanded view / figure modal ────────────────────────────
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
    const existingNames = new Set(scans.map((s) => s.filename));
    const dupes = arr.filter((f) => existingNames.has(f.name));
    if (dupes.length) {
      alert(`Already loaded — skipped:\n${dupes.map((f) => f.name).join("\n")}`);
    }
    const toLoad = arr.filter((f) => !existingNames.has(f.name));
    if (!toLoad.length) return;
    const newScans: ScanRecord[] = [];
    for (const file of toLoad) {
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
    if (newScans.length) {
      setScans((s) => [...s, ...newScans]);
      // Mark new scans for sparkle glow, clear after 3s
      const ids = newScans.map((s) => s.id);
      setNewIds((prev) => new Set([...prev, ...ids]));
      setTimeout(() => {
        setNewIds((prev) => {
          const next = new Set(prev);
          ids.forEach((id) => next.delete(id));
          return next;
        });
      }, 3000);
    }
  }

  // ── drop zone ─────────────────────────────────────────────────────────────

  function onDragEnter(e: React.DragEvent) { e.preventDefault(); setDragOver(true); }
  function onDragLeave(e: React.DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false);
  }
  function onDragOver(e: React.DragEvent) { e.preventDefault(); }
  function onDrop(e: React.DragEvent) { e.preventDefault(); setDragOver(false); loadFiles(e.dataTransfer.files); }

  // ── card callbacks ────────────────────────────────────────────────────────

  function removeCard(id: string) {
    setScans((s) => s.filter((r) => r.id !== id));
    if (expandedId === id) setExpandedId(null);
  }
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
    const scanSize = 700;
    const titleH = 36;
    const statsH = 30;
    const gap = 20;
    const padding = 24;
    const colorbarW = 62;
    const colorbarGap = 8;

    const cellW = scanSize + colorbarGap + colorbarW;
    const cellH = scanSize + titleH + statsH;

    const procParts: string[] = [];
    if (opts.doPlane) procParts.push(`Plane leveling (σ = ${opts.planeSigma})`);
    if (opts.doLines) procParts.push("Row leveling");
    if (opts.doClip) procParts.push(`Color range ±${opts.climSigma}σ`);
    const procText = procParts.join("  ·  ");
    const footerH = 42;

    const W = cols * cellW + (cols - 1) * gap + 2 * padding;
    const H = rows * cellH + (rows - 1) * gap + 2 * padding + footerH;

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

      ctx.save();
      ctx.translate(x + scanSize + colorbarGap, y + titleH);
      drawColorbar(ctx, -lim, lim, colorbarW, scanSize, false);
      ctx.restore();

      ctx.fillStyle = "#111";
      ctx.font = "bold 18px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(r.label, x + cellW / 2, y + titleH / 2);

      const parts = [`Rq = ${fmt(r.rms)} nm`];
      if (opts.doClip) parts.push(`Rq* = ${fmt(r.rmsClipped)} nm`);
      parts.push(`PtP = ${fmt(r.ptp)} nm`, `${r.scanUm[0]}×${r.scanUm[1]} µm`);
      ctx.fillStyle = "#555";
      ctx.font = "13px sans-serif";
      ctx.fillText(parts.join("   "), x + cellW / 2, y + titleH + scanSize + statsH / 2);
    });

    // footer
    const footerY = H - footerH;
    ctx.strokeStyle = "#e0e0e0";
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(padding, footerY + 6); ctx.lineTo(W - padding, footerY + 6);
    ctx.stroke();
    if (procText) {
      ctx.fillStyle = "#aaa";
      ctx.font = "11px Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(procText, W / 2, footerY + 12);
    }
    ctx.fillStyle = "#c0c0c0";
    ctx.font = "italic 10px Arial, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText("ayeahfeminist", W - padding, H - 6);

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
  const expandedRecord = expandedId ? scans.find((s) => s.id === expandedId) ?? null : null;

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
        isExpanded={!!expandedRecord}
      />

      <button className="sidebar-toggle" onClick={() => setSidebarOpen((v) => !v)}
        title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}>
        {sidebarOpen ? "‹" : "›"}
      </button>

      <main className="main">
        {/* ── Expanded single-scan view ── */}
        {expandedRecord ? (
          <ExpandedView
            record={expandedRecord}
            opts={opts}
            onClose={() => setExpandedId(null)}
            onRotate={() => rotateCard(expandedRecord.id)}
            onLabelChange={(l) => labelCard(expandedRecord.id, l)}
          />
        ) : (
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
                <button className="add-files-btn-empty" onClick={() => fileInputRef.current?.click()}>
                  Browse files
                </button>
              </div>
            )}

            {scans.length > 0 && (
              <>
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
                        isNew={newIds.has(r.id)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </>
            )}
          </div>
        )}
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

      {/* ── floating add button ── */}
      {!expandedRecord && (
        <button className="fab-add" onClick={() => fileInputRef.current?.click()} title="Add files">
          +
        </button>
      )}

      <Sparkles enabled={sparkles} />
      <RainbowTrail enabled={sparkles} />

      <input ref={fileInputRef} type="file" multiple accept=".tiff,.tif" style={{ display: "none" }}
        onChange={(e) => { if (e.target.files) loadFiles(e.target.files); e.target.value = ""; }} />
    </DndContext>
  );
}

// ── Expanded view (replaces grid when a card is opened) ───────────────────────

function ExpandedView({ record, opts, onClose, onRotate, onLabelChange }: {
  record: ScanRecord;
  opts: ProcessingOptions;
  onClose: () => void;
  onRotate: () => void;
  onLabelChange: (l: string) => void;
}) {
  const dataCanvasRef = useRef<HTMLCanvasElement>(null);
  const scaleBarCanvasRef = useRef<HTMLCanvasElement>(null);
  type Action = "copy-data" | "copy-figure" | "dl-data" | "dl-figure";
  const [copying, setCopying] = useState<Action | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [cursorH, setCursorH] = useState<{ cx: number; cy: number; v: number } | null>(null);

  let maxAbs = 0;
  for (let j = 0; j < record.z.length; j++) if (Math.abs(record.z[j]) > maxAbs) maxAbs = Math.abs(record.z[j]);
  const lim = opts.doClip ? opts.climSigma * record.rmsClipped : maxAbs || 1;

  useEffect(() => {
    const canvas = dataCanvasRef.current;
    if (!canvas) return;
    canvas.width = record.side;
    canvas.height = record.side;
    const img = toImageData(record.z, record.side, -lim, lim, opts.doClip);
    canvas.getContext("2d")!.putImageData(img, 0, 0);
  }, [record.z, record.side, lim, opts.doClip]);

  useEffect(() => {
    const data = dataCanvasRef.current;
    const sb = scaleBarCanvasRef.current;
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

  function showToast(msg: string) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2000);
  }

  function buildFigureCanvas(): HTMLCanvasElement {
    const scanSize = 700;
    const titleH = 40;
    const statsH = 32;
    const pad = 20;
    const colorbarW = 62;
    const colorbarGap = 8;

    const procParts: string[] = [];
    if (opts.doPlane) procParts.push(`Plane leveling (σ = ${opts.planeSigma})`);
    if (opts.doLines) procParts.push("Row leveling");
    if (opts.doClip) procParts.push(`Color range ±${opts.climSigma}σ`);
    const procText = procParts.join("  ·  ");
    const footerH = 42;

    const W = 2 * pad + scanSize + colorbarGap + colorbarW;
    const H = 2 * pad + titleH + scanSize + statsH + footerH;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = "#111";
    ctx.font = "bold 20px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(record.label, W / 2, pad + titleH / 2);

    const scanCvs = renderScanForExport(record.z, record.side, record.scanUm, -lim, lim, opts.doClip, scanSize);
    ctx.drawImage(scanCvs, pad, pad + titleH);

    ctx.save();
    ctx.translate(pad + scanSize + colorbarGap, pad + titleH);
    drawColorbar(ctx, -lim, lim, colorbarW, scanSize, false);
    ctx.restore();

    const parts = [`Rq = ${fmt(record.rms)} nm`];
    if (opts.doClip) parts.push(`Rq* = ${fmt(record.rmsClipped)} nm`);
    parts.push(`PtP = ${fmt(record.ptp)} nm`, `${record.scanUm[0]}×${record.scanUm[1]} µm`);
    ctx.fillStyle = "#555";
    ctx.font = "13px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(parts.join("   "), W / 2, pad + titleH + scanSize + statsH / 2);

    const footerY = H - footerH;
    ctx.strokeStyle = "#e0e0e0";
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(pad, footerY + 6); ctx.lineTo(W - pad, footerY + 6);
    ctx.stroke();
    if (procText) {
      ctx.fillStyle = "#aaa";
      ctx.font = "11px Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(procText, W / 2, footerY + 12);
    }
    ctx.fillStyle = "#c0c0c0";
    ctx.font = "italic 10px Arial, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText("ayeahfeminist", W - pad, H - 6);

    return c;
  }

  async function doAction(action: Action) {
    setCopying(action);
    const isData = action === "copy-data" || action === "dl-data";
    const isDownload = action === "dl-data" || action === "dl-figure";
    try {
      const cvs = isData ? dataCanvasRef.current! : buildFigureCanvas();
      if (isDownload) {
        const a = document.createElement("a");
        a.href = cvs.toDataURL("image/png");
        a.download = `${record.label}${isData ? "_data" : "_figure"}.png`;
        a.click();
        showToast(`Downloaded ${isData ? "data" : "figure"}`);
      } else {
        const blob = await new Promise<Blob>((res) => cvs.toBlob((b) => res(b!), "image/png"));
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        showToast(`Copied ${isData ? "data" : "figure"}`);
      }
    } catch (e) {
      console.error(e);
      showToast("Failed ✕");
    } finally {
      setCopying(null);
    }
  }

  return (
    <div className="expanded-view">
      <div className="expanded-header">
        <button className="icon-btn" onClick={onClose} title="Back to grid (Esc)" style={{ marginRight: 4 }}>
          <BackIcon />
        </button>
        <input
          className="card-title-input"
          value={record.label}
          onChange={(e) => onLabelChange(e.target.value)}
          title="Click to rename"
          style={{ fontSize: 15, fontWeight: 700, maxWidth: 220 }}
        />
        {/* copy / download group */}
        <div className="exp-action-group">
          <button className="exp-action-btn" onClick={() => doAction("copy-data")} disabled={copying !== null} title="Copy data image">
            {copying === "copy-data" ? "…" : <CopyIcon />}
            <span>data</span>
          </button>
          <button className="exp-action-btn" onClick={() => doAction("copy-figure")} disabled={copying !== null} title="Copy figure (title + scale bar + stats)">
            {copying === "copy-figure" ? "…" : <CopyIcon />}
            <span>figure</span>
          </button>
          <button className="exp-action-btn" onClick={() => doAction("dl-data")} disabled={copying !== null} title="Download data PNG">
            {copying === "dl-data" ? "…" : <DownloadIcon />}
            <span>data</span>
          </button>
          <button className="exp-action-btn" onClick={() => doAction("dl-figure")} disabled={copying !== null} title="Download figure PNG">
            {copying === "dl-figure" ? "…" : <DownloadIcon />}
            <span>figure</span>
          </button>
        </div>
        <span style={{ fontSize: 11, color: "#bbb", marginLeft: "auto" }}>{record.filename}</span>
      </div>
      <div className="expanded-body">
        <div className="expanded-canvas-area">
          <div className="canvas-and-cb-group">
            <div
              className="card-canvas-wrap expanded-canvas-wrap"
              style={{ position: "relative" }}
              onMouseMove={(e) => {
                const canvas = dataCanvasRef.current;
                if (!canvas) return;
                const r = canvas.getBoundingClientRect();
                const px = (e.clientX - r.left) / r.width;
                const py = (e.clientY - r.top) / r.height;
                const ix = Math.min(record.side - 1, Math.max(0, Math.floor(px * record.side)));
                const iy = Math.min(record.side - 1, Math.max(0, Math.floor(py * record.side)));
                setCursorH({ cx: e.clientX - r.left, cy: e.clientY - r.top, v: record.z[iy * record.side + ix] });
              }}
              onMouseLeave={() => setCursorH(null)}
            >
              <canvas ref={dataCanvasRef} className="data-canvas" />
              <canvas ref={scaleBarCanvasRef} className="scalebar-canvas" />
              <button className="canvas-rotate-btn" onClick={onRotate} title="Rotate 90° clockwise">↻</button>
              {cursorH && (
                <div className="cursor-readout" style={{ left: cursorH.cx, top: cursorH.cy }}>
                  {fmt(cursorH.v)} nm
                </div>
              )}
            </div>
            <Colorbar vmin={-lim} vmax={lim} expanded />
          </div>
        </div>
        <div className="expanded-stats-panel">
          <div className="expanded-stats-title">Analysis</div>
          <StatRow label="Rq" value={`${fmt(record.rms)} nm`}
            info="RMS roughness — root-mean-square of height deviations from mean. Standard roughness metric." />
          {opts.doClip && (
            <StatRow label="Rq*" value={`${fmt(record.rmsClipped)} nm`}
              info={`Sigma-clipped RMS roughness (σ = ${opts.climSigma}). Outlier pixels beyond the color range are excluded, giving a roughness estimate robust to spikes and contamination.`} />
          )}
          <StatRow label="PtP" value={`${fmt(record.ptp)} nm`}
            info="Peak-to-peak height range — difference between the maximum and minimum height values in the image." />
          <StatRow label="Scan" value={`${record.scanUm[0]}×${record.scanUm[1]} µm`}
            info="Physical size of the scanned area in micrometres." />
          <StatRow label="Pixels" value={`${record.side}×${record.side}`}
            info="Raw pixel resolution of the AFM scan." />
        </div>
      </div>
      {toast && <div className={`action-toast${toast.startsWith("Failed") ? " error" : ""}`}>{toast}</div>}
    </div>
  );
}

// ── StatRow ───────────────────────────────────────────────────────────────────

function StatRow({ label, value, info }: { label: string; value: string; info: string }) {
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!pos) return;
    function onClickOutside(e: MouseEvent) {
      if (btnRef.current && !btnRef.current.contains(e.target as Node)) setPos(null);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [pos]);

  function toggle() {
    if (pos) { setPos(null); return; }
    const r = btnRef.current!.getBoundingClientRect();
    // anchor top-right of popup to just left of the button
    setPos({ top: r.top, right: window.innerWidth - r.left + 6 });
  }

  return (
    <div className="stat-row">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      <button ref={btnRef} className="stat-info-btn" onClick={toggle} title={info}>ⓘ</button>
      {pos && createPortal(
        <div className="stat-info-popup" style={{ top: pos.top, right: pos.right }}>
          {info}
        </div>,
        document.body
      )}
    </div>
  );
}

// ── helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number) {
  if (n === 0) return "0";
  const mag = Math.floor(Math.log10(Math.abs(n)));
  return n.toFixed(Math.max(0, 2 - mag));
}

// ── icons ─────────────────────────────────────────────────────────────────────

function DropIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="#aaa" strokeWidth="2">
      <rect x="6" y="6" width="36" height="36" rx="6" strokeDasharray="4 3"/>
      <path d="M24 16v16M16 26l8 8 8-8"/>
    </svg>
  );
}

function BackIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M10 2L4 8l6 6"/>
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
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8 2v9M4 7l4 4 4-4"/>
      <path d="M2 13h12"/>
    </svg>
  );
}

