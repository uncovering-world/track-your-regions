/**
 * Geocode Controller — Proxies to Nominatim for place search,
 * and provides Wikidata image suggestion for experience creation.
 *
 * Nominatim usage policy requires:
 * - Custom User-Agent header
 * - Max 1 request per second
 */

import type { Request, Response } from 'express';

const USER_AGENT = 'TrackYourRegions/1.0 (https://github.com/trackyourregions; contact@trackyourregions.com)';
const WIKIDATA_ENDPOINT = 'https://query.wikidata.org/sparql';
/**
 * How long each of this file's two lookups may take **in total** — every request it
 * makes to somebody else, not each one separately. Both numbers are statements about
 * the person waiting rather than about the query: Wikidata's own hard deadline is 60 s
 * and Nominatim's is longer still, and a suggestion arriving after either has been
 * given up on, in a dialog that is likely already closed.
 *
 * The image lookup gets the longer one because it is up to three layers deep and a
 * curator has asked for it and knows they are waiting; place search is one request
 * under someone's typing, where ten seconds is already past useful.
 */
const IMAGE_LOOKUP_TIMEOUT_MS = 20000;
const PLACE_SEARCH_TIMEOUT_MS = 10000;

// Simple in-memory rate limiter: track last request timestamp
let lastRequestTime = 0;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function searchPlaces(req: Request, res: Response) {
  const q = req.query.q as string;
  const limit = Math.min(parseInt(req.query.limit as string) || 5, 10);

  if (!q || q.length < 2) {
    return res.status(400).json({ error: 'Query must be at least 2 characters' });
  }

  // Enforce 1 request/second rate limit
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < 1000) {
    await new Promise((resolve) => setTimeout(resolve, 1000 - elapsed));
  }
  lastRequestTime = Date.now();

  try {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', q);
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('addressdetails', '0');
    url.searchParams.set('extratags', '1');

    const response = await fetch(url.toString(), {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(PLACE_SEARCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Nominatim request failed' });
    }

    const data = await response.json() as Array<{
      display_name: string;
      lat: string;
      lon: string;
      type: string;
      extratags?: Record<string, string>;
    }>;

    const results = data.map((item) => ({
      display_name: item.display_name,
      lat: parseFloat(item.lat),
      lng: parseFloat(item.lon),
      type: item.type,
      wikidataId: item.extratags?.wikidata ?? null,
    }));

    res.json({ results });
  } catch (error) {
    console.error('Nominatim search error:', error);
    res.status(500).json({ error: 'Geocode search failed' });
  }
}

// ---------------------------------------------------------------------------
// Image suggestion — layered Wikidata lookup
// ---------------------------------------------------------------------------

type SparqlBinding = Record<string, { value: string } | undefined>;

/**
 * Execute a SPARQL query against Wikidata with retry for transient errors.
 *
 * Deliberately *not* the collectors' shared client (`services/sync/wikidataUtils.ts`),
 * which this used to name as the pattern it copied. That one is built for a run nobody
 * is watching: it waits out a `Retry-After` against a budget the whole run shares, and
 * is right to spend minutes doing it. Here a curator is holding a dialog open waiting
 * for a suggestion, and a wait that long is a wait they would read as a hang.
 *
 * The deadline arrives from the caller rather than being made here, and it is the one
 * the whole request shares: a ceiling on this function alone would leave the retries
 * bounded and the lookup around them not, and this is one of three layers. Until it
 * existed there was no ceiling anywhere — `fetch` carried no signal, so a socket
 * Wikidata never closed held the curator's request open for as long as the socket lived.
 */
async function sparqlQuery(query: string, signal: AbortSignal, retries = 2): Promise<SparqlBinding[]> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const response = await fetch(WIKIDATA_ENDPOINT, {
      signal,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/sparql-results+json',
        'User-Agent': USER_AGENT,
      },
      body: `query=${encodeURIComponent(query)}`,
    });

    if (!response.ok) {
      if (attempt < retries && (response.status >= 500 || response.status === 429)) {
        const backoff = (attempt + 1) * 3000;
        await delay(backoff);
        continue;
      }
      throw new Error(`Wikidata SPARQL error ${response.status}`);
    }

    const data = await response.json() as {
      results: { bindings: SparqlBinding[] };
    };
    return data.results.bindings;
  }
  throw new Error('SPARQL query failed after all retries');
}

