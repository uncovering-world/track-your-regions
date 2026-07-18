/**
 * Natural Earth source: admin-0 countries + disputed/breakaway areas.
 * Public-domain GeoJSON from the natural-earth-vector repo, fetched with a
 * FileCache under data/cache/canon/ (untracked runtime cache).
 *
 * URLs/fields verified against the live repo in plan Task 4 Step 1 — update
 * NE_DISPUTED_URL and the property fallbacks there if NE renames them.
 */
import path from 'path';
import { FileCache } from '../wikivoyageExtract/cache.js';
import { CANON_CACHE_DIR, type NeCountryFeature, type NeDisputedFeature } from './types.js';

const NE_BASE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson';
export const NE_COUNTRIES_URL = `${NE_BASE}/ne_10m_admin_0_countries.geojson`;
export const NE_DISPUTED_URL = `${NE_BASE}/ne_10m_admin_0_disputed_areas.geojson`;
export const NE_SOURCE_VERSION = 'natural-earth-vector@master (10m)';

type NeProps = Record<string, unknown>;
interface NeRawFeature { properties: NeProps; geometry: unknown }

const cache = new FileCache(path.join(CANON_CACHE_DIR, 'natural-earth.json'));

function str(props: NeProps, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = props[k];
    if (typeof v === 'string' && v && v !== '-99') return v;
  }
  return null;
}

export function normalizeNeCountry(props: NeProps, geometry: unknown): NeCountryFeature {
  return {
    name: str(props, 'ADMIN', 'NAME') ?? 'Unknown',
    iso2: str(props, 'ISO_A2_EH', 'ISO_A2'),
    iso3: str(props, 'ISO_A3_EH', 'ISO_A3', 'ADM0_A3'),
    sovIso3: str(props, 'SOV_A3'),
    type: str(props, 'TYPE', 'FCLASS') ?? 'Unknown',
    wikidataQid: str(props, 'WIKIDATAID'),
    geometry,
  };
}

export function normalizeNeDisputed(props: NeProps, geometry: unknown): NeDisputedFeature {
  return {
    name: str(props, 'BRK_NAME', 'NAME') ?? 'Unknown',
    note: str(props, 'NOTE_BRK', 'NOTE_ADM0'),
    sovIso3: str(props, 'SOV_A3', 'ADM0_A3'),
    type: str(props, 'TYPE', 'FCLASS') ?? 'Unknown',
    wikidataQid: str(props, 'WIKIDATAID'),
    geometry,
  };
}

async function fetchGeojson(url: string): Promise<NeRawFeature[]> {
  const key = FileCache.buildKey({ url });
  if (cache.has(key)) {
    return (cache.get(key) as { features: NeRawFeature[] }).features;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Natural Earth fetch failed ${res.status}: ${url}`);
  const data = await res.json() as { features: NeRawFeature[] };
  cache.set(key, data);
  cache.save();
  return data.features;
}

export async function fetchNeCountries(): Promise<NeCountryFeature[]> {
  const features = await fetchGeojson(NE_COUNTRIES_URL);
  return features.map((f) => normalizeNeCountry(f.properties, f.geometry));
}

export async function fetchNeDisputed(): Promise<NeDisputedFeature[]> {
  const features = await fetchGeojson(NE_DISPUTED_URL);
  return features.map((f) => normalizeNeDisputed(f.properties, f.geometry));
}
