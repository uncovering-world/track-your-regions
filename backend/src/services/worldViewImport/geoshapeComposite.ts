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
import { userAgent } from '../../config/userAgent.js';
import { assertRobotsAllow } from '../robots/robotsSignals.js';

const USER_AGENT = userAgent({ bot: true });

/**
 * Collect child QIDs via Wikidata SPARQL using P527 (has part) / P361 (part of).
 * Merges results into the provided set. Answers false when the question went
 * unanswered, so the parts found are not taken for all of them.
 */
async function collectChildQidsFromSparql(
  wikidataId: string,
  childQidSet: Set<string>,
): Promise<boolean> {
  try {
    const query = `
      SELECT DISTINCT ?part WHERE {
        { wd:${wikidataId} wdt:P527 ?part }
        UNION
        { ?part wdt:P361 wd:${wikidataId} }
      }
    `;
    const results = await sparqlQuery(query, '[GeoshapeComposite]', { retries: 1 });
    for (const r of results) {
      const qid = extractQid(r.part?.value ?? '');
      if (qid.startsWith('Q')) childQidSet.add(qid);
    }
    return true;
  } catch (err) {
    console.warn(
      '[GeoshapeComposite] SPARQL failed for %s:',
      wikidataId,
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

/**
 * Resolve a batch of Wikivoyage page titles to Wikidata QIDs via the MediaWiki
 * API. Answers false when the batch went unanswered or a title has no item: a
 * part with no item has no shape to count, so the item's parts are not all in.
 */
async function resolveWikivoyageTitlesBatch(titles: string[], childQidSet: Set<string>): Promise<boolean> {
  const qUrl = new URL('https://en.wikivoyage.org/w/api.php');
  qUrl.searchParams.set('action', 'query');
  qUrl.searchParams.set('titles', titles.join('|'));
  qUrl.searchParams.set('redirects', '1');
  qUrl.searchParams.set('prop', 'pageprops');
  qUrl.searchParams.set('ppprop', 'wikibase_item');
  qUrl.searchParams.set('format', 'json');
  await assertRobotsAllow(qUrl.toString());
  const qResp = await fetch(qUrl.toString(), {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(15000),
  });
  if (!qResp.ok) return false;
  const qData = await qResp.json() as {
    query?: { pages?: Record<string, { pageprops?: { wikibase_item?: string } }> };
  };
  // An answer with no page map read none of the titles it was asked about.
  const pages = Object.values(qData.query?.pages ?? {});
  if (pages.length === 0) return false;
  let everyTitle = true;
  for (const page of pages) {
    const qid = page.pageprops?.wikibase_item;
    if (qid) childQidSet.add(qid);
    else everyTitle = false;
  }
  return everyTitle;
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
): Promise<boolean> {
  const titles = [...regionLinks];
  let complete = true;
  for (let i = 0; i < titles.length; i += 50) {
    const batch = titles.slice(i, i + 50);
    if (!await resolveWikivoyageTitlesBatch(batch, childQidSet)) complete = false;
  }
  console.log(`[GeoshapeComposite] Wikivoyage regionlist added ${regionLinks.size} titles for ${wikidataId}`);
  return complete;
}

/**
 * Collect child QIDs by parsing regionlist wikilinks from the Wikivoyage page
 * pointed to by `sourceUrl`. Merges results into the provided set. Answers
 * false when the page or a title went unanswered.
 */
async function collectChildQidsFromWikivoyage(
  wikidataId: string,
  sourceUrl: string,
  childQidSet: Set<string>,
): Promise<boolean> {
  try {
    const pageTitle = decodeURIComponent(sourceUrl.replace('https://en.wikivoyage.org/wiki/', ''));
    const url = new URL('https://en.wikivoyage.org/w/api.php');
    url.searchParams.set('action', 'parse');
    url.searchParams.set('page', pageTitle);
    url.searchParams.set('prop', 'wikitext');
    url.searchParams.set('format', 'json');

    await assertRobotsAllow(url.toString());
    const resp = await fetch(url.toString(), {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return false;

    const data = await resp.json() as { parse?: { wikitext?: { '*': string } } };
    const wikitext = data.parse?.wikitext?.['*'] ?? '';
    const regionLinks = extractRegionlistTitles(wikitext);
    if (regionLinks.size === 0) return true;
    return await resolveWikivoyageTitlesToQids(regionLinks, childQidSet, wikidataId);
  } catch (err) {
    console.warn(
      '[GeoshapeComposite] Wikivoyage parse failed for %s:',
      wikidataId,
      err instanceof Error ? err.message : err,
    );
    return false;
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
      INSERT INTO wikidata_geoshapes (wikidata_id, geom, not_available, composite_of)
      SELECT $1,
        ST_Multi(ST_CollectionExtract(ST_Buffer(ST_Union(wg.geom), 0), 3)),
        FALSE,
        $3
      FROM wikidata_geoshapes wg
      WHERE wg.wikidata_id = ANY($2) AND wg.not_available = FALSE AND wg.geom IS NOT NULL
      ON CONFLICT (wikidata_id) DO UPDATE SET
        geom = EXCLUDED.geom,
        not_available = FALSE,
        composite_of = EXCLUDED.composite_of
    `, [wikidataId, availableQids, availableQids.length]);

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
    console.error('[GeoshapeComposite] Union failed for %s:', wikidataId, err);
    return false;
  }
}

/**
 * Fallback: build a composite geoshape by unioning geoshapes of child entities.
 * Sources (merged, deduplicated):
 *  1. Wikidata P527 (has part) / P361 (part of)
 *  2. Wikivoyage regionlist subregion links (resolved to Wikidata QIDs)
 * Built only when every part has a shape of its own: a union of some of them
 * is not the item. Returns true if a composite geoshape was built and cached.
 */
export async function tryBuildCompositeGeoshape(wikidataId: string, sourceUrl?: string): Promise<boolean> {
  const childQidSet = new Set<string>();
  let complete = await collectChildQidsFromSparql(wikidataId, childQidSet);
  if (sourceUrl && !await collectChildQidsFromWikivoyage(wikidataId, sourceUrl, childQidSet)) complete = false;
  // Parts that could not be read count as parts with no shape: the set found
  // is then not every part, and a union of it is not the item.
  if (!complete) {
    console.log(`[GeoshapeComposite] Not every part of ${wikidataId} could be read; no composite is built`);
    return false;
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

  // A union of some of the parts is not the item: Lower Egypt (Q463871) from
  // the one of its four parts that has a shape is Cairo, and matched as the
  // Delta it offered Cairo at 92 % (#1628). Without every part the item has no
  // usable shape, and the point scorer stands in, as for an item with none.
  if (availableQids.length < childQidSet.size) {
    console.log(`[GeoshapeComposite] ${availableQids.length}/${childQidSet.size} children have geoshapes; a composite needs all of them, so none is built for ${wikidataId}`);
    return false;
  }
  console.log(`[GeoshapeComposite] All ${availableQids.length} children have geoshapes, building union...`);
  return storeCompositeUnion(wikidataId, availableQids);
}