/** Convert a Wikimedia Commons filename to a Special:FilePath URL */
function filePathUrl(filename: string): string {
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename)}`;
}

/**
 * Layer 1: Direct Wikidata entity lookup by QID → P18 (image)
 */
async function lookupByQid(qid: string, signal: AbortSignal): Promise<{ imageUrl: string; entityLabel: string; description?: string; wikipediaUrl?: string } | null> {
  const url = `https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`;
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal,
  });
  if (!response.ok) return null;

  const data = await response.json() as {
    entities: Record<string, {
      labels?: Record<string, { value: string }>;
      descriptions?: Record<string, { value: string }>;
      claims?: Record<string, Array<{ mainsnak: { datavalue?: { value: unknown } } }>>;
      sitelinks?: Record<string, { title: string; url?: string }>;
    }>;
  };

  const entity = data.entities[qid];
  if (!entity) return null;

  const imageClaim = entity.claims?.P18?.[0];
  const filename = imageClaim?.mainsnak?.datavalue?.value;
  if (typeof filename !== 'string') return null;

  const label = entity.labels?.en?.value ?? qid;
  const description = entity.descriptions?.en?.value;

  // Extract English Wikipedia URL from sitelinks
  const enwiki = entity.sitelinks?.enwiki;
  const wikipediaUrl = enwiki?.url ?? (enwiki?.title ? `https://en.wikipedia.org/wiki/${encodeURIComponent(enwiki.title.replace(/ /g, '_'))}` : undefined);

  return { imageUrl: filePathUrl(filename), entityLabel: label, description, wikipediaUrl };
}

/**
 * Layer 2: SPARQL spatial search — find nearby entities with images
 */
async function lookupBySpatial(lat: number, lng: number, signal: AbortSignal): Promise<{ imageUrl: string; entityLabel: string; wikidataId: string; description?: string } | null> {
  const query = `
    SELECT ?item ?itemLabel ?itemDescription ?image WHERE {
      SERVICE wikibase:around {
        ?item wdt:P625 ?loc .
        bd:serviceParam wikibase:center "Point(${lng} ${lat})"^^geo:wktLiteral .
        bd:serviceParam wikibase:radius "2" .
      }
      ?item wdt:P18 ?image .
      BIND(geof:distance(?loc, "Point(${lng} ${lat})"^^geo:wktLiteral) AS ?dist)
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
    }
    ORDER BY ?dist
    LIMIT 5
  `;

  const bindings = await sparqlQuery(query, signal);
  if (bindings.length === 0) return null;

  const first = bindings[0];
  const imageUrl = first.image?.value;
  const label = first.itemLabel?.value ?? '';
  const description = first.itemDescription?.value;
  const itemUri = first.item?.value ?? '';
  const qid = itemUri.replace('http://www.wikidata.org/entity/', '');

  if (!imageUrl) return null;
  return { imageUrl, entityLabel: label, wikidataId: qid, description };
}

/**
 * Layer 3: Name search via wbsearchentities → check P18
 */
async function lookupByName(name: string, signal: AbortSignal): Promise<{ imageUrl: string; entityLabel: string; wikidataId: string; description?: string; wikipediaUrl?: string } | null> {
  const url = new URL('https://www.wikidata.org/w/api.php');
  url.searchParams.set('action', 'wbsearchentities');
  url.searchParams.set('search', name);
  url.searchParams.set('language', 'en');
  url.searchParams.set('limit', '3');
  url.searchParams.set('format', 'json');

  const response = await fetch(url.toString(), {
    headers: { 'User-Agent': USER_AGENT },
    signal,
  });
  if (!response.ok) return null;

  const data = await response.json() as {
    search: Array<{ id: string; label: string }>;
  };

  for (const entity of data.search) {
    const result = await lookupByQid(entity.id, signal);
    if (result) {
      return { ...result, wikidataId: entity.id };
    }
    await delay(500); // Be polite between entity fetches
  }
  return null;
}

