/**
 * Geocode Routes — Place search (Nominatim) and AI geocoding.
 * Search is public; AI geocode requires curator/admin auth.
 */

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { searchPlaces, suggestImage } from '../controllers/geocodeController.js';
import { geocodeWithAI } from '../controllers/aiController.js';
import { requireAuth, requireCurator } from '../middleware/auth.js';
import { validate } from '../middleware/errorHandler.js';
import { geocodeSearchQuerySchema, suggestImageQuerySchema, aiGeocodeBodySchema } from '../types/index.js';

const router = Router();

const searchLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 searches per minute per IP
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many search requests, please try again later' },
});

// Search places by name (public)
router.get('/search', searchLimiter, validate(geocodeSearchQuerySchema, 'query'), searchPlaces);

// AI geocode (curator or admin)
router.post('/ai', requireAuth, requireCurator, validate(aiGeocodeBodySchema), geocodeWithAI);

// Suggest image from Wikidata (curator or admin)
router.get('/suggest-image', requireAuth, requireCurator, validate(suggestImageQuerySchema, 'query'), suggestImage);

export default router;
