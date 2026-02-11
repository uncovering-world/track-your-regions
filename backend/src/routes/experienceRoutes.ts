/**
 * Experience Routes
 *
 * Public endpoints for browsing experiences.
 * User visited endpoints are in userRoutes.ts
 */

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  listExperiences,
  getExperience,
  getExperiencesByRegion,
  getExperienceRegionCounts,
  listCategories,
  searchExperiences,
  getExperienceLocations,
  getExperienceTreasures,
  rejectExperience,
  unrejectExperience,
  assignExperienceToRegion,
  unassignExperienceFromRegion,
  removeExperienceFromRegion,
  createManualExperience,
  editExperience,
  getCurationLog,
} from '../controllers/experience/index.js';
import { requireAuth, requireCurator, optionalAuth } from '../middleware/auth.js';
import { validate } from '../middleware/errorHandler.js';
import {
  experienceSearchQuerySchema,
  experienceListQuerySchema,
  experiencesByRegionQuerySchema,
  experienceRegionCountsQuerySchema,
  experienceLocationsQuerySchema,
  idParamSchema,
  regionIdParamSchema,
  idAndRegionIdParamSchema,
  rejectExperienceBodySchema,
  unrejectExperienceBodySchema,
  assignExperienceBodySchema,
  editExperienceBodySchema,
  createManualExperienceBodySchema,
} from '../types/index.js';

const router = Router();

const searchLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 searches per minute per IP
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many search requests, please try again later' },
});

// =============================================================================
// Public Experience Routes
// =============================================================================

// Search experiences (full-text search)
router.get('/search', searchLimiter, validate(experienceSearchQuerySchema, 'query'), searchExperiences);

// List experience categories
router.get('/categories', listCategories);

// Get experience counts per region per category (for Discover page tree)
router.get('/region-counts', validate(experienceRegionCountsQuerySchema, 'query'), getExperienceRegionCounts);

// Get experiences by region (optionalAuth to support curator rejection visibility)
router.get('/by-region/:regionId', validate(regionIdParamSchema, 'params'), validate(experiencesByRegionQuerySchema, 'query'), optionalAuth, getExperiencesByRegion);

// List experiences with filtering
router.get('/', validate(experienceListQuerySchema, 'query'), listExperiences);

// =============================================================================
// Curation Routes (require curator auth)
// =============================================================================
// These must be defined BEFORE the /:id catch-all route

// Create a new manual experience (Curator Picks)
router.post('/', requireAuth, requireCurator, validate(createManualExperienceBodySchema), createManualExperience);

// Reject an experience from a region
router.post('/:id/reject', validate(idParamSchema, 'params'), requireAuth, requireCurator, validate(rejectExperienceBodySchema), rejectExperience);

// Unreject an experience from a region
router.post('/:id/unreject', validate(idParamSchema, 'params'), requireAuth, requireCurator, validate(unrejectExperienceBodySchema), unrejectExperience);

// Manually assign an experience to a region
router.post('/:id/assign', validate(idParamSchema, 'params'), requireAuth, requireCurator, validate(assignExperienceBodySchema), assignExperienceToRegion);

// Edit an experience's fields (curator)
router.patch('/:id/edit', validate(idParamSchema, 'params'), requireAuth, requireCurator, validate(editExperienceBodySchema), editExperience);

// Get curation log for an experience
router.get('/:id/curation-log', validate(idParamSchema, 'params'), requireAuth, requireCurator, getCurationLog);

// Unassign an experience from a region (manual only)
router.delete('/:id/assign/:regionId', validate(idAndRegionIdParamSchema, 'params'), requireAuth, requireCurator, unassignExperienceFromRegion);

// Remove an experience from a region entirely (any assignment type, keeps rejection as guard)
router.delete('/:id/remove-from-region/:regionId', validate(idAndRegionIdParamSchema, 'params'), requireAuth, requireCurator, removeExperienceFromRegion);

// Get single experience
router.get('/:id', validate(idParamSchema, 'params'), getExperience);

// Get locations for an experience (multi-location support)
router.get('/:id/locations', validate(idParamSchema, 'params'), validate(experienceLocationsQuerySchema, 'query'), getExperienceLocations);

// Get treasures (artworks, artifacts) for an experience
router.get('/:id/treasures', validate(idParamSchema, 'params'), getExperienceTreasures);

export default router;
