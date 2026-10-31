/**
 * The street-art places' questions answered from the local Wikidata subset
 * (#2035): the items filed under a genre or typed by a class (#2055), the
 * marks a candidate's fame and standing are read from, which of a set of
 * roots each class is a kind of, and what a street-art place holds. Each
 * answers what its live twin in `publicArt/streetArtQueries.ts` answers.
 */

import { pool } from '../../../db/index.js';
import { BEST, entitiesOf, STANDING } from './entities.js';
import { bestStatements, isNoValue } from './values.js';
import type { StreetArtHolding, StreetArtMarks } from '../publicArt/streetArtQueries.js';

/** Every item filed under one of `genres` (`P136`, best rank), as `fetchItemsOfGenres` answers. */
export async function subsetItemsOfGenres(genres: readonly string[]): Promise<string[]> {
  if (!genres.length) return [];
  const result = await pool.query<{ subject: string }>(
    `SELECT DISTINCT c.subject FROM wikidata_claims c
      WHERE c.property = 'P136' AND c.value_item = ANY($1::text[]) AND c.rank >= 0 AND ${BEST('c')}
      ORDER BY c.subject`,
    [genres],
  );
  return result.rows.map(row => row.subject);
}

/**
 * Every item typed by one of `classes` or a subclass of one (`P31`, best
 * rank, through `wikidata_class_closure`), as `fetchItemsOfClasses` answers.
 */
export async function subsetItemsOfClasses(classes: readonly string[]): Promise<string[]> {
  if (!classes.length) return [];
  const result = await pool.query<{ subject: string }>(
    `SELECT DISTINCT c.subject FROM wikidata_claims c
       JOIN wikidata_class_closure k ON k.class = c.value_item
      WHERE c.property = 'P31' AND k.ancestor = ANY($1::text[]) AND c.rank >= 0 AND ${BEST('c')}
      ORDER BY c.subject`,
    [classes],
  );
  return result.rows.map(row => row.subject);
}

/** Whether each kept item has an Atlas Obscura entry and an end, as `fetchStreetArtMarks` answers. */
export async function subsetStreetArtMarks(qids: string[]): Promise<Map<string, StreetArtMarks>> {
  const out = new Map<string, StreetArtMarks>();
  const holds = (statements: Parameters<typeof bestStatements>[0]) =>
    bestStatements(statements).some(statement => !isNoValue(statement.value));
  for (const [id, { entity }] of await entitiesOf(qids)) {
    out.set(id, { atlasObscura: holds(entity.claims.P7772), ended: holds(entity.claims.P576) });
  }
  return out;
}

/**
 * Which of `roots` each class is a kind of, a root counting as a kind of
 * itself, through the class tree (`wikidata_class_closure`), as
 * `fetchRootsOfClasses` answers. The closure follows every subclass
 * statement that is not deprecated, where `wdt:P279*` follows the best ones.
 */
export async function subsetRootsOfClasses(classes: string[], roots: readonly string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!classes.length || !roots.length) return out;
  const result = await pool.query<{ class: string; ancestor: string }>(
    `SELECT DISTINCT k.class, k.ancestor FROM wikidata_class_closure k
      WHERE k.class = ANY($1::text[]) AND k.ancestor = ANY($2::text[])
      ORDER BY k.class, k.ancestor`,
    [classes, roots],
  );
  for (const row of result.rows) out.set(row.class, [...(out.get(row.class) ?? []), row.ancestor]);
  return out;
}

/**
 * What each of `places` holds by a standing statement: a part the place names
 * (`P527`), or a work that says it stands in the place (`P276`) or is part of
 * it (`P361`), as `fetchStreetArtHoldings` answers.
 */
export async function subsetStreetArtHoldings(places: string[]): Promise<StreetArtHolding[]> {
  if (!places.length) return [];
  const result = await pool.query<StreetArtHolding>(
    `SELECT c.subject AS place, c.value_item AS work FROM wikidata_claims c
      WHERE c.property = 'P527' AND c.subject = ANY($1::text[]) AND c.value_item IS NOT NULL AND ${STANDING('c')}
     UNION
     SELECT c.value_item AS place, c.subject AS work FROM wikidata_claims c
      WHERE c.property IN ('P276', 'P361') AND c.value_item = ANY($1::text[]) AND ${STANDING('c')}
     ORDER BY place, work`,
    [places],
  );
  return result.rows;
}
