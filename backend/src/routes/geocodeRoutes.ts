/**
 * Geocode Routes — Place search (Nominatim) and AI geocoding.
 * Search is public; AI geocode requires curator/admin auth.
 */

import { Router } from 'express';
import { searchPlaces, suggestImage } from '../controllers/geocodeController.js';
import { geocodeWithAI } from '../controllers/aiController.js';
import { requireAuth, requireCurator } from '../middleware/auth.js';
import { searchLimiter } from '../middleware/rateLimiter.js';
import { validate } from '../middleware/errorHandler.js';
import { geocodeSearchQuerySchema, suggestImageQuerySchema, aiGeocodeBodySchema } from '../types/index.js';

const router = Router();

// Search places by name (public)
router.get('/search', searchLimiter, validate(geocodeSearchQuerySchema, 'query'), searchPlaces);

// AI geocode (curator or admin)
router.post('/ai', requireAuth, requireCurator, validate(aiGeocodeBodySchema), geocodeWithAI);

// Suggest image from Wikidata (curator or admin)
router.get('/suggest-image', requireAuth, requireCurator, validate(suggestImageQuerySchema, 'query'), suggestImage);

export default router;
