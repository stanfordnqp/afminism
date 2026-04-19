// Colormaps — each a 256×3 Uint8Array LUT.

export type ColormapName = "gray" | "viridis" | "afmhot" | "diverging";

// Piecewise-linear interpolation between control points to build a 256-entry LUT.
function makeLut(stops: [number, number, number, number][]): Uint8Array {
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let s = 0;
    while (s < stops.length - 2 && t > stops[s + 1][0]) s++;
    const [t0, r0, g0, b0] = stops[s];
    const [t1, r1, g1, b1] = stops[s + 1];
    const u = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
    lut[i * 3 + 0] = Math.round(r0 + u * (r1 - r0));
    lut[i * 3 + 1] = Math.round(g0 + u * (g1 - g0));
    lut[i * 3 + 2] = Math.round(b0 + u * (b1 - b0));
  }
  return lut;
}

const LUTS: Record<ColormapName, Uint8Array> = {
  gray: makeLut([
    [0, 0, 0, 0],
    [1, 255, 255, 255],
  ]),
  viridis: makeLut([
    [0,     68,   1,  84],
    [0.125, 72,  33, 115],
    [0.25,  59,  82, 139],
    [0.375, 44, 113, 142],
    [0.5,   33, 145, 140],
    [0.625, 53, 183, 121],
    [0.75,  94, 201,  98],
    [0.875,175, 220,  57],
    [1,    253, 231,  37],
  ]),
  afmhot: makeLut([
    [0,      0,   0,   0],
    [0.25,  128,   0,   0],
    [0.5,   255, 128,   0],
    [0.75,  255, 255, 128],
    [1,     255, 255, 255],
  ]),
  // Diverging: blue → white (at center) → red. For symmetric data around 0.
  diverging: makeLut([
    [0,    33, 102, 172],
    [0.25,103, 169, 207],
    [0.5, 255, 255, 255],
    [0.75,239, 138,  98],
    [1,   178,  24,  43],
  ]),
};

export const COLORMAP_LABELS: Record<ColormapName, string> = {
  gray:      "Gray",
  viridis:   "Viridis",
  afmhot:   "AFM Hot",
  diverging: "Diverging",
};

export const COLORMAP_ORDER: ColormapName[] = ["gray", "viridis", "afmhot", "diverging"];

function lut(cm: ColormapName = "afmhot"): Uint8Array {
  return LUTS[cm];
}

export function toImageData(
  z: Float32Array,
  side: number,
  vmin: number,
  vmax: number,
  clip: boolean,
  colormap: ColormapName = "afmhot"
): ImageData {
  const L = lut(colormap);
  const pixels = new Uint8ClampedArray(side * side * 4);
  const range = vmax - vmin || 1;
  for (let i = 0; i < side * side; i++) {
    const v = z[i];
    let r: number, g: number, b: number;
    if (clip && v < vmin) {
      r = 0; g = 0; b = 220;
    } else if (clip && v > vmax) {
      r = 220; g = 0; b = 0;
    } else {
      const t = Math.max(0, Math.min(1, (v - vmin) / range));
      const idx = Math.round(t * 255);
      r = L[idx * 3]; g = L[idx * 3 + 1]; b = L[idx * 3 + 2];
    }
    pixels[i * 4 + 0] = r;
    pixels[i * 4 + 1] = g;
    pixels[i * 4 + 2] = b;
    pixels[i * 4 + 3] = 255;
  }
  return new ImageData(pixels, side, side);
}

