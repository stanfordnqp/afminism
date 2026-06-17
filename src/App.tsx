import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { reprocess, computeRms, currentDims } from "./processing";
import { computePSD } from "./psd";
import { toImageData, renderScanForExport, drawScaleBar, drawColorbar } from "./colormap";
import Colorbar from "./Colorbar";
import PsdPlot, { drawPsd } from "./PsdPlot";
import PsdSummaryView, { buildPsdSummaryCanvas } from "./PsdSummaryView";
import LineTracePlot, { drawLineTrace } from "./LineTracePlot";
import type { ScanRecord, ProcessingOptions } from "./types";
import type { LineSegment } from "./lineprofile";
import { buildTraces, drawSegments } from "./lineprofile";
import { useLineProfiles } from "./useLineProfiles";
import { uploadSession, downloadSession } from "./share";
import { loadTestScans } from "./test_loader";

const DEFAULT_OPTS: ProcessingOptions = {
  doPoly: false,
  polyOrder: 1,
  polySigma: 5,
  doLines: true,
  lineMethod: "polynomial",
  lineOrder: 2,
  lineSigma: 3,
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
  const [figureToast, setFigureToast] = useState<string | null>(null);
  const figureToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [generatingFigure, setGeneratingFigure] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState<{ done: number; total: number } | null>(null);
  const [sharingState, setSharingState] = useState<"idle" | "uploading" | "copied" | "error" | "full">("idle");
  const [viewMode, setViewMode] = useState<"grid" | "psd">("grid");
  const [psdFigureSize, setPsdFigureSize] = useState<{ w: number; h: number }>({ w: 900, h: 560 });
  const [psdTitle, setPsdTitle] = useState("PSD Summary");
  const [gridZoom, setGridZoom] = useState(1);
  const [dropZoneH, setDropZoneH] = useState(0);
  // Globally selected line-profile segment (one across all cards), so Delete
  // only ever removes one.
  const [selectedSeg, setSelectedSeg] = useState<{ cardId: string; segId: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  // Delete the selected segment with Delete/Backspace (unless typing in a field).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const el = document.activeElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      if (!selectedSeg) return;
      e.preventDefault();
      const { cardId, segId } = selectedSeg;
      setScans((s) => s.map((r) => r.id === cardId ? { ...r, segments: r.segments.filter((sg) => sg.id !== segId) } : r));
      setSelectedSeg(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedSeg]);

  // ── load from shared link on first mount ─────────────────────────────────
  useEffect(() => {
    const hash = window.location.hash;
    const shareMatch = hash.match(/^#share\/([a-zA-Z0-9_-]+)$/);
    if (!shareMatch) return;
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

  // ── grid view: track drop-zone size and bind pinch-zoom ───────────────────
  useEffect(() => {
    const el = dropZoneRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => setDropZoneH(el.clientHeight));
    obs.observe(el);
    setDropZoneH(el.clientHeight);
    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const factor = Math.pow(1.15, -e.deltaY / 30);
      setGridZoom((z) => Math.max(0.3, Math.min(6, z * factor)));
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => { obs.disconnect(); el.removeEventListener("wheel", onWheel); };
  }, [viewMode, expandedId]);

  // Reset zoom when scan count or column count changes — fit to viewport again
  useEffect(() => { setGridZoom(1); }, [scans.length, opts.columns, opts.showPsd]);

  // ── processing ────────────────────────────────────────────────────────────

  function buildRecord(
    id: string, filename: string, label: string,
    zRaw: Float32Array, width: number, height: number, scanUm: [number, number],
    rotation: number, flipX: boolean, o: ProcessingOptions, meta?: string
  ): ScanRecord {
    const z = reprocess(zRaw, width, height, o, rotation, flipX);
    const { rms, rmsClipped, ptp } = computeRms(z, o.climSigma);
    const [curW, curH] = currentDims(width, height, rotation);
    const psd = computePSD(z, curW, curH, scanUm);
    return { id, filename, label, zRaw, width, height, scanUm, rotation, flipX, segments: [], z, rms, rmsClipped, ptp, psd, meta };
  }

  function applyOpts(prevScans: ScanRecord[], newOpts: ProcessingOptions): ScanRecord[] {
    return prevScans.map((s) => {
      const z = reprocess(s.zRaw, s.width, s.height, newOpts, s.rotation, s.flipX);
      const { rms, rmsClipped, ptp } = computeRms(z, newOpts.climSigma);
      const [curW, curH] = currentDims(s.width, s.height, s.rotation);
      const psd = computePSD(z, curW, curH, s.scanUm);
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
    setLoadingFiles({ done: 0, total: arr.length });
    const newScans: ScanRecord[] = [];
    for (let i = 0; i < arr.length; i++) {
      const file = arr[i];
      try {
        const buf = await file.arrayBuffer();
        const { data, width, height, scanUm, meta } = parseParkTiff(buf, file.name);
        const base = file.name.split("_")[0] ?? file.name.replace(/\.[^.]+$/, "");
        const label = base.charAt(0).toUpperCase() + base.slice(1);
        newScans.push(buildRecord(uid(), file.name, label, data, width, height, scanUm, 0, false, opts, meta));
      } catch (e) {
        console.error(`Failed to load ${file.name}:`, e);
        alert(`Could not parse ${file.name}:\n${e}`);
      }
      setLoadingFiles({ done: i + 1, total: arr.length });
    }
    setLoadingFiles(null);
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
  function clearAllScans() {
    setScans([]);
    setExpandedId(null);
    setViewMode("grid");
  }
  function labelCard(id: string, label: string) { setScans((s) => s.map((r) => r.id === id ? { ...r, label } : r)); }
  function rotateCard(id: string) {
    setScans((s) => s.map((r) => {
      if (r.id !== id) return r;
      const rotation = (r.rotation + 90) % 360;
      // Each 90° rotation swaps physical width/height, which flips the aspect
      // ratio and the x/y axes for downstream calcs (PSD, scale bar, display).
      const scanUm: [number, number] = [r.scanUm[1], r.scanUm[0]];
      const z = reprocess(r.zRaw, r.width, r.height, opts, rotation, r.flipX);
      const { rms, rmsClipped, ptp } = computeRms(z, opts.climSigma);
      const [curW, curH] = currentDims(r.width, r.height, rotation);
      const psd = computePSD(z, curW, curH, scanUm);
      // Segments rotate with the image: a 90° CW turn maps (x,y) → (1-y, x).
      const segments = r.segments.map((sg) => ({
        ...sg, x0: 1 - sg.y0, y0: sg.x0, x1: 1 - sg.y1, y1: sg.x1,
      }));
      return { ...r, rotation, scanUm, segments, z, rms, rmsClipped, ptp, psd };
    }));
  }
  function flipCard(id: string) {
    setScans((s) => s.map((r) => {
      if (r.id !== id) return r;
      // Mirror left-right. Pixel grid and scan size are unchanged.
      const flipX = !r.flipX;
      const z = reprocess(r.zRaw, r.width, r.height, opts, r.rotation, flipX);
      const { rms, rmsClipped, ptp } = computeRms(z, opts.climSigma);
      const [curW, curH] = currentDims(r.width, r.height, r.rotation);
      const psd = computePSD(z, curW, curH, r.scanUm);
      // Segments mirror with the image: (x,y) → (1-x, y).
      const segments = r.segments.map((sg) => ({ ...sg, x0: 1 - sg.x0, x1: 1 - sg.x1 }));
      return { ...r, flipX, segments, z, rms, rmsClipped, ptp, psd };
    }));
  }
  function updateSegments(id: string, segments: LineSegment[]) {
    setScans((s) => s.map((r) => r.id === id ? { ...r, segments } : r));
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

    // SCAN_PX is the actual output pixel WIDTH of each scan subplot.
    // Each scan's height = scanW · (scanUm[1] / scanUm[0]) so rectangular
    // scans keep their physical aspect ratio in the figure.
    const SCAN_PX = 1200;
    const k = SCAN_PX / 700;
    const scanW = SCAN_PX;
    const titleH = Math.round(36 * k);
    const statsH = Math.round(46 * k);
    const gap = Math.round(20 * k);
    const padding = Math.round(24 * k);
    const colorbarW = Math.round(62 * k);
    const colorbarGap = Math.round(8 * k);
    const psdH = opts.showPsd ? Math.round(scanW * 0.6) : 0;
    // Reserve a trace row when any card carries line profiles (parity with PSD).
    const anySegments = visible.some((r) => r.segments.length > 0);
    const traceH = anySegments ? Math.round(scanW * 0.6) : 0;

    const procParts: string[] = [];
    if (opts.doLines) procParts.push(
      opts.lineMethod === "polynomial"
        ? `Row leveling poly order ${opts.lineOrder} (σ = ${opts.lineSigma})`
        : "Row leveling (median)"
    );
    if (opts.doPoly) procParts.push(`2D level order ${opts.polyOrder} (σ = ${opts.polySigma})`);
    if (opts.doClip) procParts.push(`Color range ±${opts.climSigma}σ`);
    const procText = procParts.join("  ·  ");
    const footerH = Math.round(42 * k);

    const cellW = scanW + colorbarGap + colorbarW;

    // Per-row scan height = max height across cards in that row
    const rowScanH: number[] = [];
    for (let r = 0; r < rows; r++) {
      let maxH = 0;
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        if (idx >= visible.length) break;
        const sc = visible[idx];
        const h = Math.round(scanW * (sc.scanUm[1] / sc.scanUm[0]));
        if (h > maxH) maxH = h;
      }
      rowScanH.push(maxH);
    }
    const rowH = rowScanH.map((h) => h + titleH + statsH + psdH + traceH);
    const rowY: number[] = [];
    let yAcc = padding;
    for (let r = 0; r < rows; r++) { rowY.push(yAcc); yAcc += rowH[r] + (r < rows - 1 ? gap : 0); }

    const W = cols * cellW + (cols - 1) * gap + 2 * padding;
    const H = yAcc + padding + footerH;

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
      const y = rowY[row];
      const scanH = Math.round(scanW * (r.scanUm[1] / r.scanUm[0]));
      // Top-align scan within its row (rows can have heterogeneous heights)

      let maxAbs = 0;
      for (let j = 0; j < r.z.length; j++) if (Math.abs(r.z[j]) > maxAbs) maxAbs = Math.abs(r.z[j]);
      const lim = opts.doClip ? opts.climSigma * r.rmsClipped : maxAbs || 1;

      const [curW, curH] = currentDims(r.width, r.height, r.rotation);
      const scanCanvas = renderScanForExport(r.z, curW, curH, r.scanUm, -lim, lim, opts.doClip, scanW, opts.colormap);
      ctx.drawImage(scanCanvas, x, y + titleH, scanW, scanH);
      if (r.segments.length) {
        ctx.save();
        ctx.translate(x, y + titleH);
        drawSegments(ctx, scanW, scanH, r.segments, null, k);
        ctx.restore();
      }

      // Colorbar height matches scan height. drawColorbar uses base-700 sizes.
      ctx.save();
      ctx.translate(x + scanW + colorbarGap, y + titleH);
      ctx.scale(k, k);
      drawColorbar(ctx, -lim, lim, 62, scanH / k, false, opts.colormap);
      ctx.restore();

      ctx.fillStyle = "#111";
      ctx.font = `bold ${Math.round(18 * k)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(r.label, x + cellW / 2, y + titleH / 2);

      // PSD sits below the row's max scan height so all PSD panels in a row align
      const rowMaxScanH = rowScanH[row];
      if (opts.showPsd && r.psd) {
        const psdY = y + titleH + rowMaxScanH;
        ctx.save();
        ctx.translate(x, psdY);
        ctx.scale(k, k);
        drawPsd(ctx, cellW / k, psdH / k, [{ freqs: r.psd.freqs, power: r.psd.power, color: "#2196f3", label: r.label }], true);
        ctx.restore();
      }
      // Trace panel below the PSD (blank for cards without segments).
      if (r.segments.length) {
        const traceY = y + titleH + rowMaxScanH + psdH;
        ctx.save();
        ctx.translate(x, traceY);
        ctx.scale(k, k);
        drawLineTrace(ctx, cellW / k, traceH / k, buildTraces(r), true, undefined, "Line profiles");
        ctx.restore();
      }

      const parts = [`${r.scanUm[0]}×${r.scanUm[1]} µm`, `Rq = ${fmt(r.rms)} nm`];
      if (opts.doClip) parts.push(`Rq* = ${fmt(r.rmsClipped)} nm`);
      parts.push(`PtP = ${fmt(r.ptp)} nm`);
      const statsBaseY = y + titleH + rowMaxScanH + psdH + traceH;
      ctx.fillStyle = "#444";
      ctx.font = `${Math.round(13 * k)}px Arial, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(parts.join("   "), x + cellW / 2, statsBaseY + Math.round(7 * k));
      const fileMeta = r.filename + (r.meta ? " · " + r.meta : "");
      ctx.fillStyle = "#aaa";
      ctx.font = `${Math.round(10 * k)}px Arial, sans-serif`;
      ctx.fillText(fileMeta, x + cellW / 2, statsBaseY + Math.round(26 * k));
    });

    // footer
    const footerY = H - footerH;
    ctx.strokeStyle = "#e0e0e0";
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(padding, footerY + Math.round(6 * k)); ctx.lineTo(W - padding, footerY + Math.round(6 * k));
    ctx.stroke();
    if (procText) {
      ctx.fillStyle = "#aaa";
      ctx.font = `${Math.round(11 * k)}px Arial, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(procText, W / 2, footerY + Math.round(12 * k));
    }
    ctx.fillStyle = "#c0c0c0";
    ctx.font = `italic ${Math.round(10 * k)}px Arial, sans-serif`;
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText("afminism", W - padding, H - Math.round(6 * k));

    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      setFigureUrl(url);
      setFigureBlob(blob);
      setGeneratingFigure(false);
    }, "image/png");
  }

  function showFigureToast(msg: string) {
    setFigureToast(msg);
    if (figureToastTimer.current) clearTimeout(figureToastTimer.current);
    figureToastTimer.current = setTimeout(() => setFigureToast(null), 2000);
  }

  async function copyFigure() {
    if (!figureBlob) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": figureBlob })]);
      showFigureToast("Copied to clipboard");
    } catch (e) {
      console.error(e);
      showFigureToast("Failed to copy");
    }
  }

  function saveFigure() {
    if (!figureUrl) return;
    const a = document.createElement("a");
    a.href = figureUrl;
    a.download = "afm_figure.png";
    a.click();
    showFigureToast("Figure downloaded");
  }

  function closeFigureModal() {
    if (figureUrl) URL.revokeObjectURL(figureUrl);
    setFigureUrl(null);
    setFigureBlob(null);
  }

  const draggingRecord = scans.find((s) => s.id === dragging);
  const expandedRecord = expandedId ? scans.find((s) => s.id === expandedId) ?? null : null;

  // Compute card canvas WIDTH so the grid fits vertically at zoom=1.
  // Total card height = scanH + (PSD panel = 0.6·width if on) + chrome.
  // scanH = width · maxAspect across scans so the tallest tile still fits.
  const gridRows = scans.length > 0 ? Math.ceil(scans.length / opts.columns) : 1;
  const chromeOverhead = 90 + 16; // header + stats + filename + inter-card gap
  const psdFactor = opts.showPsd ? 0.6 : 0; // matches CSS .psd-panel height
  // Trace panels are intentionally NOT reserved here: they appear on draw and
  // the grid scrolls, so the canvas never resizes mid-draw.
  const maxAspect = scans.length > 0
    ? Math.max(...scans.map((s) => s.scanUm[1] / s.scanUm[0]))
    : 1;
  const availPerRow = (dropZoneH - 32) / gridRows - chromeOverhead;
  // availPerRow = baseW · maxAspect + baseW · psdFactor → baseW = availPerRow / (maxAspect + psdFactor)
  const baseCanvasSize = Math.max(180, Math.floor(availPerRow / (maxAspect + psdFactor)));
  const cardCanvasSize = Math.round(baseCanvasSize * gridZoom);

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
            onFlip={() => flipCard(expandedRecord.id)}
            onSegmentsChange={(segs) => updateSegments(expandedRecord.id, segs)}
            selectedSegId={selectedSeg?.cardId === expandedRecord.id ? selectedSeg.segId : null}
            onSelectSeg={(segId) => setSelectedSeg(segId ? { cardId: expandedRecord.id, segId } : null)}
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
            <div className="view-tab-bar">
              <button
                className="sidebar-toggle sidebar-toggle-inline"
                onClick={() => setSidebarOpen(v => !v)}
                title="Toggle sidebar (⌘B)"
                style={{ display: sidebarOpen ? "none" : undefined }}
              >
                <SidebarToggleIcon />
              </button>
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
                  <button
                    className="topbar-btn danger"
                    onClick={clearAllScans}
                    title="Remove all scans"
                  >
                    <TrashIcon />
                    Clear all
                  </button>
                </div>
              )}
            </div>

            {viewMode === "psd" && scans.length > 0 ? (
              <PsdSummaryView scans={scans} onDrop={loadFiles} onSizeChange={(w, h) => setPsdFigureSize({ w, h })} title={psdTitle} onTitleChange={setPsdTitle} />
            ) : (
              <div
                ref={dropZoneRef}
                className={`drop-zone${dragOver ? " drag-over" : ""}`}
                onDragEnter={onDragEnter}
                onDragLeave={onDragLeave}
                onDragOver={onDragOver}
                onDrop={onDrop}
              >
                {scans.length === 0 && (
                  <div className="empty-hint">
                    <DropIcon />
                    <p>Drop AFM files here</p>
                    <button className="add-files-btn-empty" onClick={() => fileInputRef.current?.click()}>
                      Browse files
                    </button>
                    <button
                      className="add-files-btn-empty dev-load-btn"
                      onClick={async () => {
                        try {
                          const results = await loadTestScans();
                          const newScans = results.map(({ data, width, height, scanUm, filename, label }) =>
                            buildRecord(uid(), filename, label, data, width, height, scanUm, 0, false, opts)
                          );
                          setScans(newScans);
                        } catch (e) {
                          console.error("Failed to load example scans:", e);
                        }
                      }}
                    >
                      Load example scans
                    </button>
                  </div>
                )}

                {scans.length > 0 && (
                  <SortableContext items={scans.map((s) => s.id)} strategy={rectSortingStrategy}>
                    <div className="card-grid" style={{
                      "--cols": opts.columns,
                      "--card-canvas-size": `${cardCanvasSize}px`,
                    } as React.CSSProperties}>
                      {scans.map((r) => (
                        <ScanCard
                          key={r.id}
                          record={r}
                          opts={opts}
                          onRemove={() => removeCard(r.id)}
                          onLabelChange={(l) => labelCard(r.id, l)}
                          onRotate={() => rotateCard(r.id)}
                          onFlip={() => flipCard(r.id)}
                          onExpand={() => setExpandedId(r.id)}
                          onSegmentsChange={(segs) => updateSegments(r.id, segs)}
                          selectedSegId={selectedSeg?.cardId === r.id ? selectedSeg.segId : null}
                          onSelectSeg={(segId) => setSelectedSeg(segId ? { cardId: r.id, segId } : null)}
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
                onRemove={() => {}} onLabelChange={() => {}} onRotate={() => {}} onFlip={() => {}} onExpand={() => {}}
                onSegmentsChange={() => {}} selectedSegId={null} onSelectSeg={() => {}}
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
            {figureToast && (
              <div className={`action-toast${figureToast.startsWith("Failed") ? " error" : ""}`}>{figureToast}</div>
            )}
          </div>
        </div>,
        document.body
      )}

      {/* ── loading banner ── */}
      {loadingFiles && (
        <div className="loading-banner">
          <span className="loading-spinner" />
          Processing {loadingFiles.done} / {loadingFiles.total} file{loadingFiles.total !== 1 ? "s" : ""}…
        </div>
      )}

      {/* ── grid zoom controls (grid view only, when scans loaded) ── */}
      {!expandedRecord && viewMode === "grid" && scans.length > 0 && (
        <div className="grid-zoom-controls">
          <button
            className="icon-btn"
            onClick={() => setGridZoom((z) => Math.min(6, z * 1.2))}
            title="Zoom in"
          >+</button>
          <button
            className="icon-btn"
            onClick={() => setGridZoom((z) => Math.max(0.3, z / 1.2))}
            title="Zoom out"
          >−</button>
          <button
            className="icon-btn"
            onClick={() => setGridZoom(1)}
            title="Fit to view"
          >⊡</button>
        </div>
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

function ExpandedView({ record, opts, onClose, onRotate, onFlip, onSegmentsChange, selectedSegId, onSelectSeg, onLabelChange, onGenerateFigure, onToggleSidebar, sidebarOpen }: {
  record: ScanRecord;
  opts: ProcessingOptions;
  onClose: () => void;
  onRotate: () => void;
  onFlip: () => void;
  onSegmentsChange: (segs: LineSegment[]) => void;
  selectedSegId: string | null;
  onSelectSeg: (id: string | null) => void;
  onLabelChange: (l: string) => void;
  onGenerateFigure: (blob: Blob) => void;
  onToggleSidebar: () => void;
  sidebarOpen: boolean;
}) {
  const dataCanvasRef = useRef<HTMLCanvasElement>(null);
  const scaleBarCanvasRef = useRef<HTMLCanvasElement>(null);
  const lineCanvasRef = useRef<HTMLCanvasElement>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const [areaSize, setAreaSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [cursorH, setCursorH] = useState<{ cx: number; cy: number; v: number } | null>(null);

  const { traces, hasSegments, showTracePlot, cursor, onCanvasMouseDown, onHoverMove, onHoverLeave, clearTraces } =
    useLineProfiles({
      record, onSegmentsChange, dataCanvasRef, lineCanvasRef,
      selectedSegId, onSelectSeg, showPsd: opts.showPsd, enableSuppress: true,
    });

  let maxAbs = 0;
  for (let j = 0; j < record.z.length; j++) if (Math.abs(record.z[j]) > maxAbs) maxAbs = Math.abs(record.z[j]);
  const lim = opts.doClip ? opts.climSigma * record.rmsClipped : maxAbs || 1;

  // Current (post-rotation) pixel grid dimensions of record.z
  const [curW, curH] = currentDims(record.width, record.height, record.rotation);

  useEffect(() => {
    const canvas = dataCanvasRef.current;
    if (!canvas) return;
    canvas.width = curW;
    canvas.height = curH;
    const img = toImageData(record.z, curW, curH, -lim, lim, opts.doClip, opts.colormap);
    canvas.getContext("2d")!.putImageData(img, 0, 0);
  }, [record.z, curW, curH, lim, opts.doClip]);

  useEffect(() => {
    const data = dataCanvasRef.current;
    const sb = scaleBarCanvasRef.current;
    if (!data || !sb) return;
    function draw() {
      if (!data || !sb) return;
      const dpr = window.devicePixelRatio || 1;
      const w = data.clientWidth;
      const h = data.clientHeight;
      if (!w || !h) return;
      sb.width = Math.round(w * dpr);
      sb.height = Math.round(h * dpr);
      const ctx = sb.getContext("2d")!;
      ctx.clearRect(0, 0, sb.width, sb.height);
      ctx.save();
      ctx.scale(dpr, dpr);
      drawScaleBar(ctx, record.scanUm[0], w, h);
      ctx.restore();
    }
    const obs = new ResizeObserver(draw);
    obs.observe(data);
    draw();
    return () => obs.disconnect();
  }, [record.scanUm]);

  // Track available area in the expanded view so we can size scan + PSD to fit
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => {
      setAreaSize({ w: el.clientWidth, h: el.clientHeight });
    });
    obs.observe(el);
    setAreaSize({ w: el.clientWidth, h: el.clientHeight });
    return () => obs.disconnect();
  }, []);

  // Compute scan dimensions to fit the available area without scrolling.
  // Layout: [scan (W×H)] [colorbar 62] [gap 16] [right column (width = scanH)].
  // The right column holds the PSD and/or line-trace plot, stacked. It's reserved
  // whenever either is present.
  const showRight = opts.showPsd || showTracePlot;
  const aspect = record.scanUm[0] / record.scanUm[1];
  const colorbarSlot = 62 + 12; // colorbar width + gap to scan
  const rightSlot = showRight ? 16 : 0; // gap to right column; column width = scanH
  const innerW = Math.max(0, areaSize.w - 16);
  const innerH = Math.max(0, areaSize.h - 16);
  // scan_h * aspect + colorbarSlot + rightSlot + (showRight ? scan_h : 0) ≤ innerW
  const horizDivisor = aspect + (showRight ? 1 : 0);
  const fromW = (innerW - colorbarSlot - rightSlot) / horizDivisor;
  const scanH = Math.max(80, Math.floor(Math.min(innerH, fromW)));
  const scanW = Math.round(scanH * aspect);
  const rightW = scanH; // right column width

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
      // Use 1200 px width — height follows scan aspect inside renderScanForExport.
      const exportW = 1200;
      let c: HTMLCanvasElement;
      if (type === "raw") {
        let rawMax = 0;
        for (let j = 0; j < record.zRaw.length; j++) if (Math.abs(record.zRaw[j]) > rawMax) rawMax = Math.abs(record.zRaw[j]);
        // Raw data is unrotated; use its native pixel grid and scan orientation.
        const rawScanUm: [number, number] = record.rotation % 180 === 90
          ? [record.scanUm[1], record.scanUm[0]] : record.scanUm;
        c = renderScanForExport(record.zRaw, record.width, record.height, rawScanUm, -rawMax, rawMax, false, exportW, opts.colormap);
      } else {
        c = renderScanForExport(record.z, curW, curH, record.scanUm, -lim, lim, opts.doClip, exportW, opts.colormap);
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
    const SCAN_PX = 1200;
    const k = SCAN_PX / 700;
    const scanW = SCAN_PX;
    const scanH = Math.round(scanW * (record.scanUm[1] / record.scanUm[0]));
    const titleH = Math.round(40 * k);
    const statsH = Math.round(46 * k);
    const pad = Math.round(20 * k);
    const colorbarW = Math.round(62 * k);
    const colorbarGap = Math.round(8 * k);
    // Right column: PSD and/or line-profile plot, stacked, sized to scan height.
    const rightPanels: Array<"psd" | "trace"> = [];
    if (opts.showPsd) rightPanels.push("psd");
    if (hasSegments) rightPanels.push("trace");
    const showRight = rightPanels.length > 0;
    const rightW = showRight ? Math.min(scanH, scanW) : 0;
    const rightGap = showRight ? Math.round(16 * k) : 0;
    const panelGap = rightPanels.length > 1 ? Math.round(14 * k) : 0;
    const panelH = showRight ? (scanH - (rightPanels.length - 1) * panelGap) / rightPanels.length : 0;

    const procParts: string[] = [];
    if (opts.doLines) procParts.push(
      opts.lineMethod === "polynomial"
        ? `Row leveling poly order ${opts.lineOrder} (σ = ${opts.lineSigma})`
        : "Row leveling (median)"
    );
    if (opts.doPoly) procParts.push(`2D level order ${opts.polyOrder} (σ = ${opts.polySigma})`);
    if (opts.doClip) procParts.push(`Color range ±${opts.climSigma}σ`);
    const procText = procParts.join("  ·  ");
    const footerH = Math.round(42 * k);

    const subTitleHCalc = showRight ? Math.round(22 * k) : 0;
    const W = 2 * pad + scanW + colorbarGap + colorbarW + rightGap + rightW;
    const H = 2 * pad + titleH + subTitleHCalc + scanH + statsH + footerH;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);

    const scanBlockW = scanW + colorbarGap + colorbarW;
    const subTitleH = subTitleHCalc;

    ctx.fillStyle = "#111";
    ctx.font = `bold ${Math.round(20 * k)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(record.label, W / 2, pad + titleH / 2);

    if (showRight) {
      ctx.fillStyle = "#333";
      ctx.font = `bold ${Math.round(15 * k)}px Arial, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Scan", pad + scanBlockW / 2, pad + titleH + subTitleH / 2);
    }

    const contentY = pad + titleH + subTitleH;

    const scanCvs = renderScanForExport(record.z, curW, curH, record.scanUm, -lim, lim, opts.doClip, scanW, opts.colormap);
    ctx.drawImage(scanCvs, pad, contentY, scanW, scanH);

    // Draw the line-profile segments on top of the exported scan.
    if (hasSegments) {
      ctx.save();
      ctx.translate(pad, contentY);
      drawSegments(ctx, scanW, scanH, record.segments, null, k);
      ctx.restore();
    }

    // Colorbar height matches scan height
    ctx.save();
    ctx.translate(pad + scanW + colorbarGap, contentY);
    ctx.scale(k, k);
    drawColorbar(ctx, -lim, lim, 62, scanH / k, false, opts.colormap);
    ctx.restore();

    const parts = [`${record.scanUm[0]}×${record.scanUm[1]} µm`, `Rq = ${fmt(record.rms)} nm`];
    if (opts.doClip) parts.push(`Rq* = ${fmt(record.rmsClipped)} nm`);
    parts.push(`PtP = ${fmt(record.ptp)} nm`);
    const statsBaseY = contentY + scanH;
    ctx.fillStyle = "#444";
    ctx.font = `${Math.round(13 * k)}px Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(parts.join("   "), pad + scanBlockW / 2, statsBaseY + Math.round(7 * k));
    const fileMeta = record.filename + (record.meta ? " · " + record.meta : "");
    ctx.fillStyle = "#aaa";
    ctx.font = `${Math.round(10 * k)}px Arial, sans-serif`;
    ctx.fillText(fileMeta, pad + scanBlockW / 2, statsBaseY + Math.round(26 * k));

    rightPanels.forEach((kind, idx) => {
      const rightX = pad + scanBlockW + rightGap;
      const panelY = contentY + idx * (panelH + panelGap);
      ctx.save();
      ctx.translate(rightX, panelY);
      ctx.scale(k, k);
      if (kind === "psd" && record.psd) {
        drawPsd(ctx, rightW / k, panelH / k, [{ freqs: record.psd.freqs, power: record.psd.power, color: "#2196f3", label: "" }], true, undefined, "Radial PSD");
      } else if (kind === "trace") {
        drawLineTrace(ctx, rightW / k, panelH / k, traces, true, undefined, "Line profiles");
      }
      ctx.restore();
    });

    const footerY = H - footerH;
    ctx.strokeStyle = "#e0e0e0";
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(pad, footerY + Math.round(6 * k)); ctx.lineTo(W - pad, footerY + Math.round(6 * k));
    ctx.stroke();
    if (procText) {
      ctx.fillStyle = "#aaa";
      ctx.font = `${Math.round(11 * k)}px Arial, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(procText, W / 2, footerY + Math.round(12 * k));
    }
    ctx.fillStyle = "#c0c0c0";
    ctx.font = `italic ${Math.round(10 * k)}px Arial, sans-serif`;
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText("afminism", W - pad, H - Math.round(6 * k));

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
        "--scan-h": `${scanH}px`,
      } as React.CSSProperties}>
        <div className="expanded-canvas-area" ref={areaRef}>
          <div className="expanded-content-row">
            {/* Scan + colorbar */}
            <div className="expanded-scan-row">
              <div
                ref={canvasWrapRef}
                className="card-canvas-wrap expanded-canvas-wrap"
                style={{ position: "relative", width: scanW, height: scanH, cursor }}
                onMouseDown={onCanvasMouseDown}
                onMouseMove={(e) => {
                  const canvas = dataCanvasRef.current;
                  if (!canvas) return;
                  const r = canvas.getBoundingClientRect();
                  const px = (e.clientX - r.left) / r.width;
                  const py = (e.clientY - r.top) / r.height;
                  const ix = Math.min(curW - 1, Math.max(0, Math.floor(px * curW)));
                  const iy = Math.min(curH - 1, Math.max(0, Math.floor(py * curH)));
                  setCursorH({ cx: e.clientX - r.left, cy: e.clientY - r.top, v: record.z[iy * curW + ix] });
                  onHoverMove(e.clientX, e.clientY);
                }}
                onMouseLeave={() => { setCursorH(null); onHoverLeave(); }}
              >
                <canvas
                  ref={dataCanvasRef}
                  className="data-canvas"
                />
                <canvas ref={scaleBarCanvasRef} className="scalebar-canvas" />
                <canvas ref={lineCanvasRef} className="lineprofile-canvas" />
                {hasSegments && (
                  <button
                    className="canvas-clear-traces-btn"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={clearTraces}
                    title="Clear all line profiles"
                  >
                    <TrashIcon />
                  </button>
                )}
                <button className="canvas-flip-btn" onMouseDown={(e) => e.stopPropagation()} onClick={onFlip} title="Flip horizontally">⇄</button>
                <button className="canvas-rotate-btn" onMouseDown={(e) => e.stopPropagation()} onClick={onRotate} title="Rotate 90° clockwise">↻</button>
                {cursorH && (
                  <div className="cursor-readout" style={{ left: cursorH.cx, top: cursorH.cy }}>
                    {fmt(cursorH.v)} nm
                  </div>
                )}
              </div>
              <Colorbar vmin={-lim} vmax={lim} expanded colormap={opts.colormap} />
            </div>
            {/* Right column — PSD and/or line-profile plot, stacked, sized to scan height */}
            {showRight && scanH > 0 && (
              <div className="expanded-right-col" style={{ width: rightW, height: scanH }}>
                {opts.showPsd && (
                  <div className="expanded-plot-panel">
                    <PsdPlot freqs={record.psd.freqs} power={record.psd.power} color="#2196f3" showAxes title="Radial Power Spectral Density" />
                  </div>
                )}
                {showTracePlot && (
                  <div className="expanded-plot-panel">
                    <LineTracePlot traces={traces} showAxes title="Line profiles" />
                  </div>
                )}
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
          <StatRow label="Pixels" value={`${curW}×${curH}`}
            info="Pixel resolution of the AFM scan (columns × rows)." />
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

function TrashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 4h12M6 4V2h4v2M5 4v9a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V4"/>
    </svg>
  );
}

