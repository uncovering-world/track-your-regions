/**
 * Types for Track Your Regions
 *
 * Terminology:
 * - AdministrativeDivision: Official GADM boundary (Germany, Bavaria, Munich)
 * - WorldView: Custom hierarchy for organizing regions
 * - Region: User-defined grouping within a WorldView
 */

import type { AdministrativeDivision as DivisionAnswer, Region as RegionAnswer } from '@tyr/shared/api';

// =============================================================================
// Administrative Divisions (GADM boundaries)
// =============================================================================

/**
 * An official GADM boundary as the client holds it (Germany, Bavaria, Munich).
 *
 * Every read answers with the whole row, `AdministrativeDivision` in
 * `@tyr/shared/api` (ADR-0066). A selection made on the map starts from what a
 * vector tile carries, so past the four keys every selection sets its stored
 * focus may still be missing, as for a region below. Derived from the answer,
 * never declared beside it.
 */
export type AdministrativeDivision =
  Pick<DivisionAnswer, 'id' | 'name' | 'parentId' | 'hasChildren'> & Partial<DivisionAnswer>;

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
// GeoJSON Types
// =============================================================================

/**
 * An area on the map, one piece or several, as the client holds one it draws,
 * cuts or combines. The geometry reads declare theirs in `@tyr/shared/api`
 * (`MultiPolygon`, `AreaGeometry`), and every one of those is assignable to
 * this: the union of the two `geojson` types, which needs no cast at a map
 * surface.
 */
export type GeoJSONGeometry = GeoJSON.Polygon | GeoJSON.MultiPolygon;

// =============================================================================
// Auth Types (re-exported from auth.ts)
// =============================================================================

export type { UserRole, AuthState, LoginCredentials, RegisterCredentials } from './auth.js';

