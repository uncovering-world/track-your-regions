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
 * Reuses the same pattern as museumSyncService.
 */
async function sparqlQuery(query: string, retries = 2): Promise<SparqlBinding[]> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const response = await fetch(WIKIDATA_ENDPOINT, {
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
async function lookupByQid(qid: string): Promise<{ imageUrl: string; entityLabel: string; description?: string; wikipediaUrl?: string } | null> {
  const url = `https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`;
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
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
async function lookupBySpatial(lat: number, lng: number): Promise<{ imageUrl: string; entityLabel: string; wikidataId: string; description?: string } | null> {
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

  const bindings = await sparqlQuery(query);
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
async function lookupByName(name: string): Promise<{ imageUrl: string; entityLabel: string; wikidataId: string; description?: string; wikipediaUrl?: string } | null> {
  const url = new URL('https://www.wikidata.org/w/api.php');
  url.searchParams.set('action', 'wbsearchentities');
  url.searchParams.set('search', name);
  url.searchParams.set('language', 'en');
  url.searchParams.set('limit', '3');
  url.searchParams.set('format', 'json');

  const response = await fetch(url.toString(), {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!response.ok) return null;

  const data = await response.json() as {
    search: Array<{ id: string; label: string }>;
  };

  for (const entity of data.search) {
    const result = await lookupByQid(entity.id);
    if (result) {
      return { ...result, wikidataId: entity.id };
    }
    await delay(500); // Be polite between entity fetches
  }
  return null;
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
    // Layer 1: Direct QID lookup
    if (wikidataId && /^Q\d+$/.test(wikidataId)) {
      const result = await lookupByQid(wikidataId);
      if (result) {
        return res.json({
          imageUrl: result.imageUrl,
          source: 'wikidata_direct',
          entityLabel: result.entityLabel,
          description: result.description,
          wikipediaUrl: result.wikipediaUrl,
          wikidataId,
        });
      }
    }

    // Layer 2: SPARQL spatial search — get Wikipedia URL via QID follow-up
    if (lat != null && lng != null && !isNaN(lat) && !isNaN(lng) &&
        isFinite(lat) && isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      const result = await lookupBySpatial(lat, lng);
      if (result) {
        // Fetch sitelinks for Wikipedia URL (spatial search doesn't include them)
        let wikipediaUrl: string | undefined;
        if (result.wikidataId) {
          const entityData = await lookupByQid(result.wikidataId);
          wikipediaUrl = entityData?.wikipediaUrl;
        }
        return res.json({
          imageUrl: result.imageUrl,
          source: 'wikidata_spatial',
          entityLabel: result.entityLabel,
          description: result.description,
          wikipediaUrl,
          wikidataId: result.wikidataId,
        });
      }
    }

    // Layer 3: Name search
    if (name) {
      const result = await lookupByName(name);
      if (result) {
        return res.json({
          imageUrl: result.imageUrl,
          source: 'wikidata_search',
          entityLabel: result.entityLabel,
          description: result.description,
          wikipediaUrl: result.wikipediaUrl,
          wikidataId: result.wikidataId,
        });
      }
    }

    res.status(404).json({ error: 'No image found' });
  } catch (error) {
    console.error('Image suggestion error:', error);
    res.status(500).json({ error: 'Image suggestion failed' });
  }
}
