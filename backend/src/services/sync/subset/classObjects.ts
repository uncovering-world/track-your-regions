/**
 * Whether an item is itself a class, answered from the local Wikidata subset
 * (#2171): how many items name it as what they are (`P31`, best rank), and
 * whether it is a subclass of anything (`P279`). The twin of
 * `fetchClassObjects` in `publicArt/monumentCategoryQueries.ts`.
 */

import { pool } from '../../../db/index.js';
import { BEST } from './entities.js';
import type { ClassObject } from '../publicArt/monumentCategoryQueries.js';

/** Each of `qids` that is a class, with its instances and whether it has a superclass; an item that is neither has no entry. */
export async function subsetClassObjects(qids: string[]): Promise<Map<string, ClassObject>> {
  const out = new Map<string, ClassObject>();
  if (!qids.length) return out;
  const result = await pool.query<{ id: string; instances: number; subclass: boolean }>(
    `SELECT q.id,
            (SELECT count(DISTINCT c.subject)::int FROM wikidata_claims c
              WHERE c.property = 'P31' AND c.value_item = q.id AND c.rank >= 0 AND ${BEST('c')}) AS instances,
            EXISTS (SELECT 1 FROM wikidata_claims s
                     WHERE s.property = 'P279' AND s.subject = q.id AND s.rank >= 0 AND s.value_item IS NOT NULL) AS subclass
       FROM unnest($1::text[]) AS q(id)`,
    [qids],
  );
  for (const row of result.rows) {
    if (row.instances > 0 || row.subclass) out.set(row.id, { instances: row.instances, subclass: row.subclass });
  }
  return out;
}
