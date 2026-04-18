// TIFF parser for AFM height data.
// Primary: Park Systems (PSIA) files with custom tags 50432-50435.
// Fallback: standard float32/float64 TIFFs from other instruments.

export interface ParkTiff {
  data: Float32Array; // height values in nm, row-major
  side: number;       // image is side×side pixels
  scanUm: [number, number]; // [x, y] scan size in µm
  meta: string;       // human-readable source/instrument indicator
}

// Park/PSIA custom tag IDs
const PSIA_MAGIC_NUMBER = 0x0e031301;
const TAG_MAGIC    = 50432;
const TAG_VERSION  = 50433;
const TAG_DATA     = 50434;
const TAG_HEADER   = 50435;

// Standard TIFF tags
const TAG_IMAGE_WIDTH         = 256;
const TAG_IMAGE_LENGTH        = 257;
const TAG_BITS_PER_SAMPLE     = 258;
const TAG_IMAGE_DESCRIPTION   = 270;
const TAG_STRIP_OFFSETS       = 273;
const TAG_SAMPLES_PER_PIXEL   = 277;
const TAG_ROWS_PER_STRIP      = 278;
const TAG_STRIP_BYTE_COUNTS   = 279;
const TAG_X_RESOLUTION        = 282;
const TAG_Y_RESOLUTION        = 283;
const TAG_SAMPLE_FORMAT       = 339; // 3 = IEEE float

export function parseParkTiff(buffer: ArrayBuffer, filename: string): ParkTiff {
  const view = new DataView(buffer);
  const order = view.getUint16(0, true);
  const le = order === 0x4949;
  if (order !== 0x4949 && order !== 0x4d4d) throw new Error("Not a TIFF file");
  if (view.getUint16(2, le) !== 42) throw new Error("Not a TIFF file (magic)");

  const tags = readAllTags(view, le);

  // ── Try Park Systems (PSIA) format first ────────────────────────────────
  const magicTag = tags.get(TAG_MAGIC);
  if (magicTag) {
    const magic = readTagUint32(view, magicTag, le);
    if (magic === PSIA_MAGIC_NUMBER) {
      return parsePsia(view, buffer, le, tags, filename);
    }
  }

  // ── Fallback: standard float32 or float64 TIFF ──────────────────────────
  return parseGenericFloatTiff(view, buffer, le, tags, filename);
}

// ── PSIA (Park Systems) parser ───────────────────────────────────────────────

