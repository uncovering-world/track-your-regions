/**
 * Administrative Divisions Routes
 *
 * Handles GADM administrative divisions (countries, states, cities, etc.)
 * Mounted at /api/divisions.
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
import {
  getSubdivisionsQuerySchema,
  getGeometryQuerySchema,
  searchQuerySchema,
} from '../types/index.js';

const router = Router();

router.get('/root', getRootDivisions);
router.get('/root/geometries', getRootGeometries);
router.get('/search', validate(searchQuerySchema, 'query'), searchDivisions);
router.get('/:divisionId', getDivisionById);
router.get('/:divisionId/subdivisions', validate(getSubdivisionsQuerySchema, 'query'), getSubdivisions);
router.get('/:divisionId/subdivisions/geometries', getSubdivisionGeometries);
router.get('/:divisionId/ancestors', getAncestors);
router.get('/:divisionId/siblings', getSiblings);
router.get('/:divisionId/geometry', validate(getGeometryQuerySchema, 'query'), getGeometry);

export default router;
