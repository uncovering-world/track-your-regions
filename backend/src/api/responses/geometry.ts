/**
 * What the geometry client's calls answer (ADR-0066): the success bodies of the
 * endpoints `frontend/src/api/geometry.ts` calls, declared once. That is one
 * region's computation and its progress stream, a world view's computation and
 * its status, the frame metadata a run leaves, a region reset to its members,
 * and the hull editor's preview, save and saved parameters. One region's
 * computation also answers without the stream (`SingleRegionComputed`), a
 * route no screen calls.
 *
 * Each exported schema is the type of the same name in `@tyr/shared/api`. A
 * handler sends a body through `respond()` and a stream's events through
 * `writeEvent()`, which hold them to the schema. Imports are held to the list
 * in the header of `curation.ts` beside this file, which also says why.
 */

import { z } from 'zod/v4';
import { AnchorPoint, AreaGeometry, FocusBbox } from './regions.js';

// ---------------------------------------------------------------------------
// One region's computation, streamed
// ---------------------------------------------------------------------------

export const ComputeResult = z.strictObject({
  computed: z.literal(true),
  preserved: z.literal(true).optional()
    .describe('Sent alone beside `computed` when the region keeps a hand-drawn boundary, so nothing was computed.'),
  points: z.number().int().optional().describe('Vertices in the computed outline.'),
  usesHull: z.boolean().optional(),
  hullGenerated: z.boolean().optional().describe('A hull was rebuilt with the outline, for a region drawn as one.'),
  numPolygons: z.number().int().optional(),
  numHoles: z.number().int().optional(),
  focusBbox: FocusBbox.nullable().optional().describe('The region\'s frame as the computed outline left it.'),
  anchorPoint: AnchorPoint.nullable().optional(),
  tileVersion: z.number().int().optional().describe('The world view\'s tile version after the run bumped it.'),
}).describe('What a finished computation of one region left.');
export type ComputeResult = z.infer<typeof ComputeResult>;

export const CustomBoundaryPreserved = z.strictObject({
  computed: z.literal(true),
  regionId: z.number().int(),
  name: z.string(),
  usesHull: z.boolean(),
  message: z.string(),
}).describe('A region with a hand-drawn boundary, left as drawn.');
export type CustomBoundaryPreserved = z.infer<typeof CustomBoundaryPreserved>;

export const NothingToMerge = z.strictObject({
  computed: z.literal(false),
  message: z.string(),
  childrenComputed: z.number().int().describe('Child regions computed on the way, before the region itself found nothing to merge.'),
}).describe('A region whose members and children hold no geometry to merge.');
export type NothingToMerge = z.infer<typeof NothingToMerge>;

export const RegionComputed = z.strictObject({
  computed: z.literal(true),
  points: z.number().int().describe('Vertices in the computed outline.'),
  childrenComputed: z.number().int(),
  usesHull: z.boolean().optional(),
  hullGenerated: z.boolean().optional(),
  crossesDateline: z.boolean().optional(),
  tileVersion: z.number().int().optional().describe('The world view\'s tile version after the run bumped it.'),
}).describe('A region\'s outline computed, its children\'s first.');
export type RegionComputed = z.infer<typeof RegionComputed>;

export const SingleRegionComputed = z.union([RegionComputed, CustomBoundaryPreserved, NothingToMerge])
  .describe('One region\'s computation, answered at its end rather than streamed. No screen calls it; the editor streams.');
export type SingleRegionComputed = z.infer<typeof SingleRegionComputed>;

export const ComputeProgress = z.strictObject({
  type: z.literal('progress'),
  step: z.string().describe('What the computation is doing, as a line of the progress log.'),
  elapsed: z.number().describe('Seconds since the stream opened.'),
  data: z.record(z.string(), z.unknown()).optional()
    .describe('The step\'s own figures, shown as they come: each step logs its own.'),
});
export type ComputeProgress = z.infer<typeof ComputeProgress>;

export const ComputeComplete = z.strictObject({
  type: z.literal('complete'),
  elapsed: z.number().optional(),
  message: z.string().optional(),
  data: ComputeResult,
});
export type ComputeComplete = z.infer<typeof ComputeComplete>;

export const ComputeFailed = z.strictObject({
  type: z.literal('error'),
  message: z.string(),
  elapsed: z.number().optional(),
});
export type ComputeFailed = z.infer<typeof ComputeFailed>;

