/**
 * Division Controller
 *
 * Handles all operations related to administrative divisions (GADM data).
 */

// Types
export type { AdministrativeDivision, AdministrativeDivisionWithPath } from './types.js';

// CRUD operations
export {
  getRootDivisions,
  getDivisionById,
  getSubdivisions,
  getAncestors,
  getSiblings,
} from './divisionCrud.js';

// Geometry operations
export {
  getGeometry,
  getSubdivisionGeometries,
  getRootGeometries,
} from './divisionGeometry.js';

// Search operations
export { searchDivisions } from './divisionSearch.js';
