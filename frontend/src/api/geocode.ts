/**
 * Geocode API client — place search (Nominatim) and AI geocoding.
 */

import { fetchJson, authFetchJson, API_URL } from './fetchUtils';

export interface PlaceResult {
  display_name: string;
  lat: number;
  lng: number;
  type: string;
  wikidataId?: string | null;
}

export interface ImageSuggestion {
  imageUrl: string;
  source: 'wikidata_direct' | 'wikidata_spatial' | 'wikidata_search';
  entityLabel: string;
  wikidataId: string;
  description?: string;
  wikipediaUrl?: string;
}

interface SearchResponse {
  results: PlaceResult[];
}

export interface AIGeocodeResult {
  lat: number;
  lng: number;
  name: string;
  confidence: string;
}

/** Search places by name via Nominatim proxy */
export async function searchPlaces(query: string, limit = 5): Promise<PlaceResult[]> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  const data = await fetchJson<SearchResponse>(`${API_URL}/api/geocode/search?${params}`);
  return data.results;
}

/** Geocode a natural-language description using AI */
export async function aiGeocode(description: string): Promise<AIGeocodeResult> {
  return authFetchJson<AIGeocodeResult>(`${API_URL}/api/geocode/ai`, {
    method: 'POST',
    body: JSON.stringify({ description }),
  });
}

/** Suggest an image URL from Wikidata for experience creation */
export async function suggestImageUrl(params: {
  name?: string;
  lat?: number;
  lng?: number;
  wikidataId?: string;
}): Promise<ImageSuggestion> {
  const qs = new URLSearchParams();
  if (params.name) qs.set('name', params.name);
  if (params.lat != null) qs.set('lat', String(params.lat));
  if (params.lng != null) qs.set('lng', String(params.lng));
  if (params.wikidataId) qs.set('wikidataId', params.wikidataId);
  return authFetchJson<ImageSuggestion>(`${API_URL}/api/geocode/suggest-image?${qs}`);
}
