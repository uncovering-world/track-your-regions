/**
 * Hull Service
 *
 * Generates concave hulls for archipelago regions with proper dateline handling.
 * This is an alternative to the SQL-based hull generation that struggles with
 * regions crossing the International Date Line (like Fiji, Micronesia, Kiribati).
 *
 * Strategy for dateline-crossing regions:
 * 1. Split points into two groups: east side (lng > 0) and west side (lng < 0)
 * 2. Generate separate hulls for each group
 * 3. CLAMP all coordinates to stay within their respective side (east: 0-180, west: -180-0)
 * 4. Return a MultiPolygon with both hulls that meet exactly at the dateline
 */

// Types and constants
export type {
  HullParams,
  Point,
  GenerateSingleHullResult,
  PreviewHullResult,
  RegionData,
} from './types.js';
export { DEFAULT_HULL_PARAMS } from './types.js';

// Public API
export {
  generateSingleHull,
  previewHull,
  previewHullFromGeometry,
} from './generator.js';

// Low-level utilities (for testing or advanced use)
export { crossesDateline, splitPointsAtDateline } from './dateline.js';
export { normalizeLngForRange, clampPolygonToLngRange, ensureEdgeAt } from './clamp.js';
export { extractEdgeLatitudes, adjustEdgeLatRange, alignDatelineEdges } from './align.js';
export { generateHullForPointGroup, generateHullFromPoints } from './hullCalculator.js';
