/**
 * Types for division controller
 */

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
