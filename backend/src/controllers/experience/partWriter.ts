/**
 * The merge's writes to `experience_parts`, the part-of relation (ADR-0100
 * decision 4, #1250).
 *
 * A component becomes a part when `part_site_components()` parts it, and that
 * function is the relation's one other writer. A merge moves the relations the
 * folded place is in onto the survivor. The Temple of Karnak, a part of
 * *Ancient Thebes*, folds into the Karnak Temple Complex of Places of worship,
 * and the complex becomes the part. Without the move, the site would lose a
 * part to a place that offers nothing.
 *
 * Every write takes both places' `LockedExperience`, which the merge holds in
 * id order (`lockTwoExperiences`), so the relation is moved only under the
 * locks of the two places it names.
 */

import type { PoolClient } from 'pg';
import type { LockedExperience } from '../../db/experienceWriter.js';

/**
 * Move the relations `from` is in, as the part or as the whole, onto `to`.
 * With `only`, those relations by id, as the undo names them. A relation `to`
 * already holds with the same other place stays with `from`, since the pair is
 * unique. So does one that would make `to` part of itself. Answers the ids it
 * moved.
 */
export async function moveParts(
  client: PoolClient,
  from: LockedExperience,
  to: LockedExperience,
  only?: number[],
): Promise<number[]> {
  const result = await client.query<{ id: number }>(
    `WITH moved AS (
       SELECT f.id,
              CASE WHEN f.whole_id = $1 THEN $2 ELSE f.whole_id END AS whole_id,
              CASE WHEN f.part_id = $1 THEN $2 ELSE f.part_id END AS part_id
         FROM experience_parts f
        WHERE (f.whole_id = $1 OR f.part_id = $1) AND ($3::int[] IS NULL OR f.id = ANY($3::int[])))
     UPDATE experience_parts f SET whole_id = moved.whole_id, part_id = moved.part_id
       FROM moved
      WHERE f.id = moved.id AND moved.whole_id <> moved.part_id
        AND NOT EXISTS (SELECT 1 FROM experience_parts held
                         WHERE held.whole_id = moved.whole_id AND held.part_id = moved.part_id)
      RETURNING f.id`,
    [from.id, to.id, only ?? null],
  );
  return result.rows.map(row => row.id);
}

/**
 * Whether one of the two places is part of the other. Such a pair is a whole
 * and its part, and folding one into the other would make a place part of
 * itself. A curator answers that pair as *part of*, never as one place.
 */
export async function arePartAndWhole(client: PoolClient, a: LockedExperience, b: LockedExperience): Promise<boolean> {
  const found = await client.query(
    `SELECT 1 FROM experience_parts
      WHERE (whole_id = $1 AND part_id = $2) OR (whole_id = $2 AND part_id = $1) LIMIT 1`,
    [a.id, b.id],
  );
  return (found.rowCount ?? 0) > 0;
}
