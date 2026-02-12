/**
 * Administrative Divisions Routes
 *
 * Handles GADM administrative divisions (countries, states, cities, etc.)
 * Mounted at both /api/regions (legacy) and /api/divisions (new)
 */
import { Router } from 'express';
import { validate } from '../middleware/errorHandler.js';
import {
  getRootDivisions,
  getDivisionById,
  getSubdivisions,
  getAncestors,
  getSiblings,
  getGeometry,
  searchDivisions,
  getSubdivisionGeometries,
  getRootGeometries,
} from '../controllers/division/index.js';
import { getWorldViews } from '../controllers/worldView/index.js';
import {
  getSubdivisionsQuerySchema,
  getGeometryQuerySchema,
  searchQuerySchema,
} from '../types/index.js';

const router = Router();

// World View list (returns available World Views including default GADM)
router.get('/hierarchies', getWorldViews);

// =============================================================================
// Administrative Division endpoints
// =============================================================================
router.get('/root', getRootDivisions);  // Root-level divisions (continents/countries)
router.get('/root/geometries', getRootGeometries);
router.get('/search', validate(searchQuerySchema, 'query'), searchDivisions);
router.get('/:divisionId', getDivisionById);  // Get single division
router.get('/:divisionId/subregions', validate(getSubdivisionsQuerySchema, 'query'), getSubdivisions);  // Child divisions (legacy path)
router.get('/:divisionId/subdivisions', validate(getSubdivisionsQuerySchema, 'query'), getSubdivisions);  // Child divisions (new path)
router.get('/:divisionId/subregions/geometries', getSubdivisionGeometries);  // Legacy path
router.get('/:divisionId/subdivisions/geometries', getSubdivisionGeometries);  // New path
router.get('/:divisionId/ancestors', getAncestors);  // Parent hierarchy
router.get('/:divisionId/siblings', getSiblings);  // Same-level divisions
router.get('/:divisionId/geometry', validate(getGeometryQuerySchema, 'query'), getGeometry);

export default router;
