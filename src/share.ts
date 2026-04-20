import type { ScanRecord, ProcessingOptions } from "./types";
import { reprocess, computeRms } from "./processing";

export const WORKER_URL = "https://afminism-share.romanddimov.workers.dev";

// ── Binary format ─────────────────────────────────────────────────────────────
// [4 bytes]  magic "AFMI"
// [4 bytes]  uint32 JSON metadata byte length
// [N bytes]  UTF-8 JSON metadata
// [rest]     concatenated Float32Array data (one per scan, in order)
// Then the whole thing is deflate-compressed.

const MAGIC = 0x41464d49; // "AFMI"

interface ScanMeta {
  id: string;
  filename: string;
  label: string;
  side: number;
  scanUm: [number, number];
  rotation: number;
  meta?: string;
  isExample?: boolean;
  floatOffset: number; // byte offset into float section
  floatCount: number;  // number of float32 values
}

interface SessionMeta {
  version: number;
  opts: ProcessingOptions;
  scans: ScanMeta[];
}

async function compress(buf: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream("deflate");
  const writer = (cs.writable as WritableStream<Uint8Array>).getWriter();
  writer.write(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
  writer.close();
  const chunks: Uint8Array[] = [];
  const reader = cs.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.byteLength; }
  return out;
}

async function decompress(buf: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate");
  const writer = (ds.writable as WritableStream<Uint8Array>).getWriter();
  writer.write(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
  writer.close();
  const chunks: Uint8Array[] = [];
  const reader = ds.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.byteLength; }
  return out;
}

export async function serializeSession(
  scans: ScanRecord[],
  opts: ProcessingOptions
): Promise<Uint8Array> {
  const enc = new TextEncoder();

  // Build float section and scan metadata in parallel
  let floatByteOffset = 0;
  const scanMetas: ScanMeta[] = scans.map((s) => {
    const floatCount = s.zRaw.length;
    const meta: ScanMeta = {
      id: s.id, filename: s.filename, label: s.label,
      side: s.side, scanUm: s.scanUm, rotation: s.rotation,
      meta: s.meta, isExample: s.isExample,
      floatOffset: floatByteOffset, floatCount,
    };
    floatByteOffset += floatCount * 4;
    return meta;
  });

  const sessionMeta: SessionMeta = { version: 1, opts, scans: scanMetas };
  const jsonBytes = enc.encode(JSON.stringify(sessionMeta));

  // Assemble raw buffer
  const headerSize = 4 + 4 + jsonBytes.byteLength;
  const raw = new Uint8Array(headerSize + floatByteOffset);
  const view = new DataView(raw.buffer);
  view.setUint32(0, MAGIC, false);
  view.setUint32(4, jsonBytes.byteLength, false);
  raw.set(jsonBytes, 8);

  const floatBase = headerSize;
  scans.forEach((s, i) => {
    raw.set(new Uint8Array(s.zRaw.buffer, s.zRaw.byteOffset, s.zRaw.byteLength), floatBase + scanMetas[i].floatOffset);
  });

  return compress(raw);
}

export async function deserializeSession(
  compressed: Uint8Array
): Promise<{ scans: ScanRecord[]; opts: ProcessingOptions }> {
  const raw = await decompress(compressed);
  const view = new DataView(raw.buffer);

  const magic = view.getUint32(0, false);
  if (magic !== MAGIC) throw new Error("Invalid session file");

  const jsonLen = view.getUint32(4, false);
  const dec = new TextDecoder();
  const json = dec.decode(raw.slice(8, 8 + jsonLen));
  const { opts, scans: scanMetas } = JSON.parse(json) as SessionMeta;

  const floatBase = 8 + jsonLen;
  const scans: ScanRecord[] = scanMetas.map((sm) => {
    const zRaw = new Float32Array(raw.buffer.slice(
      raw.byteOffset + floatBase + sm.floatOffset,
      raw.byteOffset + floatBase + sm.floatOffset + sm.floatCount * 4
    ));
    const z = reprocess(zRaw, sm.side, opts, sm.rotation);
    const { rms, rmsClipped, ptp } = computeRms(z, opts.climSigma);
    return {
      id: sm.id, filename: sm.filename, label: sm.label,
      side: sm.side, scanUm: sm.scanUm, rotation: sm.rotation,
      meta: sm.meta, isExample: sm.isExample,
      zRaw, z, rms, rmsClipped, ptp,
    };
  });

  return { scans, opts };
}

export async function uploadSession(scans: ScanRecord[], opts: ProcessingOptions): Promise<string> {
  const blob = await serializeSession(scans, opts);
  const res = await fetch(`${WORKER_URL}/`, {
    method: "POST",
    body: blob.buffer as ArrayBuffer,
    headers: { "Content-Type": "application/octet-stream" },
  });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  const { id } = (await res.json()) as { id: string };
  return id;
}

export async function downloadSession(id: string): Promise<{ scans: ScanRecord[]; opts: ProcessingOptions }> {
  const res = await fetch(`${WORKER_URL}/${id}`);
  if (!res.ok) throw new Error(`Session not found: ${id}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  return deserializeSession(buf);
}
