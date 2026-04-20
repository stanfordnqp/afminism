import { useEffect, useRef } from "react";

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
}

const MT = 10, MB = 32, ML = 50, MR = 10;

function logTicks(lo: number, hi: number): number[] {
  const ticks: number[] = [];
  const logLo = Math.floor(Math.log10(lo));
  const logHi = Math.ceil(Math.log10(hi));
  for (let e = logLo; e <= logHi; e++) {
    for (const m of [1, 2, 5]) {
      const v = m * Math.pow(10, e);
      if (v >= lo * 0.99 && v <= hi * 1.01) ticks.push(v);
    }
  }
  return ticks;
}

function fmtTick(v: number): string {
  if (v >= 0.01 && v < 1000) return parseFloat(v.toPrecision(1)).toString();
  return `10^${Math.round(Math.log10(v))}`;
}

export function drawPsd(
  ctx: CanvasRenderingContext2D,
  cssW: number,
  cssH: number,
  series: PsdSeries[],
  showAxes: boolean
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

  const logFMin = Math.log10(fMin);
  const logFMax = Math.log10(fMax);
  const logPMin = Math.floor(Math.log10(pMin)) - 0.2;
  const logPMax = Math.ceil(Math.log10(pMax)) + 0.2;
  const plotW = cssW - ML - MR;
  const plotH = cssH - MT - MB;

  function xPx(f: number) { return ML + ((Math.log10(f) - logFMin) / (logFMax - logFMin)) * plotW; }
  function yPx(p: number) { return MT + plotH - ((Math.log10(p) - logPMin) / (logPMax - logPMin)) * plotH; }

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, cssW, cssH);

  // Grid
  ctx.strokeStyle = "#eee";
  ctx.lineWidth = 1;
  const fTicks = logTicks(fMin, fMax);
  const pTicks = logTicks(Math.pow(10, logPMin), Math.pow(10, logPMax));
  for (const f of fTicks) { const x = xPx(f); ctx.beginPath(); ctx.moveTo(x, MT); ctx.lineTo(x, MT + plotH); ctx.stroke(); }
  for (const p of pTicks) { const y = yPx(p); ctx.beginPath(); ctx.moveTo(ML, y); ctx.lineTo(ML + plotW, y); ctx.stroke(); }

  // Plot border
  ctx.strokeStyle = "#bbb";
  ctx.lineWidth = 1;
  ctx.strokeRect(ML, MT, plotW, plotH);

  if (showAxes) {
    ctx.fillStyle = "#555";
    ctx.font = "10px Arial, sans-serif";
    ctx.textBaseline = "top";
    ctx.textAlign = "center";
    for (const f of fTicks) ctx.fillText(fmtTick(f), xPx(f), MT + plotH + 4);
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const p of pTicks) ctx.fillText(fmtTick(p), ML - 4, yPx(p));
    ctx.fillStyle = "#444";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText("Spatial freq. (µm⁻¹)", ML + plotW / 2, cssH);
    ctx.save();
    ctx.translate(11, MT + plotH / 2);
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

  // Legend (when multiple series)
  if (series.length > 1) {
    const lx = ML + 8, ly = MT + 8;
    const lh = 15, lw = 18, pad = 5;
    const maxChars = Math.max(...series.map(s => s.label.length));
    const boxW = lw + 8 + maxChars * 6.5 + pad * 2;
    const boxH = series.length * lh + pad * 2;
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
}

export default function PsdPlot({ freqs, power, color = "#2196f3", showAxes = true, allSeries }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
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
    drawPsd(ctx, cssW, cssH, series, showAxes);
  });

  return <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />;
}
