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
    homePart: props.HOMEPART === 1,
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

/**
 * SOV_A3 group code -> the sovereign feature's iso3. NE's composite
 * sovereignty codes (GB1, FR1, CH1, IS1, KA1, NL1...) are not ISO3 — they
 * key a whole group of features sharing one SOV_A3, and the group's
 * sovereign/home member is identified by NE's own HOMEPART=1 flag, not by
 * TYPE: TYPE alone is ambiguous for several real groups (GB1 has FOUR
 * 'Country'-typed members — United Kingdom, Jersey, Guernsey, Isle of Man;
 * picking by array order resolves NL1 to Sint Maarten instead of the
 * Netherlands in the live dataset). Verified against the fetched NE cache
 * in the task-9 fix-wave. Single-member groups (SOV_A3 already equal to the
 * member's own iso3) map to themselves through the same length===1
 * fallback. Entries are added only when the sovereign feature's iso3 is
 * non-null.
 */
export function buildSovereignIso3Map(countries: NeCountryFeature[]): Map<string, string> {
  const bySov = new Map<string, NeCountryFeature[]>();
  for (const c of countries) {
    if (!c.sovIso3) continue;
    const group = bySov.get(c.sovIso3);
    if (group) group.push(c); else bySov.set(c.sovIso3, [c]);
  }
  const map = new Map<string, string>();
  for (const [sov, members] of bySov) {
    const sovereign = members.length === 1 ? members[0] : members.find((m) => m.homePart);
    if (sovereign?.iso3) map.set(sov, sovereign.iso3);
  }
  return map;
}

/**
 * Copies of `features` with sovIso3 rewritten through `map` (SOV_A3 group
 * code -> sovereign iso3). Values not in the map — already a plain iso3, or
 * a group with no resolvable home feature — are left untouched.
 */
export function resolveSovereignCodes<T extends { sovIso3: string | null }>(
  features: T[], map: Map<string, string>,
): T[] {
  return features.map((f) => (f.sovIso3 && map.has(f.sovIso3) ? { ...f, sovIso3: map.get(f.sovIso3) as string } : f));
}

async function fetchGeojson(url: string): Promise<NeRawFeature[]> {
  const key = FileCache.buildKey({ url });
  if (cache.has(key)) {
    return (cache.get(key) as { features: NeRawFeature[] }).features;
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
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