function parsePsia(
  view: DataView, buffer: ArrayBuffer, le: boolean,
  tags: Map<number, IfdEntry>, filename: string
): ParkTiff {
  // Data tag: value field holds byte offset to float32 array
  const dataEntry = tags.get(TAG_DATA);
  if (!dataEntry) throw new Error("PSIA: no data tag (50434)");
  const dataOffset = readTagUint32(view, dataEntry, le);
  const byteCount = dataEntry.count; // type=BYTE, count=total bytes
  const nFloats = byteCount / 4;
  const side = Math.round(Math.sqrt(nFloats));

  // Header tag: value field holds byte offset to the binary header
  const hdrEntry = tags.get(TAG_HEADER);
  if (!hdrEntry) throw new Error("PSIA: no header tag (50435)");
  const hdrOffset = readTagUint32(view, hdrEntry, le);

  // Parse relevant fields from the PSIA image header (little-endian binary)
  // Layout (all offsets relative to header start):
  //  0  uint32 image_type
  //  4  wchar[32] source_name  (64 bytes)
  // 68  wchar[8]  image_mode   (16 bytes)
  // 84  double lpf_strength
  // 92  uint32 auto_flatten
  // 96  uint32 ac_track
  // 100 uint32 xres
  // 104 uint32 yres
  // 108 double angle
  // 116 uint32 sine_scan
  // 120 double overscan_rate
  // 128 uint32 forward
  // 132 uint32 scan_up
  // 136 uint32 swap_xy
  // 140 double xreal (µm)
  // 148 double yreal (µm)
  // ... (scan_rate, set_point, set_point_unit[8], tip_bias, sample_bias)
  // 220 double data_gain
  // 228 double z_scale
  // 236 double z_offset
  // 244 wchar[8] z_unit
  // ...
  const sourceName = readUtf16Le(view, hdrOffset + 4,  32).trim();
  const imageMode  = readUtf16Le(view, hdrOffset + 68,  8).trim();
  const xreal   = view.getFloat64(hdrOffset + 140, true);
  const yreal   = view.getFloat64(hdrOffset + 148, true);
  const dataGain  = view.getFloat64(hdrOffset + 220, true);
  const zScale    = view.getFloat64(hdrOffset + 228, true) || 1.0;
  const zOffset   = view.getFloat64(hdrOffset + 236, true);
  const zUnitRaw  = readUtf16Le(view, hdrOffset + 244, 8).trim();

  // Parse z_unit string → scale factor to convert to meters
  // e.g. "um" → 1e-6, "nm" → 1e-9
  const unitToMeters: Record<string, number> = {
    m: 1, mm: 1e-3, um: 1e-6, "\u00b5m": 1e-6, nm: 1e-9, pm: 1e-12,
  };
  const unitScale = unitToMeters[zUnitRaw.toLowerCase()] ?? 1e-6; // default µm

  // Gwyddion formula: z_m = raw * data_gain * unitScale * zScale + data_gain * unitScale * zOffset
  // Convert to nm: z_nm = z_m * 1e9
  const qNm = dataGain * unitScale * zScale * 1e9;
  const z0Nm = dataGain * unitScale * zOffset * 1e9;

  const aligned = new ArrayBuffer(side * side * 4);
  new Uint8Array(aligned).set(new Uint8Array(buffer, dataOffset, side * side * 4));
  const raw = new Float32Array(aligned);
  const nm = new Float32Array(side * side);
  for (let j = 0; j < nm.length; j++) nm[j] = raw[j] * qNm + z0Nm;

  const scanUm: [number, number] = (xreal > 0 && yreal > 0)
    ? [xreal, yreal]
    : parseScanSizeFromFilename(filename);

  const modeParts = [sourceName, imageMode].filter(Boolean);
  const meta = "Park Systems" + (modeParts.length ? " · " + modeParts.join(" · ") : "");

  return { data: nm, side, scanUm, meta };
}

// ── Generic float32/float64 TIFF fallback ───────────────────────────────────

