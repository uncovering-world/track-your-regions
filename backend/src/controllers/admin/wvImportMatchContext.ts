/**
 * The vocabulary the CV colour-match pipeline's parts share: the context every
 * phase writes into, the three calls that report progress to the browser, and
 * the dimensions the image is read at.
 *
 * Extracted from `wvImportMatchPipeline.ts` so that phase-module files
 * (`wvImportMatchCluster`, `wvImportMatchMeanshift`, `wvImportMatchWater` and
 * `wvImportMatchJsBranch`) can import the type without creating a circular
 * dependency through Pipeline;
 * the SSE callbacks and `ImageDims` followed it when the two CV branches moved
 * into files of their own (#933), for the same reason.
 */

import type { ColorMatchEvent } from '../../api/responses/wvImportCvMatch.js';

/** Mutable state threaded through every phase of the color-match pipeline. */
export interface PipelineContext {
  // Inputs (set by orchestrator before first phase)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- OpenCV.js has no TypeScript types
  cv: any;
  regionId: number;
  worldViewId: number;
  regionName: string;
  knownDivisionIds: Set<number>;
  expectedRegionCount: number;
  mapBuffer: Buffer;

  // Image dimensions
  TW: number;
  TH: number;
  tp: number;
  origW: number;
  origH: number;
  RES_SCALE: number;

  // Pixel buffers (set during noise removal in orchestrator)
  origDownBuf: Buffer;
  rawBuf: Buffer;
  colorBuf: Buffer;
  // NOTE: no separate `buf` alias — all phases use `colorBuf` directly

  // Derived buffers (set during various phases)
  hsvSharp: Buffer;
  labBufEarly: Buffer;
  hsvBuf: Buffer;
  inpaintedBuf: Buffer | null;

  // Masks (built up across phases)
  waterGrown: Uint8Array;
  countryMask: Uint8Array;
  countrySize: number;
  coastalBand: Uint8Array;

  // K-means state (set by cluster phase)
  pixelLabels: Uint8Array;
  colorCentroids: Array<[number, number, number]>;
  clusterCounts: number[];

  // Recluster params (mutated by orchestrator loop)
  ckOverride: number | null;
  chromaBoost: number;
  randomSeed: boolean;

  // SSE/debug helpers (set by orchestrator)
  sendEvent: SendEvent;
  logStep: (step: string) => Promise<void>;
  pushDebugImage: (label: string, dataUrl: string) => Promise<void>;
  debugImages: Array<{ label: string; dataUrl: string }>;
  startTime: number;

  // Utility functions (depend on TW/RES_SCALE)
  oddK: (base: number) => number;
  pxS: (base: number) => number;
}

/** Writes one event of the stream, held to the schema (ADR-0066). */
export type SendEvent = (event: ColorMatchEvent) => void;

export type LogStep = (step: string) => Promise<void>;
export type PushDebugImage = (label: string, dataUrl: string) => Promise<void>;

export interface ImageDims {
  TW: number; TH: number; tp: number;
  origW: number; origH: number;
  RES_SCALE: number;
  oddK: (base: number) => number;
  pxS: (base: number) => number;
}
