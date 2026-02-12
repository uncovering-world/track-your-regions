/**
 * Experience Routes
 *
 * Public endpoints for browsing experiences.
 * User visited endpoints are in userRoutes.ts
 */

import { Router } from 'express';
import {
  listExperiences,
  getExperience,
  getExperiencesByRegion,
  getExperienceRegionCounts,
  getRegionExperienceLocations,
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
import { publicReadLimiter, searchLimiter } from '../middleware/rateLimiter.js';
import { validate } from '../middleware/errorHandler.js';
import {
  experienceSearchQuerySchema,
  experienceListQuerySchema,
  experiencesByRegionQuerySchema,
  experienceRegionCountsQuerySchema,
  experienceLocationsQuerySchema,
  regionLocationsQuerySchema,
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

// =============================================================================
// Public Experience Routes
// =============================================================================

// Search experiences (full-text search)
router.get('/search', searchLimiter, validate(experienceSearchQuerySchema, 'query'), searchExperiences);

// List experience categories
router.get('/categories', publicReadLimiter, listCategories);

// Get experience counts per region per category (for Discover page tree)
router.get('/region-counts', publicReadLimiter, validate(experienceRegionCountsQuerySchema, 'query'), getExperienceRegionCounts);

// Get experiences by region (optionalAuth to support curator rejection visibility)
router.get('/by-region/:regionId', publicReadLimiter, validate(regionIdParamSchema, 'params'), validate(experiencesByRegionQuerySchema, 'query'), optionalAuth, getExperiencesByRegion);

// Get all locations for all experiences in a region (batch, eliminates N+1)
router.get('/by-region/:regionId/locations', publicReadLimiter, validate(regionIdParamSchema, 'params'), validate(regionLocationsQuerySchema, 'query'), getRegionExperienceLocations);

// List experiences with filtering
router.get('/', publicReadLimiter, validate(experienceListQuerySchema, 'query'), listExperiences);

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
router.get('/:id', publicReadLimiter, validate(idParamSchema, 'params'), getExperience);

// Get locations for an experience (multi-location support)
router.get('/:id/locations', publicReadLimiter, validate(idParamSchema, 'params'), validate(experienceLocationsQuerySchema, 'query'), getExperienceLocations);

// Get treasures (artworks, artifacts) for an experience
router.get('/:id/treasures', publicReadLimiter, validate(idParamSchema, 'params'), getExperienceTreasures);

export default router;