export const ComputeProgressEvent = z.union([ComputeProgress, ComputeComplete, ComputeFailed])
  .describe('One event of a region\'s computation stream: a step, the result, or the failure that ends it.');
export type ComputeProgressEvent = z.infer<typeof ComputeProgressEvent>;

// ---------------------------------------------------------------------------
// A world view's computation, polled
// ---------------------------------------------------------------------------

export const ComputationStartResult = z.strictObject({
  started: z.boolean().describe('False when every region already had a geometry, so there was nothing to run.'),
  total: z.number().int().describe('Regions in the world view.'),
  needsComputation: z.number().int(),
  alreadyComputed: z.number().int(),
  message: z.string(),
}).describe('A world view\'s computation, started in the background or found unnecessary.');
export type ComputationStartResult = z.infer<typeof ComputationStartResult>;

export const ComputationStatus = z.strictObject({
  running: z.boolean(),
  progress: z.number().int().optional(),
  total: z.number().int().optional(),
  status: z.string().optional().describe('The step in words; `Complete`, `Cancelled` or `Error: …` once it has ended.'),
  percent: z.number().int().optional(),
  computed: z.number().int().optional(),
  skipped: z.number().int().optional(),
  errors: z.number().int().optional(),
  currentRegion: z.string().optional(),
  currentMembers: z.number().int().optional(),
}).describe('A world view\'s computation as it stands. Only `running` is sent while no run is known, since the server started or since the last one was cleared.');
export type ComputationStatus = z.infer<typeof ComputationStatus>;

export const ComputationCancelled = z.strictObject({
  cancelled: z.literal(true),
}).describe('A stop asked of a world view\'s computation; a run in flight ends at its next region.');
export type ComputationCancelled = z.infer<typeof ComputationCancelled>;

// ---------------------------------------------------------------------------
// What a run leaves
// ---------------------------------------------------------------------------

export const DisplayGeometryStatus = z.strictObject({
  total: z.number().int().describe('Regions in the world view.'),
  withGeom: z.number().int().describe('Regions with a computed outline.'),
  withAnchor: z.number().int().describe('Regions whose frame and anchor are set, which is what a run\'s regeneration step writes.'),
  hullRegions: z.number().int().describe('Regions drawn as a hull.'),
  withHull: z.number().int().describe('Regions with a hull built.'),
}).describe('How much of a world view has its geometry and the frame metadata that goes with it.');
export type DisplayGeometryStatus = z.infer<typeof DisplayGeometryStatus>;

export const RegenerateDisplayGeometriesResult = z.strictObject({
  regenerated: z.number().int(),
  message: z.string(),
}).describe('Regions whose area, frame and anchor were recomputed from their stored outline.');
export type RegenerateDisplayGeometriesResult = z.infer<typeof RegenerateDisplayGeometriesResult>;

export const RegionReset = z.strictObject({
  reset: z.literal(true),
  points: z.number().int().describe('Vertices of the outline rebuilt from its members; 0 where it has none.'),
  message: z.string(),
}).describe('A region\'s hand-drawn boundary and hull dropped, and its outline rebuilt from its members.');
export type RegionReset = z.infer<typeof RegionReset>;

// ---------------------------------------------------------------------------
// The hull editor
// ---------------------------------------------------------------------------

export const HullParams = z.strictObject({
  bufferKm: z.number().describe('Buffer around the islands, in km.'),
  concavity: z.number().describe('How loosely the hull fits: higher takes in far islands.'),
  simplifyTolerance: z.number().describe('Simplification, in degrees.'),
}).describe('The parameters a region\'s hull is built with.');
export type HullParams = z.infer<typeof HullParams>;

export const HullPreview = z.strictObject({
  geometry: AreaGeometry.nullable(),
  pointCount: z.number().int().describe('Points the hull was built around.'),
  crossesDateline: z.boolean(),
  params: HullParams,
}).describe('A hull built with the given parameters and not saved.');
export type HullPreview = z.infer<typeof HullPreview>;

export const HullSaved = z.strictObject({
  saved: z.boolean(),
  pointCount: z.number().int(),
  crossesDateline: z.boolean(),
  params: HullParams,
}).describe('A hull built with the given parameters and stored with them.');
export type HullSaved = z.infer<typeof HullSaved>;

export const SavedHullParams = z.strictObject({
  params: HullParams.nullable().describe('Null where the region\'s hull has never been tuned: it is built with the defaults.'),
}).describe('The parameters a region\'s hull was saved with.');
export type SavedHullParams = z.infer<typeof SavedHullParams>;
