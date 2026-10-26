/**
 * The street-art places' questions answered from the local Wikidata subset
 * (#2035): the items filed under a genre, the marks a candidate's fame and
 * standing are read from, and which of a set of roots each class is a kind
 * of. Each answers what its live twin in `publicArt/streetArtQueries.ts`
 * answers.
 */

import { pool } from '../../../db/index.js';
import { BEST, entitiesOf } from './entities.js';
import { bestStatements, isNoValue } from './values.js';
import type { StreetArtMarks } from '../publicArt/streetArtQueries.js';

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
