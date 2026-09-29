/**
 * The ICP's second attempt, taken when the first fit's bounding box looks
 * inflated and the curator asks for an adjustment: strategy B leaves out the
 * small island groups spatially apart from the mainland, strategy C the
 * divisions whose centroid misses the silhouette under the first transform
 * (`icpOutliers.ts`), and each re-runs the fit (`icp.ts`) on what is left.
 * The candidates are ranked against the original fit — an overflow within
 * the cap first, then the lower error and overflow.
 */

import { alignDivisionsToImage, type AlignmentResult } from './icp.js';
import {
  findBboxOutliers,
  findOverlapOutliers,
  computeSvgPathArea,
  computeBboxFromDivisions,
  type DivisionBbox,
} from './icpOutliers.js';
import { parseSvgPathPoints } from '../geometry/svgPath.js';
import type { GridDims } from '../cluster/clusterComponents.js';

/** Parse division paths + compute per-division bboxes using per-ring area */
function buildDivisionBboxes(divPaths: Array<{ id: number; svgPath: string }>): {
  divParsed: Array<{ id: number; points: Array<[number, number]> }>;
  divBboxes: DivisionBbox[];
} {
  const divParsed = divPaths.map(d => ({
    id: d.id,
    points: parseSvgPathPoints(d.svgPath),
  }));
  const divBboxes: DivisionBbox[] = divPaths.map(d => {
    const points = divParsed.find(p => p.id === d.id)!.points;
    let dMinX = Infinity, dMaxX = -Infinity, dMinY = Infinity, dMaxY = -Infinity;
    for (const [x, y] of points) {
      if (x < dMinX) dMinX = x;
      if (x > dMaxX) dMaxX = x;
      if (y < dMinY) dMinY = y;
      if (y > dMaxY) dMaxY = y;
    }
    return { id: d.id, minX: dMinX, maxX: dMaxX, minY: dMinY, maxY: dMaxY, area: computeSvgPathArea(d.svgPath) };
  });
  return { divParsed, divBboxes };
}

type IcpAlignParams = Parameters<typeof alignDivisionsToImage>[0];

interface AlignmentCandidate {
  label: string;
  overflow: number;
  error: number;
  result: AlignmentResult | null;
}

/** Rank candidates by (overflow within cap first, then composite err*3 + overflow) */
function rankAlignmentCandidates(candidates: AlignmentCandidate[], overflowCap: number): void {
  for (const c of candidates) {
    console.log(`  [ICP Adjust] Candidate ${c.label}: overflow=${c.overflow.toFixed(1)}, err=${c.error.toFixed(1)}`);
  }
  candidates.sort((a, b) => {
    const aOk = a.overflow <= overflowCap;
    const bOk = b.overflow <= overflowCap;
    if (aOk !== bOk) return aOk ? -1 : 1;
    return (a.error * 3 + a.overflow) - (b.error * 3 + b.overflow);
  });
}

type SimpleBbox = { minX: number; maxX: number; minY: number; maxY: number };

/** Build Strategy B candidate: exclude bbox outliers, re-align on remaining */
async function tryStrategyB(
  divBboxes: DivisionBbox[],
  icpParams: IcpAlignParams,
  cBbox: SimpleBbox,
): Promise<AlignmentCandidate | null> {
  const excludedB = findBboxOutliers(divBboxes, cBbox);
  const remainingB = divBboxes.filter(d => !excludedB.includes(d.id));
  if (excludedB.length === 0 || remainingB.length === 0) return null;
  const bboxB = computeBboxFromDivisions(remainingB);
  console.log(`  [ICP Adjust B] Excluded ${excludedB.length} divisions: [${excludedB}]`);
  const resultB = await alignDivisionsToImage({ ...icpParams, gBboxOverride: bboxB, scaleRange: 0.25 });
  return { label: 'strategyB', overflow: resultB.bestOverflow, error: resultB.bestError, result: resultB };
}

/** Build Strategy C candidate: exclude overlap outliers, re-align on remaining */
async function tryStrategyC(
  divBboxes: DivisionBbox[],
  divParsed: Array<{ id: number; points: Array<[number, number]> }>,
  icpParams: IcpAlignParams,
  gadmToPixel: (gx: number, gy: number) => [number, number],
  icpMask: Uint8Array,
  dims: GridDims,
): Promise<AlignmentCandidate | null> {
  const excludedC = findOverlapOutliers(divParsed, gadmToPixel, icpMask, dims.TW, dims.TH);
  const remainingC = divBboxes.filter(d => !excludedC.includes(d.id));
  if (excludedC.length === 0 || remainingC.length === 0) return null;
  // Safeguard: if the distorted initial transform causes most centroids to
  // project outside the CV mask, Strategy C over-excludes mainland divisions.
  // Discard when >60% are excluded — the transform is too bad for overlap testing.
  if (excludedC.length > divBboxes.length * 0.6) {
    console.log(`  [ICP Adjust C] Skipped — excluded ${excludedC.length}/${divBboxes.length} divisions (>60%), transform too distorted for overlap test`);
    return null;
  }
  const bboxC = computeBboxFromDivisions(remainingC);
  console.log(`  [ICP Adjust C] Excluded ${excludedC.length} divisions: [${excludedC}]`);
  const resultC = await alignDivisionsToImage({ ...icpParams, gBboxOverride: bboxC, scaleRange: 0.25 });
  return { label: 'strategyC', overflow: resultC.bestOverflow, error: resultC.bestError, result: resultC };
}

interface IcpAdjustmentAttemptParams {
  divPaths: Array<{ id: number; svgPath: string }>;
  icpParams: IcpAlignParams;
  cBbox: SimpleBbox;
  bestOverflow: number;
  bestError: number;
  gadmToPixel: (gx: number, gy: number) => [number, number];
  icpMask: Uint8Array;
  dims: GridDims;
}

/** Run both ICP adjustment strategies (B and C) and return the winning transform, if any. */
export async function runIcpAdjustment(p: IcpAdjustmentAttemptParams): Promise<((gx: number, gy: number) => [number, number]) | null> {
  const { divParsed, divBboxes } = buildDivisionBboxes(p.divPaths);
  const candidates: AlignmentCandidate[] = [
    { label: 'original', overflow: p.bestOverflow, error: p.bestError, result: null },
  ];

  const b = await tryStrategyB(divBboxes, p.icpParams, p.cBbox);
  if (b) candidates.push(b);

  const c = await tryStrategyC(divBboxes, divParsed, p.icpParams, p.gadmToPixel, p.icpMask, p.dims);
  if (c) candidates.push(c);

  const overflowCap = Math.max(p.dims.TW, p.dims.TH) * 0.10;
  rankAlignmentCandidates(candidates, overflowCap);

  const winner = candidates[0];
  if (winner.result) {
    console.log(`  [ICP Adjust] Winner: ${winner.label} (ICP ${winner.result.bestLabel}, err=${winner.result.bestError.toFixed(1)}, overflow=${winner.result.bestOverflow.toFixed(0)}px)`);
    return winner.result.gadmToPixel;
  }
  console.log(`  [ICP Adjust] Original alignment was best — keeping it`);
  return null;
}
