/**
 * The casts of a group of casts, read from the local Wikidata subset (#880,
 * ADR-0145 decision 2b): the group's parts (`P527`) and the items that name the
 * group as what they are part of (`P361`) or based on (`P144`), each with a
 * coordinate of its own and a placement that has not ended. The live reader's
 * twin is `fetchCastItems` in `publicArt/castGroups.ts`; the two answer alike.
 */

import { pool } from '../../../db/index.js';
import { namingPart } from '../publicArt/castNaming.js';
import { preferredCoordinate } from '../wikidataUtils.js';
import { BEST, entitiesOf, termsOf, type Kept, type Terms } from './entities.js';
import type { CompactEntity } from '../../dumps/wikidata/compactEntity.js';
import { bestStatements, hasEnded, itemOf, itemsOf, wktOf } from './values.js';

/** One cast as the subset reads it, its point still as WKT. */
export interface CastItemReading {
  qid: string;
  wkt: string;
  /** Where it stands, as the placement that holds is called — else the cast's own label. */
  name: string | null;
  countryLabel: string | null;
  /** Every `P31` of the cast: what the group is read as, since its own class says only "group of casts". */
  classes: string[];
}

/** The items naming each of `groups` by `P361` or `P144`, by group. */
async function referrersOf(groups: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!groups.length) return out;
  const result = await pool.query<{ subject: string; value_item: string }>(
    `SELECT c.subject, c.value_item FROM wikidata_claims c
      WHERE c.property IN ('P361', 'P144') AND c.value_item = ANY($1::text[]) AND c.rank >= 0 AND ${BEST('c')}`,
    [groups],
  );
  for (const row of result.rows) out.set(row.value_item, [...(out.get(row.value_item) ?? []), row.subject]);
  return out;
}

/** The labels the casts' readings need: the casts', their placements' and their countries'. */
function termIdsOf(casts: Map<string, Kept>): string[] {
  const placements = [...casts.values()].flatMap(({ entity }) => itemsOf(bestStatements(entity.claims.P276)));
  const countries = [...casts.values()].flatMap(({ entity }) => itemsOf(bestStatements(entity.claims.P17)));
  return [...casts.keys(), ...placements, ...countries];
}

/**
 * One cast as the subset holds it, or null for a part that is no cast: one
 * with no coordinate (the study of one figure), or one whose every placement
 * has ended. A cast placed nowhere stands where its point is.
 */
function readingOf(id: string, claims: CompactEntity['claims'], terms: Map<string, Terms>): CastItemReading | null {
  const wkt = bestStatements(claims.P625).map(s => wktOf(s.value))
    .reduce<string | null>((keptWkt, next) => preferredCoordinate(keptWkt, next), null);
  if (!wkt) return null;
  const placed = bestStatements(claims.P276).filter(s => itemOf(s.value) !== null);
  const standing = itemsOf(placed.filter(s => !hasEnded(s)));
  if (placed.length && !standing.length) return null;
  const at = standing.length ? namingPart(standing) : null;
  const country = itemsOf(bestStatements(claims.P17))
    .flatMap(id => terms.get(id)?.label ?? [])
    .sort((a, b) => a.localeCompare(b))[0] ?? null;
  return {
    qid: id,
    wkt,
    name: (at ? terms.get(at)?.label : undefined) ?? terms.get(id)?.label ?? null,
    countryLabel: country,
    classes: itemsOf(bestStatements(claims.P31)),
  };
}

/** The casts of each of `groups`, by group; a group with none has no entry. */
export async function subsetCastItems(groups: string[]): Promise<Map<string, CastItemReading[]>> {
  const out = new Map<string, CastItemReading[]>();
  if (!groups.length) return out;
  const [kept, referrers] = await Promise.all([entitiesOf(groups), referrersOf(groups)]);
  const castsOf = new Map<string, string[]>();
  for (const group of groups) {
    const parts = itemsOf(bestStatements(kept.get(group)?.entity.claims.P527));
    castsOf.set(group, [...new Set([...parts, ...(referrers.get(group) ?? [])])]);
  }
  const casts = await entitiesOf([...new Set([...castsOf.values()].flat())]);
  const terms = await termsOf(termIdsOf(casts));
  for (const [group, ids] of castsOf) {
    const readings = ids.flatMap((id) => {
      const claims = casts.get(id)?.entity.claims;
      return claims ? readingOf(id, claims, terms) ?? [] : [];
    });
    if (readings.length) out.set(group, readings);
  }
  return out;
}

/**
 * The groups of casts at the fame floor that have no point of their own and
 * at least one cast with one — the shape of *The Thinker*, which enters the
 * pool through its casts. A group with its own point is named by the class
 * question like any item.
 */
export async function subsetCastGroupIds(castGroup: string, minSitelinks: number): Promise<string[]> {
  const result = await pool.query<{ subject: string }>(
    `SELECT DISTINCT c.subject FROM wikidata_claims c
       JOIN wikidata_entities e ON e.id = c.subject
      WHERE c.property = 'P31' AND c.value_item = $1 AND c.rank >= 0 AND ${BEST('c')}
        AND e.sitelink_count >= $2
        AND NOT EXISTS (SELECT 1 FROM wikidata_claims own
                         WHERE own.subject = c.subject AND own.property = 'P625' AND own.rank >= 0 AND own.value ? 'latitude' AND ${BEST('own')})
        AND (EXISTS (SELECT 1 FROM wikidata_claims part
                       JOIN wikidata_claims at ON at.subject = part.value_item AND at.property = 'P625' AND at.value ? 'latitude'
                         AND at.rank >= 0 AND ${BEST('at')}
                      WHERE part.subject = c.subject AND part.property = 'P527' AND part.rank >= 0 AND ${BEST('part')})
          OR EXISTS (SELECT 1 FROM wikidata_claims ref
                       JOIN wikidata_claims at ON at.subject = ref.subject AND at.property = 'P625' AND at.value ? 'latitude'
                         AND at.rank >= 0 AND ${BEST('at')}
                      WHERE ref.property IN ('P361', 'P144') AND ref.value_item = c.subject AND ref.rank >= 0 AND ${BEST('ref')}))`,
    [castGroup, minSitelinks],
  );
  return result.rows.map(row => row.subject);
}
