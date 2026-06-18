// Colormaps — each a 256×3 Uint8Array LUT.

export type ColormapName = "gray" | "gwynet" | "diverging";

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
  // Gwyddion's signature "Gwyddion.net": black → reddish-brown → tan → white.
  // Exact Gwyddion control points.
  gwynet: makeLut([
    [0,           0,   0,   0],
    [0.344671,  168,  40,  15],
    [0.687075,  243, 194,  93],
    [1,         255, 255, 255],
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
  gwynet:    "Sepia",
  diverging: "Diverging",
};

export const COLORMAP_ORDER: ColormapName[] = ["gray", "gwynet", "diverging"];

function lut(cm: ColormapName = "gwynet"): Uint8Array {
  return LUTS[cm];
}

export function toImageData(
  z: Float32Array,
  width: number,
  height: number,
  vmin: number,
  vmax: number,
  clip: boolean,
  colormap: ColormapName = "gwynet"
): ImageData {
  const L = lut(colormap);
  const n = width * height;
  const pixels = new Uint8ClampedArray(n * 4);
  const range = vmax - vmin || 1;
  for (let i = 0; i < n; i++) {
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
  return new ImageData(pixels, width, height);
}

export function drawScaleBar(
  ctx: CanvasRenderingContext2D,
  scanUmX: number,
  canvasW: number,
  canvasH: number = canvasW,
): void {
  const frac = 0.2;
  const raw = scanUmX * frac;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const barUm = Math.round(raw / magnitude) * magnitude;
  const barPx = (barUm / scanUmX) * canvasW;

  // Margins are referenced to the smaller side so the bar always sits in the
  // bottom-right corner — same visual offset whether the scan is square,
  // tall, or wide. Using canvasH would push the bar far from the corner
  // for tall scans.
  const ref = Math.min(canvasW, canvasH);
  const marginX = ref * 0.05;
  const marginY = ref * 0.05;
  const x1 = canvasW - marginX - barPx;
  const x2 = canvasW - marginX;
  const yLine = canvasH - marginY;
  const padX = ref * 0.015;
  const padAbove = ref * 0.04;
  const padBelow = ref * 0.015;
  const textY = yLine - ref * 0.012;
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
  ctx.font = `normal bold ${Math.round(ref * 0.03)}px Arial, "Helvetica Neue", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText(label, (x1 + x2) / 2, textY);
  ctx.restore();
}

export function renderScanForExport(
  z: Float32Array,
  width: number,
  height: number,
  scanUm: [number, number],
  vmin: number,
  vmax: number,
  doClip: boolean,
  exportW: number,
  colormap: ColormapName = "gwynet",
): HTMLCanvasElement {
  // Output canvas matches the physical aspect ratio of the scan.
  const exportH = Math.round(exportW * (scanUm[1] / scanUm[0]));
  const img = toImageData(z, width, height, vmin, vmax, doClip, colormap);
  const src = document.createElement("canvas");
  src.width = width; src.height = height;
  src.getContext("2d")!.putImageData(img, 0, 0);

  const out = document.createElement("canvas");
  out.width = exportW; out.height = exportH;
  const ctx = out.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0, exportW, exportH);
  drawScaleBar(ctx, scanUm[0], exportW, exportH);
  return out;
}

// Draw gradient strip into a canvas context at (0,0) — vertical, top=high, bottom=low.
export function drawColormapStrip(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  colormap: ColormapName = "gwynet"
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
  colormap: ColormapName = "gwynet"
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
  colormap: ColormapName = "gwynet"
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
