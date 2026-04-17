// Minimal TIFF parser for Park Systems AFM files.
// Park stores raw float32 height data (in µm) in custom tag 50434.

const PARK_RAW_TAG = 50434;

export interface ParkTiff {
  data: Float32Array; // height values in nm, row-major
  side: number;       // image is side×side pixels
  scanUm: [number, number]; // [x, y] scan size in µm, parsed from filename
}

export function parseParkTiff(buffer: ArrayBuffer, filename: string): ParkTiff {
  const view = new DataView(buffer);

  // Byte order: "II" = little-endian, "MM" = big-endian
  const order = view.getUint16(0, true);
  const le = order === 0x4949; // "II"
  if (order !== 0x4949 && order !== 0x4d4d) {
    throw new Error("Not a valid TIFF file");
  }

  const magic = view.getUint16(2, le);
  if (magic !== 42) throw new Error("Not a TIFF file (magic != 42)");

  let ifdOffset = view.getUint32(4, le);

  // Walk IFDs to find tag 50434
  while (ifdOffset !== 0) {
    const nEntries = view.getUint16(ifdOffset, le);
    for (let i = 0; i < nEntries; i++) {
      const entryOffset = ifdOffset + 2 + i * 12;
      const tag = view.getUint16(entryOffset, le);
      if (tag === PARK_RAW_TAG) {
        const type = view.getUint16(entryOffset + 2, le);
        const count = view.getUint32(entryOffset + 4, le);
        // type 11 = FLOAT (32-bit), type 1 = BYTE (raw)
        // Park stores raw bytes; count = total bytes
        let dataOffset: number;
        if (count <= 4) {
          dataOffset = entryOffset + 8;
        } else {
          dataOffset = view.getUint32(entryOffset + 8, le);
        }

        let byteCount: number;
        if (type === 11) {
          // FLOAT: count = number of floats
          byteCount = count * 4;
        } else {
          // BYTE or UNDEFINED: count = bytes
          byteCount = count;
        }

        const nFloats = byteCount / 4;
        const side = Math.round(Math.sqrt(nFloats));

        // Copy to aligned buffer (DataView offset may be unaligned)
        const aligned = new ArrayBuffer(side * side * 4);
        new Uint8Array(aligned).set(
          new Uint8Array(buffer, dataOffset, side * side * 4)
        );
        // Park data is always little-endian float32
        const raw = new Float32Array(aligned);
        const nm = new Float32Array(side * side);
        for (let j = 0; j < nm.length; j++) nm[j] = raw[j] * 1000; // µm → nm

        return { data: nm, side, scanUm: parseScanSize(filename) };
      }
    }
    // Next IFD
    const nextOffset = ifdOffset + 2 + nEntries * 12;
    ifdOffset = view.getUint32(nextOffset, le);
  }

  throw new Error(`Park Systems raw tag (${PARK_RAW_TAG}) not found in TIFF`);
}

function parseScanSize(filename: string): [number, number] {
  const m = filename.match(/(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)/);
  if (m) return [parseFloat(m[1]), parseFloat(m[2])];
  return [1, 1];
}
