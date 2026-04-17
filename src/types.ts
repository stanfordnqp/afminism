export interface ProcessingOptions {
  doPlane: boolean;
  planeSigma: number;
  doLines: boolean;
  doClip: boolean;
  climSigma: number;
  climMin: number; // slider range min
  climMax: number; // slider range max
  columns: number;
}

export interface ScanRecord {
  id: string;
  filename: string;
  label: string;
  zRaw: Float32Array;
  side: number;
  scanUm: [number, number]; // [x, y] µm
  rotation: number; // 0 | 90 | 180 | 270
  minimized: boolean;
  // computed on reprocess:
  z: Float32Array;
  rms: number;
  rmsClipped: number;
  ptp: number;
}
