import { useEffect, useRef, useState, useCallback } from "react";

export interface PsdSeries {
  freqs: Float32Array;
  power: Float32Array;
  color: string;
  label: string;
}

interface Props {
  freqs: Float32Array;
  power: Float32Array;
  color?: string;
  showAxes?: boolean;
  allSeries?: PsdSeries[];
  title?: string;
}

const MT = 10, MB = 46, ML = 50, MR = 10;

function logTicks(lo: number, hi: number, availPx: number): number[] {
  const minSpacingPx = 32;
  const logLo = Math.floor(Math.log10(lo));
  const logHi = Math.ceil(Math.log10(hi));
  const logRange = logHi - logLo;
  const pxPerDecade = availPx / logRange;

  let multipliers: number[];
  let decadeStep: number;
  if (pxPerDecade >= minSpacingPx * 3) { multipliers = [1, 2, 5]; decadeStep = 1; }
  else if (pxPerDecade >= minSpacingPx) { multipliers = [1, 5]; decadeStep = 1; }
  else if (pxPerDecade >= minSpacingPx / 2) { multipliers = [1]; decadeStep = 1; }
  else if (pxPerDecade >= minSpacingPx / 4) { multipliers = [1]; decadeStep = 2; }
  else { multipliers = [1]; decadeStep = 3; }

  const ticks: number[] = [];
  for (let e = logLo; e <= logHi; e += decadeStep) {
    for (const m of multipliers) {
      const v = m * Math.pow(10, e);
      if (v >= lo * 0.99 && v <= hi * 1.01) ticks.push(v);
    }
  }
  return ticks;
}

const SUPERSCRIPT: Record<string, string> = {
  "0":"⁰","1":"¹","2":"²","3":"³","4":"⁴","5":"⁵","6":"⁶","7":"⁷","8":"⁸","9":"⁹","-":"⁻"
};
function toSup(n: number): string {
  return String(n).split("").map(c => SUPERSCRIPT[c] ?? c).join("");
}

function fmtTick(v: number): string {
  if (v >= 0.01 && v < 1000) return parseFloat(v.toPrecision(1)).toString();
  return `10${toSup(Math.round(Math.log10(v)))}`;
}

function fmtVal(v: number): string {
  if (v >= 100) return v.toFixed(0);
  if (v >= 1) return v.toFixed(2);
  if (v >= 0.01) return v.toFixed(4);
  return v.toExponential(2);
}

