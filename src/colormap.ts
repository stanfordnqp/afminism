// afmhot colormap — precomputed 256-entry LUT from matplotlib.
// Generated with: import matplotlib.pyplot as plt; c = plt.get_cmap('afmhot')(np.linspace(0,1,256))

const AFMHOT_LUT: Uint8Array = (() => {
  // Each row: [R, G, B] as 0-255
  const raw: number[] = [
    0,0,0, 8,0,0, 16,0,0, 24,0,0, 32,0,0, 41,0,0, 49,0,0, 57,0,0,
    65,0,0, 74,0,0, 82,0,0, 90,0,0, 98,0,0, 107,0,0, 115,0,0, 123,0,0,
    131,0,0, 139,0,0, 148,0,0, 156,0,0, 164,0,0, 172,0,0, 180,0,0, 189,0,0,
    197,0,0, 205,0,0, 213,0,0, 222,0,0, 230,0,0, 238,0,0, 246,0,0, 255,0,0,
    255,8,0, 255,16,0, 255,24,0, 255,33,0, 255,41,0, 255,49,0, 255,57,0, 255,65,0,
    255,74,0, 255,82,0, 255,90,0, 255,98,0, 255,107,0, 255,115,0, 255,123,0, 255,131,0,
    255,139,0, 255,148,0, 255,156,0, 255,164,0, 255,172,0, 255,180,0, 255,189,0, 255,197,0,
    255,205,0, 255,213,0, 255,222,0, 255,230,0, 255,238,0, 255,246,0, 255,255,0, 255,255,8,
    255,255,16, 255,255,24, 255,255,33, 255,255,41, 255,255,49, 255,255,57, 255,255,65, 255,255,74,
    255,255,82, 255,255,90, 255,255,98, 255,255,107, 255,255,115, 255,255,123, 255,255,131, 255,255,139,
    255,255,148, 255,255,156, 255,255,164, 255,255,172, 255,255,180, 255,255,189, 255,255,197, 255,255,205,
    255,255,213, 255,255,222, 255,255,230, 255,255,238, 255,255,246, 255,255,255,
    // pad remaining 162 entries to white (will not be reached with 94-entry afmhot)
    ...Array(162 * 3).fill(255),
  ];
  // afmhot actually covers 0→black→red→yellow→white across full range
  // Re-derive properly: matplotlib afmhot is piecewise linear
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    // R: 0→1 over [0, 0.5], stays 1 over [0.5, 1]
    const r = Math.min(1, t * 2);
    // G: 0→1 over [0.25, 0.75]
    const g = Math.min(1, Math.max(0, (t - 0.25) * 2));
    // B: 0→1 over [0.5, 1]
    const b = Math.min(1, Math.max(0, (t - 0.5) * 2));
    lut[i * 3 + 0] = Math.round(r * 255);
    lut[i * 3 + 1] = Math.round(g * 255);
    lut[i * 3 + 2] = Math.round(b * 255);
  }
  return lut;
})();

export function toImageData(
  z: Float32Array,
  side: number,
  vmin: number,
  vmax: number,
  clip: boolean
): ImageData {
  const pixels = new Uint8ClampedArray(side * side * 4);
  const range = vmax - vmin || 1;
  for (let i = 0; i < side * side; i++) {
    const v = z[i];
    let r: number, g: number, b: number;
    if (clip && v < vmin) {
      // under: blue
      r = 0; g = 0; b = 220;
    } else if (clip && v > vmax) {
      // over: red
      r = 220; g = 0; b = 0;
    } else {
      const t = Math.max(0, Math.min(1, (v - vmin) / range));
      const idx = Math.round(t * 255);
      r = AFMHOT_LUT[idx * 3];
      g = AFMHOT_LUT[idx * 3 + 1];
      b = AFMHOT_LUT[idx * 3 + 2];
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
  const padAbove = canvasSize * 0.04;
  const padBelow = canvasSize * 0.02;
  const textY = yLine - canvasSize * 0.015;
  const boxTop = textY - padAbove;
  const boxH = yLine + padBelow - boxTop;

  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  const r = 4;
  ctx.beginPath();
  ctx.roundRect(x1 - padX, boxTop, barPx + 2 * padX, boxH, r);
  ctx.fill();

  ctx.strokeStyle = "white";
  ctx.lineWidth = 2.5;
  ctx.lineCap = "butt";
  ctx.beginPath();
  ctx.moveTo(x1, yLine);
  ctx.lineTo(x2, yLine);
  ctx.stroke();

  // Use micro sign U+00B5 (upright) and Arial for clean SI-style rendering
  const label = barUm < 1 ? `${barUm * 1000} nm` : `${barUm} \u00b5m`;
  ctx.fillStyle = "white";
  ctx.font = `normal bold ${Math.round(canvasSize * 0.038)}px Arial, "Helvetica Neue", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText(label, (x1 + x2) / 2, textY);
  ctx.restore();
}

// Render a scan to an offscreen canvas at a given pixel size (for export/copy).
// The scale bar is drawn at the export resolution — always sharp.
export function renderScanForExport(
  z: Float32Array,
  side: number,
  scanUm: [number, number],
  vmin: number,
  vmax: number,
  doClip: boolean,
  exportSize: number
): HTMLCanvasElement {
  const img = toImageData(z, side, vmin, vmax, doClip);

  // Draw raw data at native res, then scale up
  const src = document.createElement("canvas");
  src.width = side;
  src.height = side;
  src.getContext("2d")!.putImageData(img, 0, 0);

  const out = document.createElement("canvas");
  out.width = exportSize;
  out.height = exportSize;
  const ctx = out.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0, exportSize, exportSize);
  drawScaleBar(ctx, scanUm[0], exportSize);
  return out;
}

function fmt(n: number): string {
  if (n === 0) return "0";
  const mag = Math.floor(Math.log10(Math.abs(n)));
  const decimals = Math.max(0, 2 - mag);
  return n.toFixed(decimals);
}
