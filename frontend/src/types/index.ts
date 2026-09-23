/**
 * Types for Track Your Regions
 *
 * Terminology:
 * - AdministrativeDivision: Official GADM boundary (Germany, Bavaria, Munich)
 * - WorldView: Custom hierarchy for organizing regions
 * - Region: User-defined grouping within a WorldView
 * - RegionMember: A member of a Region (can be division or subregion)
 */

import type { Region as RegionAnswer } from '@tyr/shared/api';

// =============================================================================
// Administrative Divisions (GADM boundaries)
// =============================================================================

/** Official geographic boundary from GADM (Germany, Bavaria, Munich) */
export interface AdministrativeDivision {
  id: number;
  name: string;
  parentId: number | null;
  hasChildren: boolean;
  /** [west, south, east, north]; west > east = antimeridian crossing. Stored, from geometry_focus() (#674) */
  focusBbox?: [number, number, number, number] | null;
  /** [lng, lat] -- the centre of that frame; the camera goes here for a crossing box */
  anchorPoint?: [number, number] | null;
}

export interface AdministrativeDivisionWithPath extends AdministrativeDivision {
  path: string;
  usageCount?: number;
  usedAsSubdivisionCount?: number;
  hasUsedSubdivisions?: boolean;
}

// =============================================================================
// Regions (user-defined groupings within a WorldView)
// =============================================================================

/**
 * A region as the client holds it.
 *
 * Every read and write answers with the whole row, `Region` in
 * `@tyr/shared/api` (ADR-0066). A selection made on the map starts from less:
 * a vector tile carries a region's id, name, colour and, in most layers, its
 * parent, and the ancestors read completes the rest (`useAddressedRegion`). So
 * past the six keys every selection sets, the world view's and a null
 * description among them, any of the row's keys may still be missing. An
 * answer is assignable to this, and nothing here declares a key of its own.
 */
export type Region =
  Pick<RegionAnswer, 'id' | 'worldViewId' | 'name' | 'description' | 'parentRegionId' | 'color'> & Partial<RegionAnswer>;

// =============================================================================
// Region Members (contents of a user-defined region)
// =============================================================================

/**
 * A member of a user-defined region
 * Can be either an administrative division or a subregion
 */
export interface RegionMember {
  id: number;
  memberRowId?: number; // Unique row ID for division members (allows duplicates of same division with different geometries)
  name: string;
  parentId: number | null;
  hasChildren: boolean;
  memberType: 'division' | 'subregion';
  isSubregion: boolean;
  color?: string;
  path?: string;
  hasCustomGeometry?: boolean;
}

// =============================================================================
// GeoJSON Types
// =============================================================================

/**
 * What every geometry endpoint answers with: an area on the map, one piece or
 * several.
 *
 * The two `geojson` types rather than a hand-written pair of fields, because
 * the hand-written one said `type: 'Polygon' | 'MultiPolygon'` beside
 * `coordinates: number[][][] | number[][][][]` — four combinations for two
 * shapes, so nothing could tell a `Polygon` carrying a multipolygon's
 * coordinates from a real one. That was assignable to no library's geometry
 * type, which is why the map surfaces cast their way past it; the union of the
 * two real shapes needs no cast anywhere.
 */
export type GeoJSONGeometry = GeoJSON.Polygon | GeoJSON.MultiPolygon;

export interface GeoJSONFeature {
  type: 'Feature';
  properties: Record<string, unknown>;
  geometry: GeoJSONGeometry;
}

// =============================================================================
// Auth Types (re-exported from auth.ts)
// =============================================================================

export type { User, UserRole, AuthResponse, AuthState, LoginCredentials, RegisterCredentials } from './auth.js';

