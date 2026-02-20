/**
 * Types for Track Your Regions
 *
 * Terminology:
 * - AdministrativeDivision: Official GADM boundary (Germany, Bavaria, Munich)
 * - WorldView: Custom hierarchy for organizing regions
 * - Region: User-defined grouping within a WorldView
 * - RegionMember: A member of a Region (can be division or subregion)
 */

// =============================================================================
// Administrative Divisions (GADM boundaries)
// =============================================================================

/** Official geographic boundary from GADM (Germany, Bavaria, Munich) */
export interface AdministrativeDivision {
  id: number;
  name: string;
  parentId: number | null;
  hasChildren: boolean;
}

export interface AdministrativeDivisionWithPath extends AdministrativeDivision {
  path: string;
  usageCount?: number;
  usedAsSubdivisionCount?: number;
  hasUsedSubdivisions?: boolean;
}

// =============================================================================
// World Views
// =============================================================================

/** A custom way of organizing administrative divisions */
export interface WorldView {
  id: number;
  name: string;
  description: string | null;
  source: string | null;
  isDefault: boolean;
  tileVersion?: number;
}

// =============================================================================
// Regions (user-defined groupings within a WorldView)
// =============================================================================

/**
 * A user-defined grouping within a WorldView
 * Examples: "Europe", "Baltic States", "Nordic Countries"
 */
export interface Region {
  id: number;
  worldViewId: number;
  name: string;
  description: string | null;
  parentRegionId: number | null;
  color: string | null;
  hasSubregions?: boolean;
  isCustomBoundary?: boolean;
  usesHull?: boolean;
  hasHullChildren?: boolean;
  // Pre-computed bounding box [west, south, east, north] for instant fitBounds. West > east = antimeridian crossing.
  focusBbox?: [number, number, number, number] | null;
  // Pre-computed anchor point [lng, lat] - centroid, used for antimeridian-crossing regions
  anchorPoint?: [number, number] | null;
  // Import source metadata (present on regions imported from external sources)
  sourceUrl?: string | null;
  regionMapUrl?: string | null;
}

export interface RegionWithMembers extends Region {
  memberCount: number;
}

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
// Views (for filtering/displaying specific sets)
// =============================================================================

export interface View {
  id: number;
  name: string;
  description: string | null;
  worldViewId: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// =============================================================================
// GeoJSON Types
// =============================================================================

export interface GeoJSONGeometry {
  type: 'MultiPolygon' | 'Polygon';
  coordinates: number[][][] | number[][][][];
}

export interface GeoJSONFeature {
  type: 'Feature';
  properties: Record<string, unknown>;
  geometry: GeoJSONGeometry;
}

// =============================================================================
// Auth Types (re-exported from auth.ts)
// =============================================================================

export type { User, UserRole, AuthResponse, AuthState, LoginCredentials, RegisterCredentials } from './auth.js';

