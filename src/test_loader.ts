// Dev-only: load synthetic test .npy files served by the Vite test-data plugin.
// Each file is a 256×256 float32 array (5×5 µm scan).

const TEST_FILES: Array<{ filename: string; label: string }> = [
  { filename: "01_white_noise.npy",        label: "White noise" },
  { filename: "02_checkerboard.npy",       label: "Checkerboard" },
  { filename: "03_1d_grating.npy",         label: "1D grating" },
  { filename: "04_pink_noise_1f.npy",      label: "Pink noise (1/f)" },
  { filename: "05_smooth_1f4.npy",         label: "Smooth (1/f⁴)" },
  { filename: "06_tilt_plus_noise.npy",    label: "Tilt + noise" },
  { filename: "07_parabola_pink_dirt.npy", label: "Parabola + dirt" },
];

interface NpyResult {
  data: Float32Array;
  side: number;
  scanUm: [number, number];
  filename: string;
  label: string;
}

// Minimal numpy v1/v2 .npy parser for float32 C-order 2D arrays.
function parseNpy(buf: ArrayBuffer, filename: string, label: string): NpyResult {
  const bytes = new Uint8Array(buf);
  // Magic: \x93NUMPY
  if (bytes[0] !== 0x93 || bytes[1] !== 0x4e || bytes[2] !== 0x55 ||
      bytes[3] !== 0x4d || bytes[4] !== 0x50 || bytes[5] !== 0x59) {
    throw new Error(`${filename}: not a numpy file`);
  }
  const major = bytes[6];
  const view = new DataView(buf);
  const headerLen = major === 1
    ? view.getUint16(8, true)   // v1: 2-byte LE
    : view.getUint32(8, true);  // v2: 4-byte LE
  const headerOffset = major === 1 ? 10 : 12;
  const header = new TextDecoder().decode(bytes.slice(headerOffset, headerOffset + headerLen));

  // Parse shape from header string like "{'descr': '<f4', 'fortran_order': False, 'shape': (512, 512), }"
  const shapeMatch = header.match(/['"]shape['"]\s*:\s*\(([^)]+)\)/);
  if (!shapeMatch) throw new Error(`${filename}: cannot parse shape`);
  const dims = shapeMatch[1].split(",").map((s) => parseInt(s.trim())).filter((n) => !isNaN(n));
  if (dims.length !== 2) throw new Error(`${filename}: expected 2D array`);
  const [rows, cols] = dims;
  if (rows !== cols) throw new Error(`${filename}: expected square array`);

  const dataOffset = headerOffset + headerLen;
  const data = new Float32Array(buf, dataOffset, rows * cols);

  return { data, side: rows, scanUm: [5.0, 5.0], filename, label };
}

export async function loadTestScans(): Promise<NpyResult[]> {
  const results: NpyResult[] = [];

  // Example TIFF (real scan)
  const base = import.meta.env.BASE_URL ?? "/";
  const exRes = await fetch(`${base}example.tiff`);
  if (exRes.ok) {
    const { parseParkTiff } = await import("./tiff");
    const buf = await exRes.arrayBuffer();
    const { data, side, scanUm } = parseParkTiff(buf, "example.tiff");
    results.push({ data, side, scanUm, filename: "example.tiff", label: "Example" });
  }

  for (const { filename, label } of TEST_FILES) {
    const res = await fetch(`/test-data/${filename}`);
    if (!res.ok) throw new Error(`Failed to fetch ${filename}: ${res.status}`);
    const buf = await res.arrayBuffer();
    results.push(parseNpy(buf, filename, label));
  }
  return results;
}
