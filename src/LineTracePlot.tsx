import { useEffect, useRef, useState, useCallback } from "react";
import type { LineTrace } from "./lineprofile";

interface Props {
  traces: LineTrace[];
  showAxes?: boolean;
  title?: string;
}

const MT = 10, MB = 46, ML = 56, MR = 10;

function niceStep(range: number, maxTicks: number): number {
  if (range <= 0) return 1;
  const raw = range / Math.max(1, maxTicks);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * mag;
}

function linTicks(lo: number, hi: number, availPx: number): number[] {
  if (!(hi > lo)) return [lo];
  const maxTicks = Math.max(2, Math.floor(availPx / 44));
  const step = niceStep(hi - lo, maxTicks);
  const ticks: number[] = [];
  const start = Math.ceil(lo / step - 1e-6) * step;
  for (let v = start; v <= hi + step * 1e-6; v += step) {
    ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  }
  return ticks;
}

function fmtTick(v: number): string {
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1);
  if (a >= 1) return v.toFixed(2);
  if (a >= 0.01) return v.toFixed(3);
  return v.toExponential(1);
}

function fmtVal(v: number): string {
  const a = Math.abs(v);
  if (a >= 100) return v.toFixed(1);
  if (a >= 1) return v.toFixed(2);
  if (a >= 0.01) return v.toFixed(3);
  if (a === 0) return "0";
  return v.toExponential(2);
}

