/**
 * What a merge asks of `experience_parts`, the part-of relation (ADR-0100
 * decision 4, #1250). The relation is derived from the records that claim it
 * (ADR-0198 decision 5, `parts_follow_records()`), so a merge moves records
 * (`moveMemberships`, `moveWholeRecords`) and the relation follows: the Temple
 * of Karnak, a part of *Ancient Thebes*, folds into the Karnak Temple Complex
 * of Places of worship, its record moves with it, and the complex becomes the
 * part. What is left here is the question the merge asks before it moves
 * anything.
 */

import type { PoolClient } from 'pg';
import type { LockedExperience } from '../../db/experienceWriter.js';

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