function parseGenericFloatTiff(
  view: DataView, buffer: ArrayBuffer, le: boolean,
  tags: Map<number, IfdEntry>, filename: string
): ParkTiff {
  const widthEntry  = tags.get(TAG_IMAGE_WIDTH);
  const lengthEntry = tags.get(TAG_IMAGE_LENGTH);
  const bpsEntry    = tags.get(TAG_BITS_PER_SAMPLE);
  const fmtEntry    = tags.get(TAG_SAMPLE_FORMAT);

  if (!widthEntry || !lengthEntry) throw new Error("Cannot read TIFF: no image dimensions");

  const width  = readTagUint32(view, widthEntry,  le);
  const height = readTagUint32(view, lengthEntry, le);
  const bps    = bpsEntry ? readTagUint16(view, bpsEntry, le) : 32;
  const fmt    = fmtEntry ? readTagUint16(view, fmtEntry, le) : 3; // 3 = float

  if (fmt !== 3 || (bps !== 32 && bps !== 64)) {
    throw new Error(`Unsupported TIFF: SampleFormat=${fmt}, BitsPerSample=${bps}. Only float32/float64 supported.`);
  }

  // Collect all strip data
  const stripOffsetsEntry    = tags.get(TAG_STRIP_OFFSETS);
  const stripByteCountsEntry = tags.get(TAG_STRIP_BYTE_COUNTS);
  if (!stripOffsetsEntry) throw new Error("Cannot read TIFF: no strip offsets");

  const nPixels = width * height;
  const bytesPerPixel = bps / 8;
  const aligned = new ArrayBuffer(nPixels * bytesPerPixel);
  const dst = new Uint8Array(aligned);

  const offsets    = readTagUintArray(view, stripOffsetsEntry,    le, buffer);
  const byteCounts = stripByteCountsEntry
    ? readTagUintArray(view, stripByteCountsEntry, le, buffer)
    : offsets.map(() => width * bytesPerPixel); // one strip per row

  let dstPos = 0;
  for (let s = 0; s < offsets.length; s++) {
    const src = new Uint8Array(buffer, offsets[s], byteCounts[s]);
    dst.set(src, dstPos);
    dstPos += byteCounts[s];
  }

  // Try to extract scan size from ImageDescription (key=value pairs) or XResolution
  let scanUm = parseScanSizeFromFilename(filename);
  const descEntry = tags.get(TAG_IMAGE_DESCRIPTION);
  if (descEntry) {
    const desc = readTagString(view, descEntry, le, buffer);
    const parsed = parseScanSizeFromDescription(desc);
    if (parsed) scanUm = parsed;
  }
  if (scanUm[0] === 1 && scanUm[1] === 1) {
    // Try XResolution tag: pixels per unit → unit per pixel
    const xResEntry = tags.get(TAG_X_RESOLUTION);
    const yResEntry = tags.get(TAG_Y_RESOLUTION);
    if (xResEntry && yResEntry) {
      const xRes = readTagRational(view, xResEntry, le); // pixels per unit
      const yRes = readTagRational(view, yResEntry, le);
      if (xRes > 0 && yRes > 0) {
        // Assume resolution is in pixels/µm
        scanUm = [width / xRes, height / yRes];
      }
    }
  }

  const nm = new Float32Array(nPixels);
  if (bps === 32) {
    const raw = new Float32Array(aligned);
    // Heuristic: if values look like meters (|mean| < 1e-3), convert to nm
    let absSum = 0;
    for (let j = 0; j < Math.min(raw.length, 1000); j++) absSum += Math.abs(raw[j]);
    const scale = (absSum / Math.min(raw.length, 1000)) < 1e-3 ? 1e9 : 1;
    for (let j = 0; j < nPixels; j++) nm[j] = raw[j] * scale;
  } else {
    // float64
    const raw = new Float64Array(aligned);
    let absSum = 0;
    for (let j = 0; j < Math.min(raw.length, 1000); j++) absSum += Math.abs(raw[j]);
    const scale = (absSum / Math.min(raw.length, 1000)) < 1e-3 ? 1e9 : 1;
    for (let j = 0; j < nPixels; j++) nm[j] = raw[j] * scale;
  }

  const side = Math.round(Math.sqrt(nPixels));
  const meta = `Float${bps} TIFF`;
  return { data: nm, side, scanUm, meta };
}

// ── IFD utilities ─────────────────────────────────────────────────────────────

interface IfdEntry {
  tag: number;
  type: number;
  count: number;
  valueOrOffset: number; // raw 4-byte value from IFD
}

function readAllTags(view: DataView, le: boolean): Map<number, IfdEntry> {
  const map = new Map<number, IfdEntry>();
  let ifdOffset = view.getUint32(4, le);
  while (ifdOffset !== 0 && ifdOffset < view.byteLength) {
    const nEntries = view.getUint16(ifdOffset, le);
    for (let i = 0; i < nEntries; i++) {
      const off = ifdOffset + 2 + i * 12;
      const tag  = view.getUint16(off,     le);
      const type = view.getUint16(off + 2, le);
      const count = view.getUint32(off + 4, le);
      const valueOrOffset = view.getUint32(off + 8, le);
      map.set(tag, { tag, type, count, valueOrOffset });
    }
    const nextOff = ifdOffset + 2 + nEntries * 12;
    if (nextOff + 4 > view.byteLength) break;
    ifdOffset = view.getUint32(nextOff, le);
  }
  return map;
}

