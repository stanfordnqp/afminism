import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
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
import FeedbackButton from "./FeedbackButton";
import { parseParkTiff } from "./tiff";
import { reprocess, computeRms } from "./processing";
import { computePSD } from "./psd";
import { toImageData, renderScanForExport, drawScaleBar, drawColorbar } from "./colormap";
import Colorbar from "./Colorbar";
import PsdPlot, { drawPsd } from "./PsdPlot";
import PsdSummaryView, { buildPsdSummaryCanvas } from "./PsdSummaryView";
import type { ScanRecord, ProcessingOptions } from "./types";
import { uploadSession, downloadSession } from "./share";
import { loadTestScans } from "./test_loader";

const DEFAULT_OPTS: ProcessingOptions = {
  doPoly: true,
  polyOrder: 1,
  polySigma: 5,
  doLines: true,
  doClip: true,
  climSigma: 5,
  climMin: 0.5,
  climMax: 20,
  columns: 2,
  colormap: "afmhot" as const,
  showPsd: false,
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
  const [sharingState, setSharingState] = useState<"idle" | "uploading" | "copied" | "error" | "full">("idle");
  const [viewMode, setViewMode] = useState<"grid" | "psd">("grid");
  const [psdFigureSize, setPsdFigureSize] = useState<{ w: number; h: number }>({ w: 900, h: 560 });
  const [psdTitle, setPsdTitle] = useState("PSD Summary");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  // ── load from shared link or example scan on first mount ─────────────────
  useEffect(() => {
    const hash = window.location.hash;
    const shareMatch = hash.match(/^#share\/([a-zA-Z0-9_-]+)$/);
    if (shareMatch) {
      const id = shareMatch[1];
      window.history.replaceState(null, "", window.location.pathname);
      downloadSession(id)
        .then(({ scans, opts }) => {
          setScans(scans);
          setOpts(opts);
        })
        .catch((e) => {
          console.error("Failed to load shared session:", e);
          alert("Could not load shared session. The link may have expired.");
        });
      return;
    }

    const base = import.meta.env.BASE_URL ?? "/";
    fetch(`${base}example.tiff`)
      .then((r) => r.arrayBuffer())
      .then((buf) => {
        const { data, side, scanUm, meta } = parseParkTiff(buf, "example.tiff");
        const exampleOpts: ProcessingOptions = { ...DEFAULT_OPTS, doClip: true, climSigma: 2 };
        const z = reprocess(data, side, exampleOpts, 0);
        const { rms, rmsClipped, ptp } = computeRms(z, exampleOpts.climSigma);
        const psd = computePSD(z, side, scanUm);
        const record: ScanRecord = {
          id: uid(), filename: "example.tiff", label: "Example Scan",
          zRaw: data, side, scanUm, rotation: 0, isExample: true,
          z, rms, rmsClipped, ptp, psd, meta,
        };
        setScans([record]);
      })
      .catch((e) => console.warn("Could not load example scan:", e));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── share session ─────────────────────────────────────────────────────────
  async function shareSession() {
    if (!scans.length) return;
    setSharingState("uploading");
    try {
      const id = await uploadSession(scans, opts);
      const url = `${window.location.origin}${window.location.pathname}#share/${id}`;
      await navigator.clipboard.writeText(url);
      setSharingState("copied");
      setTimeout(() => setSharingState("idle"), 2500);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "";
      const isFull = msg.includes("Storage limit");
      console.error("Share failed:", e);
      setSharingState(isFull ? "full" : "error");
      setTimeout(() => setSharingState("idle"), 4000);
    }
  }

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setExpandedId(null);
        if (figureUrl) { URL.revokeObjectURL(figureUrl); setFigureUrl(null); setFigureBlob(null); }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "b") {
        e.preventDefault();
        setSidebarOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [figureUrl]);

  // ── processing ────────────────────────────────────────────────────────────

  function buildRecord(
    id: string, filename: string, label: string,
    zRaw: Float32Array, side: number, scanUm: [number, number],
    rotation: number, o: ProcessingOptions, meta?: string
  ): ScanRecord {
    const z = reprocess(zRaw, side, o, rotation);
    const { rms, rmsClipped, ptp } = computeRms(z, o.climSigma);
    const psd = computePSD(z, side, scanUm);
    return { id, filename, label, zRaw, side, scanUm, rotation, z, rms, rmsClipped, ptp, psd, meta };
  }

  function applyOpts(prevScans: ScanRecord[], newOpts: ProcessingOptions): ScanRecord[] {
    return prevScans.map((s) => {
      const z = reprocess(s.zRaw, s.side, newOpts, s.rotation);
      const { rms, rmsClipped, ptp } = computeRms(z, newOpts.climSigma);
      const psd = computePSD(z, s.side, s.scanUm);
      return { ...s, z, rms, rmsClipped, ptp, psd };
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
        const { data, side, scanUm, meta } = parseParkTiff(buf, file.name);
        const base = file.name.split("_")[0] ?? file.name.replace(/\.[^.]+$/, "");
        const label = base.charAt(0).toUpperCase() + base.slice(1);
        newScans.push(buildRecord(uid(), file.name, label, data, side, scanUm, 0, opts, meta));
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
      const psd = computePSD(z, r.side, r.scanUm);
      return { ...r, rotation, z, rms, rmsClipped, ptp, psd };
    }));
  }

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
    const visible = scans;
    if (!visible.length) return;
    setGeneratingFigure(true);

    if (viewMode === "psd") {
      const canvas = buildPsdSummaryCanvas(visible, psdFigureSize.w, psdFigureSize.h, psdTitle);
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        setFigureUrl(url);
        setFigureBlob(blob);
        setGeneratingFigure(false);
      }, "image/png");
      return;
    }

    const cols = opts.columns;
    const rows = Math.ceil(visible.length / cols);
    const scanSize = 700;
    const titleH = 36;
    const statsH = 46;
    const gap = 20;
    const padding = 24;
    const colorbarW = 62;
    const colorbarGap = 8;
    const psdH = opts.showPsd ? Math.round(scanSize / 2) : 0;

    const cellW = scanSize + colorbarGap + colorbarW;
    const cellH = scanSize + titleH + statsH + psdH;

    const procParts: string[] = [];
    if (opts.doPoly) procParts.push(`Poly leveling order ${opts.polyOrder} (σ = ${opts.polySigma})`);
    if (opts.doLines) procParts.push("Row leveling");
    if (opts.doClip) procParts.push(`Color range ±${opts.climSigma}σ`);
    const procText = procParts.join("  ·  ");
    const footerH = 42;

    const W = cols * cellW + (cols - 1) * gap + 2 * padding;
    const H = rows * cellH + (rows - 1) * gap + 2 * padding + footerH;

    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = W * scale;
    canvas.height = H * scale;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(scale, scale);
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

      const scanCanvas = renderScanForExport(r.z, r.side, r.scanUm, -lim, lim, opts.doClip, scanSize * scale, opts.colormap);
      ctx.drawImage(scanCanvas, x, y + titleH, scanSize, scanSize);

      ctx.save();
      ctx.translate(x + scanSize + colorbarGap, y + titleH);
      drawColorbar(ctx, -lim, lim, colorbarW, scanSize, false, opts.colormap);
      ctx.restore();

      ctx.fillStyle = "#111";
      ctx.font = "bold 18px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(r.label, x + cellW / 2, y + titleH / 2);

      if (opts.showPsd && r.psd) {
        const psdY = y + titleH + scanSize;
        ctx.save();
        ctx.translate(x, psdY);
        drawPsd(ctx, cellW, psdH, [{ freqs: r.psd.freqs, power: r.psd.power, color: "#2196f3", label: r.label }], true);
        ctx.restore();
      }

      const parts = [`${r.scanUm[0]}×${r.scanUm[1]} µm`, `Rq = ${fmt(r.rms)} nm`];
      if (opts.doClip) parts.push(`Rq* = ${fmt(r.rmsClipped)} nm`);
      parts.push(`PtP = ${fmt(r.ptp)} nm`);
      const statsBaseY = y + titleH + scanSize + psdH;
      ctx.fillStyle = "#444";
      ctx.font = "13px Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(parts.join("   "), x + cellW / 2, statsBaseY + 7);
      const fileMeta = r.filename + (r.meta ? " · " + r.meta : "");
      ctx.fillStyle = "#aaa";
      ctx.font = "10px Arial, sans-serif";
      ctx.fillText(fileMeta, x + cellW / 2, statsBaseY + 26);
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
    ctx.fillText("afminism", W - padding, H - 6);

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
        isExpanded={!!expandedRecord}
        viewMode={viewMode}
        onSparklesToggle={() => setSparkles(v => !v)}
      />


      <main className="main">
        {/* ── Expanded single-scan view ── */}
        {expandedRecord ? (
          <ExpandedView
            record={expandedRecord}
            opts={opts}
            onClose={() => setExpandedId(null)}
            onRotate={() => rotateCard(expandedRecord.id)}
            onLabelChange={(l) => labelCard(expandedRecord.id, l)}
            onToggleSidebar={() => setSidebarOpen(v => !v)}
            sidebarOpen={sidebarOpen}
            onGenerateFigure={(blob) => {
              const url = URL.createObjectURL(blob);
              setFigureUrl(url);
              setFigureBlob(blob);
            }}
          />
        ) : (
          <>
            {/* View mode tab bar */}
            {scans.length > 0 && (
              <div className="view-tab-bar">
                <button
                  className="sidebar-toggle sidebar-toggle-inline"
                  onClick={() => setSidebarOpen(v => !v)}
                  title="Toggle sidebar (⌘B)"
                  style={{ display: sidebarOpen ? "none" : undefined }}
                >
                  <SidebarToggleIcon />
                </button>
                {scans.length > 0 && (
                  <div className="view-tab-group">
                    <button
                      className={`view-tab${viewMode === "grid" ? " active" : ""}`}
                      onClick={() => setViewMode("grid")}
                    >Grid</button>
                    <button
                      className={`view-tab${viewMode === "psd" ? " active" : ""}`}
                      onClick={() => setViewMode("psd")}
                    >PSD</button>
                  </div>
                )}
                {scans.length > 0 && (
                  <div className="topbar-actions">
                    <button
                      className="topbar-btn primary"
                      onClick={generateFigure}
                      disabled={generatingFigure}
                    >
                      <FigureIcon />
                      {generatingFigure ? "Generating…" : "Generate figure"}
                    </button>
                    <button
                      className="topbar-btn"
                      onClick={shareSession}
                      disabled={sharingState === "uploading"}
                    >
                      <ShareIcon />
                      {sharingState === "uploading" ? "Uploading…"
                        : sharingState === "copied" ? "Link copied!"
                        : sharingState === "error" ? "Share failed"
                        : sharingState === "full" ? "Storage full"
                        : "Share"}
                    </button>
                  </div>
                )}
              </div>
            )}

            {viewMode === "psd" ? (
              <PsdSummaryView scans={scans} onDrop={loadFiles} onSizeChange={(w, h) => setPsdFigureSize({ w, h })} title={psdTitle} onTitleChange={setPsdTitle} />
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
                    {import.meta.env.DEV && (
                      <button
                        className="add-files-btn-empty dev-load-btn"
                        onClick={async () => {
                          try {
                            const results = await loadTestScans();
                            const newScans = results.map(({ data, side, scanUm, filename, label }) =>
                              buildRecord(uid(), filename, label, data, side, scanUm, 0, opts)
                            );
                            setScans(newScans);
                          } catch (e) {
                            console.error("Failed to load test scans:", e);
                          }
                        }}
                      >
                        Load test scans (dev)
                      </button>
                    )}
                  </div>
                )}

                {scans.length > 0 && (
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
                          onExpand={() => setExpandedId(r.id)}
                          isNew={newIds.has(r.id)}
                          showPsd={opts.showPsd}
                        />
                      ))}
                    </div>
                  </SortableContext>
                )}
              </div>
            )}
          </>
        )}
      </main>

      {/* ── dnd drag overlay ── */}
      {createPortal(
        <DragOverlay>
          {draggingRecord && (
            <div className="dnd-overlay">
              <ScanCard
                record={draggingRecord} opts={opts}
                onRemove={() => {}} onLabelChange={() => {}} onRotate={() => {}} onExpand={() => {}}
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
              <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <button className="icon-btn" onClick={copyFigure} title="Copy PNG"><CopyIcon /></button>
                <button className="icon-btn" onClick={saveFigure} title="Download PNG"><DownloadIcon /></button>
                <button className="icon-btn danger" onClick={closeFigureModal}>✕</button>
              </div>
            </div>
            <div className="figure-modal-preview">
              <ZoomableImage src={figureUrl} />
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

      <FeedbackButton />
      <Sparkles enabled={sparkles} />
      <RainbowTrail enabled={sparkles} />

      <input ref={fileInputRef} type="file" multiple accept=".tiff,.tif" style={{ display: "none" }}
        onChange={(e) => { if (e.target.files) loadFiles(e.target.files); e.target.value = ""; }} />
    </DndContext>
  );
}

// ── Zoomable image (figure preview) ──────────────────────────────────────────

const ZOOM_STEP = 1.25;

function ZoomableImage({ src }: { src: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [scale, setScale] = useState(1);
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const fittedRef = useRef(false);
  const fitScaleRef = useRef(1);

  const fitToContainer = useCallback(() => {
    const img = imgRef.current;
    const container = containerRef.current;
    if (!img || !container || !img.naturalWidth) return;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    if (!cw || !ch) return;
    fittedRef.current = true;
    const s = Math.min(cw / img.naturalWidth, ch / img.naturalHeight, 1);
    fitScaleRef.current = s;
    setScale(s);
  }, []);

  useEffect(() => {
    fittedRef.current = false;
    const img = imgRef.current;
    const container = containerRef.current;
    if (!img || !container) return;
    function tryFit() { if (!fittedRef.current) fitToContainer(); }
    img.addEventListener("load", tryFit);
    const obs = new ResizeObserver(tryFit);
    obs.observe(container);
    tryFit();
    return () => { img.removeEventListener("load", tryFit); obs.disconnect(); };
  }, [src, fitToContainer]);

  // Store zoom origin so useLayoutEffect can fix scroll after scale update
  type ZoomOrigin = { cx: number; cy: number; scrollLeft: number; scrollTop: number; oldScale: number };
  const zoomOriginRef = useRef<ZoomOrigin | null>(null);

  const zoom = useCallback((factor: number, cursorX?: number, cursorY?: number) => {
    const el = containerRef.current;
    if (el && cursorX !== undefined && cursorY !== undefined) {
      zoomOriginRef.current = {
        cx: cursorX, cy: cursorY,
        scrollLeft: el.scrollLeft, scrollTop: el.scrollTop,
        oldScale: scaleRef.current,
      };
    }
    setScale(s => Math.max(fitScaleRef.current * 0.5, Math.min(8, s * factor)));
  }, []);

  // After scale update, adjust scroll so the point under cursor stays fixed
  useLayoutEffect(() => {
    const origin = zoomOriginRef.current;
    const el = containerRef.current;
    const img = imgRef.current;
    if (!origin || !el || !img) return;
    zoomOriginRef.current = null;
    const oldIW = img.naturalWidth * origin.oldScale;
    const oldIH = img.naturalHeight * origin.oldScale;
    const newIW = img.naturalWidth * scaleRef.current;
    const newIH = img.naturalHeight * scaleRef.current;
    // image offset within scroll content (flex-centered when smaller than container)
    const oldOffX = Math.max(0, (el.clientWidth - oldIW) / 2);
    const oldOffY = Math.max(0, (el.clientHeight - oldIH) / 2);
    const newOffX = Math.max(0, (el.clientWidth - newIW) / 2);
    const newOffY = Math.max(0, (el.clientHeight - newIH) / 2);
    // fraction of image under cursor
    const fracX = (origin.scrollLeft + origin.cx - oldOffX) / oldIW;
    const fracY = (origin.scrollTop + origin.cy - oldOffY) / oldIH;
    el.scrollLeft = fracX * newIW + newOffX - origin.cx;
    el.scrollTop  = fracY * newIH + newOffY - origin.cy;
  }, [scale]);

  // Cmd+= zoom in, Cmd+- zoom out (zoom to center)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!e.metaKey && !e.ctrlKey) return;
      if (e.key === "=" || e.key === "+") { e.preventDefault(); zoom(ZOOM_STEP); }
      else if (e.key === "-") { e.preventDefault(); zoom(1 / ZOOM_STEP); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoom]);

  // trackpad pinch (ctrlKey + wheel on Mac) — zoom to cursor
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const rect = el!.getBoundingClientRect();
      const factor = Math.pow(ZOOM_STEP, -e.deltaY / 30);
      zoom(factor, e.clientX - rect.left, e.clientY - rect.top);
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoom]);

  // scaled image size for scroll area
  const iw = (imgRef.current?.naturalWidth ?? 0) * scale;
  const ih = (imgRef.current?.naturalHeight ?? 0) * scale;

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      {/* scroll container */}
      <div
        ref={containerRef}
        style={{ width: "100%", height: "100%", overflow: "auto" }}
      >
        {/* sizing shim so scrollbar appears when image > container */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minWidth: "100%", minHeight: "100%", width: iw || "100%", height: ih || "100%" }}>
          <img
            ref={imgRef}
            src={src}
            alt="figure preview"
            draggable={false}
            style={{ width: iw || undefined, height: ih || undefined, display: "block", userSelect: "none", flexShrink: 0 }}
          />
        </div>
      </div>
      {/* zoom controls */}
      <div style={{ position: "absolute", top: 8, right: 8, display: "flex", flexDirection: "column", gap: 2 }}>
        <button className="icon-btn" onClick={() => zoom(ZOOM_STEP)} title="Zoom in (⌘+)">+</button>
        <button className="icon-btn" onClick={() => zoom(1 / ZOOM_STEP)} title="Zoom out (⌘−)">−</button>
      </div>
    </div>
  );
}