export function drawScaleBar(
  ctx: CanvasRenderingContext2D,
  scanUm: number,
  canvasSize: number
): void {
  const frac = 0.2;
  const raw = scanUm * frac;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const barUm = Math.round(raw / magnitude) * magnitude;
  const barPx = (barUm / scanUm) * canvasSize;

  const marginX = canvasSize * 0.05;
  const marginY = canvasSize * 0.06;
  const x1 = canvasSize - marginX - barPx;
  const x2 = canvasSize - marginX;
  const yLine = canvasSize - marginY;

  const padX = canvasSize * 0.03;
  const padAbove = canvasSize * 0.05;
  const padBelow = canvasSize * 0.02;
  const textY = yLine - canvasSize * 0.015;
  const boxTop = textY - padAbove;
  const boxH = yLine + padBelow - boxTop;

  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.beginPath();
  ctx.roundRect(x1 - padX, boxTop, barPx + 2 * padX, boxH, 4);
  ctx.fill();

  ctx.strokeStyle = "white";
  ctx.lineWidth = 2.5;
  ctx.lineCap = "butt";
  ctx.beginPath();
  ctx.moveTo(x1, yLine);
  ctx.lineTo(x2, yLine);
  ctx.stroke();

  const label = barUm < 1 ? `${barUm * 1000} nm` : `${barUm} \u00b5m`;
  ctx.fillStyle = "white";
  ctx.font = `normal bold ${Math.round(canvasSize * 0.038)}px Arial, "Helvetica Neue", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText(label, (x1 + x2) / 2, textY);
  ctx.restore();
}

export function renderScanForExport(
  z: Float32Array,
  side: number,
  scanUm: [number, number],
  vmin: number,
  vmax: number,
  doClip: boolean,
  exportSize: number,
  colormap: ColormapName = "afmhot"
): HTMLCanvasElement {
  const img = toImageData(z, side, vmin, vmax, doClip, colormap);
  const src = document.createElement("canvas");
  src.width = side; src.height = side;
  src.getContext("2d")!.putImageData(img, 0, 0);

  const out = document.createElement("canvas");
  out.width = exportSize; out.height = exportSize;
  const ctx = out.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0, exportSize, exportSize);
  drawScaleBar(ctx, scanUm[0], exportSize);
  return out;
}

// Draw gradient strip into a canvas context at (0,0) — vertical, top=high, bottom=low.
export function drawColormapStrip(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  colormap: ColormapName = "afmhot"
): void {
  if (w <= 0 || h <= 0) return;
  const L = lut(colormap);
  const imgData = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const t = 1 - y / Math.max(1, h - 1);
    const idx = Math.round(t * 255);
    const r = L[idx * 3], g = L[idx * 3 + 1], b = L[idx * 3 + 2];
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      imgData.data[i] = r; imgData.data[i + 1] = g; imgData.data[i + 2] = b; imgData.data[i + 3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);
}

// Horizontal gradient strip — used by the sidebar swatch picker.
export function drawColormapStripH(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  colormap: ColormapName = "afmhot"
): void {
  if (w <= 0 || h <= 0) return;
  const L = lut(colormap);
  const imgData = ctx.createImageData(w, h);
  for (let x = 0; x < w; x++) {
    const t = x / Math.max(1, w - 1);
    const idx = Math.round(t * 255);
    const r = L[idx * 3], g = L[idx * 3 + 1], b = L[idx * 3 + 2];
    for (let y = 0; y < h; y++) {
      const i = (y * w + x) * 4;
      imgData.data[i] = r; imgData.data[i + 1] = g; imgData.data[i + 2] = b; imgData.data[i + 3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);
}

// Canvas-only colorbar for figure exports (light/white background).
export function drawColorbar(
  ctx: CanvasRenderingContext2D,
  vmin: number,
  vmax: number,
  totalW: number,
  totalH: number,
  _dark = false,
  colormap: ColormapName = "afmhot"
): void {
  const stripW = 18;
  const labelH = 14;
  const padV = 6;
  const padH = 8;
  const stripH = Math.max(40, totalH - labelH - padV);
  const stripX = padH;
  const stripY = labelH;

  ctx.font = "9px Arial, sans-serif";
  ctx.fillStyle = "#999";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("nm", stripX, labelH / 2);

  const tmp = document.createElement("canvas");
  tmp.width = stripW; tmp.height = stripH;
  drawColormapStrip(tmp.getContext("2d")!, stripW, stripH, colormap);
  ctx.drawImage(tmp, stripX, stripY);

  ctx.strokeStyle = "#ccc";
  ctx.lineWidth = 0.5;
  ctx.strokeRect(stripX + 0.5, stripY + 0.5, stripW - 1, stripH - 1);

  const textX = stripX + stripW + 5;
  ctx.font = "10px Arial, sans-serif";
  ctx.fillStyle = "#555";
  ctx.textAlign = "left";
  const mid = (vmin + vmax) / 2;
  ctx.textBaseline = "top";    ctx.fillText(fmtCbVal(vmax), textX, stripY);
  ctx.textBaseline = "middle"; ctx.fillText(fmtCbVal(mid),  textX, stripY + stripH / 2);
  ctx.textBaseline = "bottom"; ctx.fillText(fmtCbVal(vmin), textX, stripY + stripH);
}

export function fmtCbVal(v: number): string {
  const abs = Math.abs(v);
  if (abs < 0.005) return "0";
  const sign = v > 0 ? "+" : "";
  if (abs >= 100) return `${sign}${Math.round(v)}`;
  if (abs >= 10)  return `${sign}${v.toFixed(1)}`;
  return `${sign}${v.toFixed(2)}`;
}
