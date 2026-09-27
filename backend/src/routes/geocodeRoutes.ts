/**
 * Geocode Routes — Place search (Nominatim) and AI geocoding.
 * Search is public; AI geocode requires curator/admin auth.
 */

import { defineRoute } from '../api/route.js';
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
    summary: 'Search places by name in OpenStreetMap\'s Nominatim, with their coordinates',
    query: geocodeSearchQuerySchema,
    response: PlaceSearch,
    handler: searchPlaces,
  }),
  defineRoute({
    method: 'post', path: '/ai', access: 'curator', cache: 'no-store',
    summary: 'Locate a place from a free-text description with an AI model, with a confidence',
    body: aiGeocodeBodySchema,
    response: AIGeocodeResult,
    handler: geocodeWithAI,
  }),
  // Suggest an image from Wikidata for a new experience.
  defineRoute({
    method: 'get', path: '/suggest-image', access: 'curator', cache: 'no-store',
    summary: 'Suggest a picture for a new place from Wikidata, by its item, coordinates or name',
    query: suggestImageQuerySchema,
    response: ImageSuggestion,
    handler: suggestImage,
  }),
];

