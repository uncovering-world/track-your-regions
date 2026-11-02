/**
 * Geocode API client — place search and what stands at a point (Nominatim), a
 * place's article coordinate (Wikipedia), and AI geocoding.
 */

import type { AIGeocodeResult, ArticlePoint, ImageSuggestion, PlaceAtPoint, PlaceResult } from './client.generated';
import {
  getGeocodeArticlePointById, getGeocodeReverse, getGeocodeSearch, getGeocodeSuggestImage, postGeocodeAi,
} from './client.generated';

// What every call here answers is declared once, as a backend schema (ADR-0066),
// and generated into `client.generated.ts`. Passed on from here, so a component
// imports a call's answer from the module of the call.
export type {
  AIGeocodeResult, ArticlePoint, ImageSuggestion, PlaceAtPoint, PlaceResult, PlaceSearch,
} from './client.generated';

/** Search places by name via Nominatim proxy */
export async function searchPlaces(query: string, limit = 5): Promise<PlaceResult[]> {
  const data = await getGeocodeSearch({ q: query, limit });
  return data.results;
}

/** What OpenStreetMap holds at a point: the object nearest it, its address and its area (#2206). */
export async function fetchPlaceAtPoint(latitude: number, longitude: number): Promise<PlaceAtPoint> {
  return getGeocodeReverse({ lat: latitude, lon: longitude });
}

/** Where a place's Wikipedia article says it stands (#2206). */
export async function fetchArticlePoint(experienceId: number): Promise<ArticlePoint> {
  return getGeocodeArticlePointById(experienceId);
}

/** Geocode a natural-language description using AI */
export async function aiGeocode(description: string): Promise<AIGeocodeResult> {
  return postGeocodeAi({ description });
}

/** Suggest an image URL from Wikidata for experience creation */
export async function suggestImageUrl(params: {
  name?: string;
  lat?: number;
  lng?: number;
  wikidataId?: string;
}): Promise<ImageSuggestion> {
  // An empty name or id is left out, as a missing one is.
  return getGeocodeSuggestImage({
    name: params.name || undefined,
    lat: params.lat ?? undefined,
    lng: params.lng ?? undefined,
    wikidataId: params.wikidataId || undefined,
  });
}