// ── Expanded view (replaces grid when a card is opened) ───────────────────────

function ExpandedView({ record, opts, onClose, onRotate, onLabelChange, onGenerateFigure, onToggleSidebar, sidebarOpen }: {
  record: ScanRecord;
  opts: ProcessingOptions;
  onClose: () => void;
  onRotate: () => void;
  onLabelChange: (l: string) => void;
  onGenerateFigure: (blob: Blob) => void;
  onToggleSidebar: () => void;
  sidebarOpen: boolean;
}) {
  const dataCanvasRef = useRef<HTMLCanvasElement>(null);
  const scaleBarCanvasRef = useRef<HTMLCanvasElement>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const [scanPx, setScanPx] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
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
    const img = toImageData(record.z, record.side, -lim, lim, opts.doClip, opts.colormap);
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

  // Track canvas pixel size so PSD can match width
  useEffect(() => {
    const wrap = canvasWrapRef.current;
    if (!wrap) return;
    const obs = new ResizeObserver(() => setScanPx(wrap.offsetWidth));
    obs.observe(wrap);
    setScanPx(wrap.offsetWidth);
    return () => obs.disconnect();
  }, []);

  function showToast(msg: string) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2000);
  }

  async function doGenerateFigure() {
    setBusy("figure");
    const c = buildFigureCanvas();
    c.toBlob((blob) => {
      if (blob) onGenerateFigure(blob);
      setBusy(null);
    }, "image/png");
  }

  async function doDownload(type: "raw" | "processed") {
    setBusy(type);
    try {
      let c: HTMLCanvasElement;
      if (type === "raw") {
        let rawMax = 0;
        for (let j = 0; j < record.zRaw.length; j++) if (Math.abs(record.zRaw[j]) > rawMax) rawMax = Math.abs(record.zRaw[j]);
        c = renderScanForExport(record.zRaw, record.side, record.scanUm, -rawMax, rawMax, false, record.side, opts.colormap);
      } else {
        c = renderScanForExport(record.z, record.side, record.scanUm, -lim, lim, opts.doClip, record.side, opts.colormap);
      }
      const a = document.createElement("a");
      a.href = c.toDataURL("image/png");
      a.download = `${record.label}_${type}.png`;
      a.click();
      showToast(`Downloaded ${type}`);
    } finally {
      setBusy(null);
    }
  }

  function buildFigureCanvas(): HTMLCanvasElement {
    const scanSize = 700;
    const titleH = 40;
    const statsH = 46;
    const pad = 20;
    const colorbarW = 62;
    const colorbarGap = 8;
    const psdW = opts.showPsd ? Math.round(scanSize * 2 / 3) : 0;
    const psdGap = opts.showPsd ? 16 : 0;

    const procParts: string[] = [];
    if (opts.doPoly) procParts.push(`Poly leveling order ${opts.polyOrder} (σ = ${opts.polySigma})`);
    if (opts.doLines) procParts.push("Row leveling");
    if (opts.doClip) procParts.push(`Color range ±${opts.climSigma}σ`);
    const procText = procParts.join("  ·  ");
    const footerH = 42;

    const subTitleHCalc = opts.showPsd ? 22 : 0;
    const W = 2 * pad + scanSize + colorbarGap + colorbarW + psdGap + psdW;
    const H = 2 * pad + titleH + subTitleHCalc + scanSize + statsH + footerH;
    const scale = 2;
    const c = document.createElement("canvas");
    c.width = W * scale; c.height = H * scale;
    const ctx = c.getContext("2d")!;
    ctx.scale(scale, scale);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);

    const scanBlockW = scanSize + colorbarGap + colorbarW;
    const subTitleH = subTitleHCalc;

    // Main title: centered over whole figure when PSD present, else over scan block
    ctx.fillStyle = "#111";
    ctx.font = "bold 20px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(record.label, W / 2, pad + titleH / 2);

    // Subtitles when PSD is shown
    if (opts.showPsd) {
      ctx.fillStyle = "#333";
      ctx.font = "bold 15px Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Scan", pad + scanBlockW / 2, pad + titleH + subTitleH / 2);
      const psdX = pad + scanBlockW + psdGap;
      ctx.fillText("Radial Power Spectral Density", psdX + psdW / 2, pad + titleH + subTitleH / 2);
    }

    const contentY = pad + titleH + subTitleH;

    const scanCvs = renderScanForExport(record.z, record.side, record.scanUm, -lim, lim, opts.doClip, scanSize * scale, opts.colormap);
    ctx.drawImage(scanCvs, pad, contentY, scanSize, scanSize);

    ctx.save();
    ctx.translate(pad + scanSize + colorbarGap, contentY);
    drawColorbar(ctx, -lim, lim, colorbarW, scanSize, false, opts.colormap);
    ctx.restore();

    const parts = [`${record.scanUm[0]}×${record.scanUm[1]} µm`, `Rq = ${fmt(record.rms)} nm`];
    if (opts.doClip) parts.push(`Rq* = ${fmt(record.rmsClipped)} nm`);
    parts.push(`PtP = ${fmt(record.ptp)} nm`);
    const statsBaseY = contentY + scanSize;
    ctx.fillStyle = "#444";
    ctx.font = "13px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(parts.join("   "), pad + scanBlockW / 2, statsBaseY + 7);
    const fileMeta = record.filename + (record.meta ? " · " + record.meta : "");
    ctx.fillStyle = "#aaa";
    ctx.font = "10px Arial, sans-serif";
    ctx.fillText(fileMeta, pad + scanBlockW / 2, statsBaseY + 26);

    if (opts.showPsd && record.psd) {
      const psdX = pad + scanBlockW + psdGap;
      ctx.save();
      ctx.translate(psdX, contentY);
      drawPsd(ctx, psdW, scanSize, [{ freqs: record.psd.freqs, power: record.psd.power, color: "#2196f3", label: "" }], true);
      ctx.restore();
    }

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
    ctx.fillText("afminism", W - pad, H - 6);

    return c;
  }

  return (
    <div className="expanded-view">
      <div className="expanded-header">
        <button
          className="sidebar-toggle sidebar-toggle-inline"
          onClick={onToggleSidebar}
          title="Expand sidebar (⌘B)"
          style={{ display: sidebarOpen ? "none" : undefined }}
        >
          <SidebarToggleIcon />
        </button>
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
        <div className="topbar-actions">
          <button className="topbar-btn primary" onClick={doGenerateFigure} disabled={busy !== null}>
            <FigureIcon />{busy === "figure" ? "Generating…" : "Generate figure"}
          </button>
          <button className="topbar-btn" onClick={() => doDownload("raw")} disabled={busy !== null} title="Download unprocessed scan data as PNG (no leveling, no clipping)">
            <DownloadIcon />Raw
          </button>
          <button className="topbar-btn" onClick={() => doDownload("processed")} disabled={busy !== null} title="Download processed scan pixels as PNG (leveling + color range applied)">
            <DownloadIcon />Processed
          </button>
        </div>
      </div>

      <div className="expanded-body" style={{
        "--scan-h": opts.showPsd
          ? "min(calc(100vh - 130px), calc((100vw - var(--sidebar-w, 260px) - 315px) * 0.6))"
          : "min(calc(100vh - 130px), calc(100vw - var(--sidebar-w, 260px) - 299px))",
      } as React.CSSProperties}>
        <div className="expanded-canvas-area">
          <div className="expanded-content-row">
            {/* Scan + colorbar */}
            <div className="expanded-scan-row">
              <div
                ref={canvasWrapRef}
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
              <Colorbar vmin={-lim} vmax={lim} expanded colormap={opts.colormap} />
            </div>
            {/* PSD to the right */}
            {opts.showPsd && scanPx > 0 && (
              <div className="expanded-psd-right" style={{ width: Math.round(scanPx * 2 / 3), height: Math.round(scanPx * 2 / 3) }}>
                <PsdPlot freqs={record.psd.freqs} power={record.psd.power} color="#2196f3" showAxes title="Radial Power Spectral Density" />
              </div>
            )}
          </div>
        </div>

        {/* Right stats panel */}
        <div className="expanded-stats-panel">
          {record.filename && (
            <div className="expanded-stats-filename">{record.filename}</div>
          )}
          <div className="expanded-stats-title">Analysis</div>
          {record.meta && (
            <StatRow label="Source" value={record.meta}
              info="Instrument and channel identified from the file metadata." />
          )}
          <StatRow label="Scan" value={`${record.scanUm[0]}×${record.scanUm[1]} µm`}
            info="Physical size of the scanned area in micrometres." />
          <StatRow label="Pixels" value={`${record.side}×${record.side}`}
            info="Raw pixel resolution of the AFM scan." />
          <StatRow label="Rq" value={`${fmt(record.rms)} nm`}
            info="RMS roughness — root-mean-square of height deviations from mean. Standard roughness metric." />
          {opts.doClip && (
            <StatRow label="Rq*" value={`${fmt(record.rmsClipped)} nm`}
              info={`Sigma-clipped RMS roughness (σ = ${opts.climSigma}). Outlier pixels beyond the color range are excluded, giving a roughness estimate robust to spikes and contamination.`} />
          )}
          <StatRow label="PtP" value={`${fmt(record.ptp)} nm`}
            info="Peak-to-peak height range — difference between the maximum and minimum height values in the image." />
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
    // anchor below the row, right-aligned to button
    setPos({ top: r.bottom + 6, right: window.innerWidth - r.right });
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

function FigureIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1" y="1" width="14" height="14" rx="2"/>
      <path d="M1 11l4-4 3 3 3-4 4 5"/>
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="13" cy="3" r="1.5"/><circle cx="13" cy="13" r="1.5"/><circle cx="3" cy="8" r="1.5"/>
      <path d="M4.5 7.1L11.5 3.9M4.5 8.9L11.5 12.1"/>
    </svg>
  );
}

function SidebarToggleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/>
      <line x1="5.5" y1="2.5" x2="5.5" y2="13.5"/>
    </svg>
  );
}

