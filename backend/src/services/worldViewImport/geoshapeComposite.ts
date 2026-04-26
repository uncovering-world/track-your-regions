/**
 * Composite geoshape builder: for Wikidata entities that lack a direct Wikimedia
 * geoshape, assemble one by unioning the geoshapes of their child entities.
 *
 * Child candidates come from two sources (merged, deduplicated):
 *   1. Wikidata P527 (has part) / P361 (part of) via SPARQL
 *   2. Wikivoyage regionlist subregion links (resolved to Wikidata QIDs via the
 *      MediaWiki API)
 */

import { pool } from '../../db/index.js';
import { sparqlQuery, extractQid } from '../sync/wikidataUtils.js';
import { getOrFetchGeoshape } from './geoshapeCache.js';

const USER_AGENT = 'TrackYourRegions/1.0 (https://github.com/nikolay/track-your-regions)';

/**
 * Collect child QIDs via Wikidata SPARQL using P527 (has part) / P361 (part of).
 * Merges results into the provided set. Logs and swallows errors.
 */
async function collectChildQidsFromSparql(
  wikidataId: string,
  childQidSet: Set<string>,
): Promise<void> {
  try {
    const query = `
      SELECT DISTINCT ?part WHERE {
        { wd:${wikidataId} wdt:P527 ?part }
        UNION
        { ?part wdt:P361 wd:${wikidataId} }
      }
    `;
    const results = await sparqlQuery(query, '[GeoshapeComposite]', 1);
    for (const r of results) {
      const qid = extractQid(r.part?.value ?? '');
      if (qid.startsWith('Q')) childQidSet.add(qid);
    }
  } catch (err) {
    console.warn(
      `[GeoshapeComposite] SPARQL failed for ${wikidataId}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

/** Resolve a batch of Wikivoyage page titles to Wikidata QIDs via the MediaWiki API. */
async function resolveWikivoyageTitlesBatch(titles: string[], childQidSet: Set<string>): Promise<void> {
  const qUrl = new URL('https://en.wikivoyage.org/w/api.php');
  qUrl.searchParams.set('action', 'query');
  qUrl.searchParams.set('titles', titles.join('|'));
  qUrl.searchParams.set('redirects', '1');
  qUrl.searchParams.set('prop', 'pageprops');
  qUrl.searchParams.set('ppprop', 'wikibase_item');
  qUrl.searchParams.set('format', 'json');
  const qResp = await fetch(qUrl.toString(), {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(15000),
  });
  if (!qResp.ok) return;
  const qData = await qResp.json() as {
    query?: { pages?: Record<string, { pageprops?: { wikibase_item?: string } }> };
  };
  for (const page of Object.values(qData.query?.pages ?? {})) {
    const qid = page.pageprops?.wikibase_item;
    if (qid) childQidSet.add(qid);
  }
}

/** Parse regionlist links (e.g. `region1name=[[Title]]`) out of wikitext. */
function extractRegionlistTitles(wikitext: string): Set<string> {
  const regionLinks = new Set<string>();
  for (const m of wikitext.matchAll(/region\d+name\s*=\s*\[\[([^\]|]+)/g)) {
    regionLinks.add(m[1].trim());
  }
  return regionLinks;
}

/** Resolve Wikivoyage regionlist titles (in batches of 50) to QIDs. */
async function resolveWikivoyageTitlesToQids(
  regionLinks: Set<string>,
  childQidSet: Set<string>,
  wikidataId: string,
): Promise<void> {
  const titles = [...regionLinks];
  for (let i = 0; i < titles.length; i += 50) {
    const batch = titles.slice(i, i + 50);
    await resolveWikivoyageTitlesBatch(batch, childQidSet);
  }
  console.log(`[GeoshapeComposite] Wikivoyage regionlist added ${regionLinks.size} titles for ${wikidataId}`);
}

/**
 * Collect child QIDs by parsing regionlist wikilinks from the Wikivoyage page
 * pointed to by `sourceUrl`. Merges results into the provided set.
 * Logs and swallows errors.
 */
async function collectChildQidsFromWikivoyage(
  wikidataId: string,
  sourceUrl: string,
  childQidSet: Set<string>,
): Promise<void> {
  try {
    const pageTitle = decodeURIComponent(sourceUrl.replace('https://en.wikivoyage.org/wiki/', ''));
    const url = new URL('https://en.wikivoyage.org/w/api.php');
    url.searchParams.set('action', 'parse');
    url.searchParams.set('page', pageTitle);
    url.searchParams.set('prop', 'wikitext');
    url.searchParams.set('format', 'json');

    const resp = await fetch(url.toString(), {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return;

    const data = await resp.json() as { parse?: { wikitext?: { '*': string } } };
    const wikitext = data.parse?.wikitext?.['*'] ?? '';
    const regionLinks = extractRegionlistTitles(wikitext);
    if (regionLinks.size > 0) {
      await resolveWikivoyageTitlesToQids(regionLinks, childQidSet, wikidataId);
    }
  } catch (err) {
    console.warn(
      `[GeoshapeComposite] Wikivoyage parse failed for ${wikidataId}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

/** Fetch/cache geoshapes for each candidate QID, returning those that succeeded. */
async function filterAvailableChildGeoshapes(childQids: Iterable<string>): Promise<string[]> {
  const availableQids: string[] = [];
  for (const qid of childQids) {
    const available = await getOrFetchGeoshape(qid);
    if (available) availableQids.push(qid);
  }
  return availableQids;
}

/**
 * Store the union of multiple child geoshapes under `wikidataId` and verify the
 * resulting geometry is non-null.
 */
async function storeCompositeUnion(wikidataId: string, availableQids: string[]): Promise<boolean> {
  try {
    await pool.query(`
      INSERT INTO wikidata_geoshapes (wikidata_id, geom, not_available)
      SELECT $1,
        ST_Multi(ST_CollectionExtract(ST_Buffer(ST_Union(wg.geom), 0), 3)),
        FALSE
      FROM wikidata_geoshapes wg
      WHERE wg.wikidata_id = ANY($2) AND wg.not_available = FALSE AND wg.geom IS NOT NULL
      ON CONFLICT (wikidata_id) DO UPDATE SET
        geom = EXCLUDED.geom,
        not_available = FALSE
    `, [wikidataId, availableQids]);

    const check = await pool.query(
      'SELECT geom IS NOT NULL AS valid FROM wikidata_geoshapes WHERE wikidata_id = $1',
      [wikidataId],
    );
    if (check.rows[0]?.valid) {
      console.log(
        `[GeoshapeComposite] Built composite geoshape for ${wikidataId} from ${availableQids.length} children`,
      );
      return true;
    }
    return false;
  } catch (err) {
    console.error(`[GeoshapeComposite] Union failed for ${wikidataId}:`, err);
    return false;
  }
}

/**
 * Fallback: build a composite geoshape by unioning geoshapes of child entities.
 * Sources (merged, deduplicated):
 *  1. Wikidata P527 (has part) / P361 (part of)
 *  2. Wikivoyage regionlist subregion links (resolved to Wikidata QIDs)
 * Returns true if a composite geoshape was built and cached.
 */
export async function tryBuildCompositeGeoshape(wikidataId: string, sourceUrl?: string): Promise<boolean> {
  const childQidSet = new Set<string>();
  await collectChildQidsFromSparql(wikidataId, childQidSet);
  if (sourceUrl) {
    await collectChildQidsFromWikivoyage(wikidataId, sourceUrl, childQidSet);
  }

  if (childQidSet.size === 0) {
    console.log(`[GeoshapeComposite] No child entities found for ${wikidataId}`);
    return false;
  }

  console.log(`[GeoshapeComposite] Found ${childQidSet.size} child entities for ${wikidataId}, fetching geoshapes...`);

  const availableQids = await filterAvailableChildGeoshapes(childQidSet);
  if (availableQids.length === 0) {
    console.log(`[GeoshapeComposite] No child geoshapes available for ${wikidataId}`);
    return false;
  }

  console.log(`[GeoshapeComposite] ${availableQids.length}/${childQidSet.size} children have geoshapes, building union...`);
  return storeCompositeUnion(wikidataId, availableQids);
}