function readTagUint32(view: DataView, e: IfdEntry, le: boolean): number {
  // For count>1 or types where value doesn't fit in 4 bytes, valueOrOffset is an offset
  // For SHORT (type=3) or LONG (type=4) with count=1, it's inline
  if (e.type === 3 && e.count === 1) return le ? (e.valueOrOffset & 0xffff) : (e.valueOrOffset >>> 16);
  if (e.type === 4 && e.count === 1) return e.valueOrOffset;
  // Otherwise, valueOrOffset is an offset into the file
  if (e.type === 4) return view.getUint32(e.valueOrOffset, le);
  if (e.type === 3) return view.getUint16(e.valueOrOffset, le);
  return e.valueOrOffset;
}

function readTagUint16(view: DataView, e: IfdEntry, le: boolean): number {
  if (e.type === 3 && e.count === 1) return le ? (e.valueOrOffset & 0xffff) : (e.valueOrOffset >>> 16);
  if (e.type === 4 && e.count === 1) return e.valueOrOffset & 0xffff;
  if (e.count === 1) return e.valueOrOffset & 0xffff;
  return view.getUint16(e.valueOrOffset, le);
}

function readTagUintArray(view: DataView, e: IfdEntry, le: boolean, buffer: ArrayBuffer): number[] {
  const result: number[] = [];
  if (e.count === 1) {
    result.push(readTagUint32(view, e, le));
  } else {
    const tmpView = new DataView(buffer, e.valueOrOffset, typeSize(e.type) * e.count);
    for (let i = 0; i < e.count; i++) {
      if (e.type === 3) result.push(tmpView.getUint16(i * 2, le));
      else result.push(tmpView.getUint32(i * 4, le));
    }
  }
  return result;
}

function readTagRational(view: DataView, e: IfdEntry, le: boolean): number {
  // RATIONAL type=5: two LONG values (numerator/denominator) stored at offset
  if (e.type !== 5) return 0;
  const num = view.getUint32(e.valueOrOffset,     le);
  const den = view.getUint32(e.valueOrOffset + 4, le);
  return den ? num / den : 0;
}

function readTagString(view: DataView, e: IfdEntry, _le: boolean, buffer: ArrayBuffer): string {
  if (e.type !== 2) return "";
  const fits = e.count <= 4;
  const bytes = new Uint8Array(buffer, fits ? 0 : e.valueOrOffset, e.count);
  return new TextDecoder().decode(bytes).replace(/\0.*$/, "");
}

function typeSize(type: number): number {
  if (type === 3) return 2;  // SHORT
  if (type === 4) return 4;  // LONG
  if (type === 5) return 8;  // RATIONAL
  return 1;
}

function readUtf16Le(view: DataView, offset: number, nChars: number): string {
  let s = "";
  for (let i = 0; i < nChars; i++) {
    const cp = view.getUint16(offset + i * 2, true);
    if (cp === 0) break;
    s += String.fromCharCode(cp);
  }
  return s;
}

// ── Scan-size helpers ─────────────────────────────────────────────────────────

function parseScanSizeFromFilename(filename: string): [number, number] {
  const m = filename.match(/(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)/i);
  if (m) return [parseFloat(m[1]), parseFloat(m[2])];
  return [1, 1];
}

function parseScanSizeFromDescription(desc: string): [number, number] | null {
  // Try common key=value patterns: ScanSize=10, ScanSizeX=10um ScanSizeY=10um, etc.
  const tryKeys = ["ScanSizeX", "ScanSize", "XScanSize", "width"];
  for (const k of tryKeys) {
    const m = desc.match(new RegExp(k + `\\s*[=:]\\s*([\\d.]+)\\s*(um|µm|nm|mm)?`, "i"));
    if (m) {
      let v = parseFloat(m[1]);
      const u = (m[2] || "um").toLowerCase();
      if (u === "nm") v /= 1000;
      else if (u === "mm") v *= 1000;
      return [v, v];
    }
  }
  return null;
}
