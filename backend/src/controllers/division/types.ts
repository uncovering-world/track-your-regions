/**
 * Types for division controller
 */

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
