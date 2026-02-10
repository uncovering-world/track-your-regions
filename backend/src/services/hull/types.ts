/**
 * Types and constants for hull generation
 */

export interface HullParams {
  bufferKm: number;      // Buffer around the hull in km
  concavity: number;     // 0-1, higher = looser fit to include all islands (default 0.9)
  simplifyTolerance: number; // Simplification tolerance in degrees
}

export const DEFAULT_HULL_PARAMS: HullParams = {
  bufferKm: 50,
  concavity: 0.9,
  simplifyTolerance: 0.02,
};

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
  geometry: GeoJSON.Geometry | null;
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
  isArchipelago: boolean;
  name: string;
  savedHullParams: HullParams | null;
}
