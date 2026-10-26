/**
 * Archaeology's own questions answered from the local Wikidata subset
 * (#1462): what a find is and where it was dug up, and the facts a site
 * candidate is judged on. Each answers what its live twin in
 * `archaeology/queries.ts` answers; the kind's other questions are Public
 * Art's and the museum's, twinned in their own files.
 */

import { pool } from '../../../db/index.js';
import type { CompactStatement } from '../../dumps/wikidata/compactEntity.js';
import type { FindFacts } from '../archaeology/finds.js';
import type { SiteFactsRow } from '../archaeology/queries.js';
import { WORLD_HERITAGE_DESIGNATION } from '../archaeology/classes.js';
import { BEST, entitiesOf, termsOf } from './entities.js';
import { bestStatements, isNoValue, itemsOf, standingStatements } from './values.js';

/** Every entry an empty one, so a missing item reads as what it is: asked about, and answering nothing. */
function emptyFor<T>(qids: string[], empty: () => T): Map<string, T> {
  return new Map(qids.map(qid => [qid, empty()]));
}

/** Each work's classes (best P31) and the first place it was found that still stands (P189), named. */
export async function subsetFindFacts(qids: string[]): Promise<Map<string, FindFacts>> {
  const out = emptyFor<FindFacts>(qids, () => ({ classes: [], discoveryPlace: null }));
  const kept = await entitiesOf(qids);
  const places = new Map([...kept].map(([id, { entity }]) => [id, itemsOf(standingStatements(entity.claims.P189))[0] ?? null]));
  const terms = await termsOf([...places.values()].filter((place): place is string => place !== null));
  for (const [id, { entity }] of kept) {
    const place = places.get(id) ?? null;
    out.set(id, {
      classes: itemsOf(bestStatements(entity.claims.P31)),
      discoveryPlace: place ? { qid: place, label: terms.get(place)?.label ?? place } : null,
    });
  }
  return out;
}

/** Whether `wdt:` binds anything: a best statement with a value or an unknown one, never "no value". */
function stated(statements: CompactStatement[] | undefined): CompactStatement[] {
  return bestStatements(statements).filter(statement => !isNoValue(statement.value));
}

/** Each candidate's classes, whether it is a World Heritage Site itself, and whether it states a population. */
export async function subsetSiteFacts(qids: string[]): Promise<Map<string, SiteFactsRow>> {
  const out = emptyFor<SiteFactsRow>(qids, () => ({ classes: [], worldHeritage: false, statesPopulation: false }));
  for (const [id, { entity }] of await entitiesOf(qids)) {
    const { claims } = entity;
    out.set(id, {
      classes: itemsOf(bestStatements(claims.P31)),
      worldHeritage: stated(claims.P757).length > 0 || itemsOf(stated(claims.P1435)).includes(WORLD_HERITAGE_DESIGNATION),
      statesPopulation: stated(claims.P1082).length > 0,
    });
  }
  return out;
}

/**
 * Which of `qids` carry a best-rank class among `classes` and a best-rank
 * point, as `fetchSitesAmong` asks the live service.
 */
export async function subsetSitesAmong(qids: string[], classes: string[]): Promise<string[]> {
  if (!qids.length || !classes.length) return [];
  const result = await pool.query<{ subject: string }>(
    `SELECT DISTINCT c.subject FROM wikidata_claims c
      WHERE c.property = 'P31' AND c.subject = ANY($1::text[]) AND c.value_item = ANY($2::text[]) AND c.rank >= 0 AND ${BEST('c')}
        AND EXISTS (SELECT 1 FROM wikidata_claims p
                     WHERE p.subject = c.subject AND p.property = 'P625' AND p.rank >= 0 AND p.value ? 'latitude' AND ${BEST('p')})`,
    [qids, classes],
  );
  const sites = new Set(result.rows.map(row => row.subject));
  return qids.filter(qid => sites.has(qid));
}

/** Which of `qids` the subset keeps: an item outside its scope has no answer there, which is not "none". */
export async function subsetKeeps(qids: string[]): Promise<Set<string>> {
  if (!qids.length) return new Set();
  const result = await pool.query<{ id: string }>('SELECT id FROM wikidata_entities WHERE id = ANY($1::text[])', [qids]);
  return new Set(result.rows.map(row => row.id));
}
