/**
 * Geocode API client — place search (Nominatim) and AI geocoding.
 */

import type { AIGeocodeResult, ImageSuggestion, PlaceResult } from '@tyr/shared/api';
import { getGeocodeSearch, getGeocodeSuggestImage, postGeocodeAi } from './client.generated';

// What every call here answers is declared once, as a backend schema (ADR-0066),
// and generated into `@tyr/shared/api`. Passed on from here, so a component
// imports a call's answer from the module of the call.
export type { AIGeocodeResult, ImageSuggestion, PlaceResult, PlaceSearch } from '@tyr/shared/api';

/** Search places by name via Nominatim proxy */
export async function searchPlaces(query: string, limit = 5): Promise<PlaceResult[]> {
  const data = await getGeocodeSearch({ q: query, limit });
  return data.results;
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