interface SuggestImagePayload {
  imageUrl: string | undefined;
  source: 'wikidata_direct' | 'wikidata_spatial' | 'wikidata_search';
  entityLabel: string | undefined;
  description: string | undefined;
  wikipediaUrl: string | undefined;
  wikidataId: string | undefined;
}

function isValidLatLng(lat: number | undefined, lng: number | undefined): lat is number {
  return lat != null && lng != null
    && !isNaN(lat) && !isNaN(lng)
    && isFinite(lat) && isFinite(lng)
    && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

async function suggestByQid(wikidataId: string | undefined, signal: AbortSignal): Promise<SuggestImagePayload | null> {
  if (!wikidataId || !/^Q\d+$/.test(wikidataId)) return null;
  const result = await lookupByQid(wikidataId, signal);
  if (!result) return null;
  return {
    imageUrl: result.imageUrl,
    source: 'wikidata_direct',
    entityLabel: result.entityLabel,
    description: result.description,
    wikipediaUrl: result.wikipediaUrl,
    wikidataId,
  };
}

async function suggestBySpatial(
  lat: number | undefined,
  lng: number | undefined,
  signal: AbortSignal,
): Promise<SuggestImagePayload | null> {
  if (!isValidLatLng(lat, lng)) return null;
  const result = await lookupBySpatial(lat, lng as number, signal);
  if (!result) return null;
  // Spatial search doesn't include sitelinks; fetch Wikipedia URL via QID follow-up.
  //
  // Failing it costs the link and nothing else — the line below already treats the link
  // as optional — so it is caught here rather than allowed to leave with the picture.
  // The shared deadline made that a live case rather than a theoretical one: the spatial
  // query is the slow half of this layer, so a follow-up that starts at eighteen seconds
  // has two to abort in, and letting it throw would turn a suggestion the server was
  // holding into a 500 that `AddExperienceDialog` reports as "no image found".
  const entityData = result.wikidataId
    ? await lookupByQid(result.wikidataId, signal).catch((err: unknown) => {
      console.warn('[Geocode] Wikipedia link lookup failed for', result.wikidataId, err);
      return undefined;
    })
    : undefined;
  return {
    imageUrl: result.imageUrl,
    source: 'wikidata_spatial',
    entityLabel: result.entityLabel,
    description: result.description,
    wikipediaUrl: entityData?.wikipediaUrl,
    wikidataId: result.wikidataId,
  };
}

async function suggestByName(name: string | undefined, signal: AbortSignal): Promise<SuggestImagePayload | null> {
  if (!name) return null;
  const result = await lookupByName(name, signal);
  if (!result) return null;
  return {
    imageUrl: result.imageUrl,
    source: 'wikidata_search',
    entityLabel: result.entityLabel,
    description: result.description,
    wikipediaUrl: result.wikipediaUrl,
    wikidataId: result.wikidataId,
  };
}

/**
 * GET /api/geocode/suggest-image
 * Layered Wikidata image lookup for experience creation.
 */
export async function suggestImage(req: Request, res: Response) {
  const name = req.query.name as string | undefined;
  const lat = req.query.lat ? parseFloat(req.query.lat as string) : undefined;
  const lng = req.query.lng ? parseFloat(req.query.lng as string) : undefined;
  const wikidataId = req.query.wikidataId as string | undefined;

  if (!name && !wikidataId && (lat == null || lng == null)) {
    return res.status(400).json({ error: 'Provide at least one of: name, wikidataId, or lat+lng' });
  }

  try {
    // One deadline for the walk, made here and shared by every layer: a curator asked
    // one question, and three layers each free to take as long as they like is what
    // they experience as one lookup that never comes back.
    const signal = AbortSignal.timeout(IMAGE_LOOKUP_TIMEOUT_MS);
    const layers = [
      () => suggestByQid(wikidataId, signal),
      () => suggestBySpatial(lat, lng, signal),
      () => suggestByName(name, signal),
    ];
    for (const layer of layers) {
      const payload = await layer();
      if (payload) return res.json(payload);
    }
    res.status(404).json({ error: 'No image found' });
  } catch (error) {
    console.error('Image suggestion error:', error);
    res.status(500).json({ error: 'Image suggestion failed' });
  }
}
