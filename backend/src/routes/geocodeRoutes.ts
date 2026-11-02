/**
 * Geocode Routes — Place search and what stands at a point (Nominatim), a
 * place's article coordinate (Wikipedia), and AI geocoding.
 * Every route is the curator's: only the curator dialogs call them, and each
 * asks a third party — Nominatim, an AI model, Wikidata — on the product's
 * behalf and under its User-Agent.
 */

import { defineRoute } from '../api/route.js';
import { AIGeocodeResult } from '../api/responses/ai.js';
import { ArticlePoint, ImageSuggestion, PlaceAtPoint, PlaceSearch } from '../api/responses/geocode.js';
import { searchPlaces, suggestImage } from '../controllers/geocodeController.js';
import { articlePoint, placeAtPoint } from '../controllers/pointReferenceController.js';
import { geocodeWithAI } from '../controllers/aiController.js';
import { authenticatedLimiter, searchLimiter } from '../middleware/rateLimiter.js';
import {
  geocodeSearchQuerySchema, suggestImageQuerySchema, aiGeocodeBodySchema, idParamSchema, placeAtPointQuerySchema,
} from '../types/index.js';

export const geocodeRoutes = [
  // Search places by name, when the curator asks. Not public: anyone could
  // otherwise query Nominatim through the product's server and its contact.
  defineRoute({
    method: 'get', path: '/search', access: 'curator', cache: 'no-store', limiter: searchLimiter,
    summary: 'Search places by name in OpenStreetMap\'s Nominatim, with their coordinates',
    query: geocodeSearchQuerySchema,
    response: PlaceSearch,
    handler: searchPlaces,
  }),
  // What stands at a point, for a curator's point dialog (#2206). Queued with
  // the search behind Nominatim's one request a second; a dialog asks once per
  // pin, so it is not counted against the search's own ceiling.
  defineRoute({
    method: 'get', path: '/reverse', access: 'curator', cache: 'no-store', limiter: authenticatedLimiter,
    summary: 'Name what OpenStreetMap holds at a point: the object nearest it, its address and its area',
    query: placeAtPointQuerySchema,
    response: PlaceAtPoint,
    handler: placeAtPoint,
  }),
  // Where a place's Wikipedia article says it stands, for the same dialog (#2206).
  defineRoute({
    method: 'get', path: '/article-point/:id', access: 'curator', cache: 'no-store', limiter: authenticatedLimiter,
    summary: 'Read the coordinate a place\'s Wikipedia article states, as a reference beside its points',
    params: idParamSchema,
    response: ArticlePoint,
    handler: articlePoint,
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

