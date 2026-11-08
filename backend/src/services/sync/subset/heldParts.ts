/**
 * The parts a kind holds of each of `wholes`, read off the local Wikidata
 * subset (ADR-0185): an item of `holds` that is part (`P361`) of a whole, or
 * that the whole has as a part (`P527`). The World Heritage listing of Mérida
 * has the Roman theatre and circus as its parts, both Archaeology's, and is
 * no place of its own beside them.
 */

import { pool } from '../../../db/index.js';

/** Each whole of `wholes` that has a part among `holds`, with one such part. */
export async function heldPartsOf(wholes: readonly string[], holds: ReadonlySet<string>): Promise<Map<string, string>> {
  if (!wholes.length || !holds.size) return new Map();
  const result = await pool.query<{ whole: string; part: string }>(
    `SELECT DISTINCT ON (whole) whole, part FROM (
       SELECT c.value_item AS whole, c.subject AS part FROM wikidata_claims c
        WHERE c.property = 'P361' AND c.rank >= 0 AND c.value_item = ANY($1::text[]) AND c.subject = ANY($2::text[])
       UNION ALL
       SELECT c.subject AS whole, c.value_item AS part FROM wikidata_claims c
        WHERE c.property = 'P527' AND c.rank >= 0 AND c.subject = ANY($1::text[]) AND c.value_item = ANY($2::text[])
     ) parts
     WHERE part <> whole
     ORDER BY whole, part`,
    [[...wholes], [...holds]],
  );
  return new Map(result.rows.map((row) => [row.whole, row.part]));
}
