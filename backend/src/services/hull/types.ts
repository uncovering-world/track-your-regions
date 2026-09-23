/**
 * Types and constants for hull generation
 */

export interface HullParams {
  bufferKm: number;      // Buffer around the hull in km
  concavity: number;     // 0-1, higher = looser fit to include all islands (default 0.9)
  simplifyTolerance: number; // Simplification tolerance in degrees
}

// The defaults are the hull editor's too, so they are stated once, beside the
// rest of the geometry rules both sides apply (ADR-0065).
export { DEFAULT_HULL_PARAMS } from '@tyr/shared/geometry';

export interface Point {
  lng: number;
  lat: number;
}

export interface GenerateSingleHullResult {
  generated: boolean;
  pointCount?: number;
  crossesDateline?: boolean;
  error?: string;
}

export interface PreviewHullResult {
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
  pointCount: number;
  crossesDateline: boolean;
  error?: string;
  sourceBounds?: {
    minLng: number;
    maxLng: number;
    minLat: number;
    maxLat: number;
  };
}

export interface RegionData {
  points: Point[];
  usesHull: boolean;
  name: string;
  savedHullParams: HullParams | null;
  /** geometry_focus() over the very points the hull is built from, measured in the same query (#674) */
  crossesDateline: boolean;
}
