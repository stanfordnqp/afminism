import type { ColormapName } from "./colormap";
export type { ColormapName };

export interface ProcessingOptions {
  doPoly: boolean;
  polyOrder: number;
  polySigma: number;
  doLines: boolean;
  doClip: boolean;
  climSigma: number;
  climMin: number; // slider range min
  climMax: number; // slider range max
  columns: number;
  colormap: ColormapName;
  showPsd: boolean;
}

export interface ScanRecord {
  id: string;
  filename: string;
  label: string;
  zRaw: Float32Array;
  side: number;
  scanUm: [number, number]; // [x, y] µm
  rotation: number; // 0 | 90 | 180 | 270
  isExample?: boolean;
  meta?: string;
  // computed on reprocess:
  z: Float32Array;
  rms: number;
  rmsClipped: number;
  ptp: number;
  psd: { freqs: Float32Array; power: Float32Array };
}
