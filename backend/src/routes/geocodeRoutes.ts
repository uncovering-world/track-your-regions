/**
 * Geocode Routes — Place search (Nominatim) and AI geocoding.
 * Search is public; AI geocode requires curator/admin auth.
 */

import { defineRoute, routerOf } from '../api/route.js';
import { AIGeocodeResult } from '../api/responses/ai.js';
import { ImageSuggestion, PlaceSearch } from '../api/responses/geocode.js';
import { searchPlaces, suggestImage } from '../controllers/geocodeController.js';
import { geocodeWithAI } from '../controllers/aiController.js';
import { searchLimiter } from '../middleware/rateLimiter.js';
import { geocodeSearchQuerySchema, suggestImageQuerySchema, aiGeocodeBodySchema } from '../types/index.js';

export const geocodeRoutes = [
  // Search places by name. The same answer for everyone who asks.
  defineRoute({
    method: 'get', path: '/search', access: 'public', cache: 'shared-revalidate', limiter: searchLimiter,
    query: geocodeSearchQuerySchema,
    response: PlaceSearch,
    handler: searchPlaces,
  }),
  defineRoute({
    method: 'post', path: '/ai', access: 'curator', cache: 'no-store',
    body: aiGeocodeBodySchema,
    response: AIGeocodeResult,
    handler: geocodeWithAI,
  }),
  // Suggest an image from Wikidata for a new experience.
  defineRoute({
    method: 'get', path: '/suggest-image', access: 'curator', cache: 'no-store',
    query: suggestImageQuerySchema,
    response: ImageSuggestion,
    handler: suggestImage,
  }),
];

export default routerOf(geocodeRoutes);