export function drawPsd(
  ctx: CanvasRenderingContext2D,
  cssW: number,
  cssH: number,
  series: PsdSeries[],
  showAxes: boolean,
  cursorCssX?: number,
  title?: string
) {
  let fMin = Infinity, fMax = -Infinity, pMin = Infinity, pMax = -Infinity;
  for (const s of series) {
    for (let i = 0; i < s.freqs.length; i++) {
      if (s.freqs[i] > 0 && s.power[i] > 0) {
        if (s.freqs[i] < fMin) fMin = s.freqs[i];
        if (s.freqs[i] > fMax) fMax = s.freqs[i];
        if (s.power[i] < pMin) pMin = s.power[i];
        if (s.power[i] > pMax) pMax = s.power[i];
      }
    }
  }
  if (!isFinite(fMin) || fMin <= 0 || pMin <= 0) return;

  const titleH = title ? 22 : 0;
  const logFMin = Math.log10(fMin);
  const logFMax = Math.log10(fMax);
  const logPMin = Math.floor(Math.log10(pMin)) - 0.2;
  const logPMax = Math.ceil(Math.log10(pMax)) + 0.2;
  const plotW = cssW - ML - MR;
  const plotH = cssH - MT - MB - titleH;

  function xPx(f: number) { return ML + ((Math.log10(f) - logFMin) / (logFMax - logFMin)) * plotW; }
  function yPx(p: number) { return MT + titleH + plotH - ((Math.log10(p) - logPMin) / (logPMax - logPMin)) * plotH; }

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, cssW, cssH);

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
  const fTicks = logTicks(fMin, fMax, plotW);
  const pTicks = logTicks(Math.pow(10, logPMin), Math.pow(10, logPMax), plotH);
  for (const f of fTicks) { const x = xPx(f); ctx.beginPath(); ctx.moveTo(x, MT + titleH); ctx.lineTo(x, MT + titleH + plotH); ctx.stroke(); }
  for (const p of pTicks) { const y = yPx(p); ctx.beginPath(); ctx.moveTo(ML, y); ctx.lineTo(ML + plotW, y); ctx.stroke(); }

  // Plot border
  ctx.strokeStyle = "#bbb";
  ctx.lineWidth = 1;
  ctx.strokeRect(ML, MT + titleH, plotW, plotH);

  if (showAxes) {
    ctx.fillStyle = "#555";
    ctx.font = "11px Arial, sans-serif";
    ctx.textBaseline = "top";
    ctx.textAlign = "center";
    for (const f of fTicks) ctx.fillText(fmtTick(f), xPx(f), MT + titleH + plotH + 4);
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const p of pTicks) ctx.fillText(fmtTick(p), ML - 4, yPx(p));
    ctx.fillStyle = "#333";
    ctx.font = "12px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText("Spatial frequency (µm⁻¹)", ML + plotW / 2, cssH - 10);
    ctx.save();
    ctx.translate(11, MT + titleH + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = "top";
    ctx.fillText("PSD (nm²·µm²)", 0, 0);
    ctx.restore();
  }

  // Curves
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";
  for (const s of series) {
    ctx.strokeStyle = s.color;
    ctx.beginPath();
    let penDown = false;
    for (let i = 0; i < s.freqs.length; i++) {
      if (s.freqs[i] <= 0 || s.power[i] <= 0) { penDown = false; continue; }
      const x = xPx(s.freqs[i]);
      const y = yPx(s.power[i]);
      if (!penDown) { ctx.moveTo(x, y); penDown = true; } else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // Legend (always shown)
  if (series.length >= 1 && series.some(s => s.label)) {
    const lh = 15, lw = 18, pad = 5;
    const maxChars = Math.max(...series.map(s => s.label.length));
    const boxW = lw + 8 + maxChars * 6.5 + pad * 2;
    const boxH = series.length * lh + pad * 2;
    const lx = ML + 8, ly = MT + titleH + plotH - boxH - 8;
    ctx.fillStyle = "rgba(255,255,255,0.88)";
    ctx.strokeStyle = "#ccc";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.rect(lx, ly, boxW, boxH); ctx.fill(); ctx.stroke();
    ctx.font = "10px Arial, sans-serif";
    series.forEach((s, i) => {
      const y = ly + pad + i * lh + lh / 2;
      ctx.strokeStyle = s.color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(lx + pad, y); ctx.lineTo(lx + pad + lw, y); ctx.stroke();
      ctx.fillStyle = "#333"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
      ctx.fillText(s.label, lx + pad + lw + 4, y);
    });
  }

  // Hover crosshair
  if (cursorCssX !== undefined && cursorCssX >= ML && cursorCssX <= ML + plotW) {
    // Find the frequency at this x position
    const logF = logFMin + ((cursorCssX - ML) / plotW) * (logFMax - logFMin);
    const targetF = Math.pow(10, logF);

    // Find nearest index in first series
    const ref = series[0].freqs;
    let nearestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < ref.length; i++) {
      if (ref[i] <= 0) continue;
      const d = Math.abs(Math.log10(ref[i]) - logF);
      if (d < bestDist) { bestDist = d; nearestIdx = i; }
    }
    const snapF = ref[nearestIdx];
    const snapX = xPx(snapF);

    // Vertical line
    ctx.save();
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(snapX, MT + titleH); ctx.lineTo(snapX, MT + titleH + plotH); ctx.stroke();
    ctx.setLineDash([]);

    // Dots on each curve
    for (const s of series) {
      if (s.power[nearestIdx] <= 0) continue;
      const y = yPx(s.power[nearestIdx]);
      ctx.fillStyle = s.color;
      ctx.beginPath(); ctx.arc(snapX, y, 3.5, 0, Math.PI * 2); ctx.fill();
    }

    // Tooltip
    const tipLines: string[] = [`f = ${fmtVal(snapF)} µm⁻¹`];
    for (const s of series) {
      const p = s.power[nearestIdx];
      if (p <= 0) continue;
      const prefix = series.length > 1 ? `${s.label}: ` : "";
      tipLines.push(`${prefix}${fmtVal(p)} nm²·µm²`);
    }

    ctx.font = "10px Arial, sans-serif";
    const lineH = 14;
    const tipPad = 6;
    const tipW = Math.max(...tipLines.map(l => ctx.measureText(l).width)) + tipPad * 2;
    const tipH = tipLines.length * lineH + tipPad * 2 - 2;

    let tx = snapX + 8;
    let ty = MT + titleH + 8;
    if (tx + tipW > cssW - MR) tx = snapX - tipW - 8;
    if (ty + tipH > MT + plotH) ty = MT + plotH - tipH;

    ctx.fillStyle = "rgba(255,255,255,0.93)";
    ctx.strokeStyle = "#bbb";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(tx, ty, tipW, tipH, 3); ctx.fill(); ctx.stroke();

    ctx.fillStyle = "#222";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    tipLines.forEach((line, i) => {
      ctx.fillText(line, tx + tipPad, ty + tipPad + i * lineH);
    });

    ctx.restore();

    // suppress unused warning for targetF
    void targetF;
  }
}

export default function PsdPlot({ freqs, power, color = "#2196f3", showAxes = true, allSeries, title }: Props) {
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
    const series = allSeries ?? [{ freqs, power, color, label: "" }];
    drawPsd(ctx, cssW, cssH, series, showAxes, cx, title);
  }, [freqs, power, color, showAxes, allSeries, title]);

  useEffect(() => { draw(cursorX); });

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const cssX = (e.clientX - rect.left) * (e.currentTarget.offsetWidth / rect.width);
    setCursorX(cssX);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setCursorX(undefined);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: "100%", height: "100%", display: "block", cursor: "crosshair" }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    />
  );
}
