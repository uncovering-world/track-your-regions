/**
 * Division Controller
 *
 * Handles all operations related to administrative divisions (GADM data).
 */

// CRUD operations
export {
  getRootDivisions,
  getDivisionById,
  getSubdivisions,
  getAncestors,
  getSiblings,
} from './divisionCrud.js';

// Geometry operations
export { getGeometry } from './divisionGeometry.js';

// Search operations
export { searchDivisions } from './divisionSearch.js';