export function drawLineTrace(
  ctx: CanvasRenderingContext2D,
  cssW: number,
  cssH: number,
  traces: LineTrace[],
  showAxes: boolean,
  cursorCssX?: number,
  title?: string
) {
  let xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (const t of traces) {
    for (let i = 0; i < t.dist.length; i++) {
      if (t.dist[i] > xMax) xMax = t.dist[i];
      if (t.height[i] < yMin) yMin = t.height[i];
      if (t.height[i] > yMax) yMax = t.height[i];
    }
  }

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, cssW, cssH);
  if (!isFinite(xMax) || xMax <= 0 || !isFinite(yMin)) return;

  // Pad the y-range a touch; guard against a flat trace.
  if (yMax - yMin < 1e-9) { yMax += 0.5; yMin -= 0.5; }
  const yPad = (yMax - yMin) * 0.08;
  yMin -= yPad; yMax += yPad;
  const xMin = 0;

  const titleH = title ? 22 : 0;
  const plotW = cssW - ML - MR;
  const plotH = cssH - MT - MB - titleH;

  const xPx = (d: number) => ML + ((d - xMin) / (xMax - xMin)) * plotW;
  const yPx = (v: number) => MT + titleH + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  if (title) {
    ctx.fillStyle = "#222";
    ctx.font = "bold 13px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(title, cssW / 2, MT + titleH / 2);
  }

  // Grid
  ctx.strokeStyle = "#eee";
  ctx.lineWidth = 1;
  const xTicks = linTicks(xMin, xMax, plotW);
  const yTicks = linTicks(yMin, yMax, plotH);
  for (const d of xTicks) { const x = xPx(d); ctx.beginPath(); ctx.moveTo(x, MT + titleH); ctx.lineTo(x, MT + titleH + plotH); ctx.stroke(); }
  for (const v of yTicks) { const y = yPx(v); ctx.beginPath(); ctx.moveTo(ML, y); ctx.lineTo(ML + plotW, y); ctx.stroke(); }

  // Zero line emphasis (heights are leveled around 0)
  if (yMin < 0 && yMax > 0) {
    ctx.strokeStyle = "#ddd";
    ctx.lineWidth = 1;
    const y0 = yPx(0);
    ctx.beginPath(); ctx.moveTo(ML, y0); ctx.lineTo(ML + plotW, y0); ctx.stroke();
  }

  // Plot border
  ctx.strokeStyle = "#bbb";
  ctx.lineWidth = 1;
  ctx.strokeRect(ML, MT + titleH, plotW, plotH);

  if (showAxes) {
    ctx.fillStyle = "#555";
    ctx.font = "11px Arial, sans-serif";
    ctx.textBaseline = "top";
    ctx.textAlign = "center";
    for (const d of xTicks) ctx.fillText(fmtTick(d), xPx(d), MT + titleH + plotH + 4);
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const v of yTicks) ctx.fillText(fmtTick(v), ML - 4, yPx(v));
    ctx.fillStyle = "#333";
    ctx.font = "12px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText("Distance (µm)", ML + plotW / 2, cssH - 10);
    ctx.save();
    ctx.translate(11, MT + titleH + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = "top";
    ctx.fillText("Height (nm)", 0, 0);
    ctx.restore();
  }

  // Curves
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";
  for (const t of traces) {
    if (t.dist.length === 0) continue;
    ctx.strokeStyle = t.color;
    ctx.beginPath();
    for (let i = 0; i < t.dist.length; i++) {
      const x = xPx(t.dist[i]);
      const y = yPx(t.height[i]);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // Legend
  if (traces.length >= 1 && traces.some(t => t.label)) {
    const lh = 15, lw = 18, pad = 5;
    const maxChars = Math.max(...traces.map(t => t.label.length));
    const boxW = lw + 8 + maxChars * 6.5 + pad * 2;
    const boxH = traces.length * lh + pad * 2;
    const lx = ML + 8, ly = MT + titleH + 8;
    ctx.fillStyle = "rgba(255,255,255,0.88)";
    ctx.strokeStyle = "#ccc";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.rect(lx, ly, boxW, boxH); ctx.fill(); ctx.stroke();
    ctx.font = "10px Arial, sans-serif";
    traces.forEach((t, i) => {
      const y = ly + pad + i * lh + lh / 2;
      ctx.strokeStyle = t.color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(lx + pad, y); ctx.lineTo(lx + pad + lw, y); ctx.stroke();
      ctx.fillStyle = "#333"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
      ctx.fillText(t.label, lx + pad + lw + 4, y);
    });
  }

  // Hover crosshair
  if (cursorCssX !== undefined && cursorCssX >= ML && cursorCssX <= ML + plotW) {
    const targetD = xMin + ((cursorCssX - ML) / plotW) * (xMax - xMin);

    // Nearest sample per trace (only those that reach this distance)
    const snap = traces.map(t => {
      if (t.dist.length === 0 || targetD > t.dist[t.dist.length - 1]) return -1;
      let idx = 0, best = Infinity;
      for (let i = 0; i < t.dist.length; i++) {
        const d = Math.abs(t.dist[i] - targetD);
        if (d < best) { best = d; idx = i; }
      }
      return idx;
    });

    ctx.save();
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(cursorCssX, MT + titleH); ctx.lineTo(cursorCssX, MT + titleH + plotH); ctx.stroke();
    ctx.setLineDash([]);

    for (let si = 0; si < traces.length; si++) {
      const idx = snap[si];
      if (idx < 0) continue;
      ctx.fillStyle = traces[si].color;
      ctx.beginPath(); ctx.arc(xPx(traces[si].dist[idx]), yPx(traces[si].height[idx]), 3.5, 0, Math.PI * 2); ctx.fill();
    }

    const tipLines: string[] = [`d = ${fmtVal(targetD)} µm`];
    for (let si = 0; si < traces.length; si++) {
      const idx = snap[si];
      if (idx < 0) continue;
      const prefix = traces.length > 1 ? `${traces[si].label}: ` : "";
      tipLines.push(`${prefix}${fmtVal(traces[si].height[idx])} nm`);
    }

    ctx.font = "10px Arial, sans-serif";
    const lineH = 14, tipPad = 6;
    const tipW = Math.max(...tipLines.map(l => ctx.measureText(l).width)) + tipPad * 2;
    const tipH = tipLines.length * lineH + tipPad * 2 - 2;
    let tx = cursorCssX + 8;
    let ty = MT + titleH + 8;
    if (tx + tipW > cssW - MR) tx = cursorCssX - tipW - 8;
    if (ty + tipH > MT + titleH + plotH) ty = MT + titleH + plotH - tipH;

    ctx.fillStyle = "rgba(255,255,255,0.93)";
    ctx.strokeStyle = "#bbb";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(tx, ty, tipW, tipH, 3); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#222";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    tipLines.forEach((line, i) => ctx.fillText(line, tx + tipPad, ty + tipPad + i * lineH));
    ctx.restore();
  }
}

export default function LineTracePlot({ traces, showAxes = true, title }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [cursorX, setCursorX] = useState<number | undefined>(undefined);

  const draw = useCallback((cx?: number) => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = c.offsetWidth || 300;
    const cssH = c.offsetHeight || 160;
    c.width = Math.round(cssW * dpr);
    c.height = Math.round(cssH * dpr);
    const ctx = c.getContext("2d")!;
    ctx.scale(dpr, dpr);
    drawLineTrace(ctx, cssW, cssH, traces, showAxes, cx, title);
  }, [traces, showAxes, title]);

  useEffect(() => { draw(cursorX); });

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const cssX = (e.clientX - rect.left) * (e.currentTarget.offsetWidth / rect.width);
    setCursorX(cssX);
  }, []);

  const handleMouseLeave = useCallback(() => setCursorX(undefined), []);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: "100%", height: "100%", display: "block", cursor: "crosshair" }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    />
  );
}
