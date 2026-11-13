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
import { MEMBERSHIPS } from '../../db/membership.js';

/**
 * Why the parts of two places keep them from being one place (ADR-0203), or
 * null where they do not:
 *
 * - `whole`: either is made of parts. A whole is never merged with anything,
 *   its own parts included; what is one place with another kind's place is
 *   one of its parts, the Temple of Karnak rather than Ancient Thebes.
 * - `one-whole`: both are parts of one whole, or each holds a record of one
 *   source in one whole. Two lines of one list are two places on the ground,
 *   and a source holds one record of a place in a whole.
 *
 * Parts of two different wholes may be one place: each keeps its record in
 * its own whole. Read under both places' locks. A record in a whole is
 * written under the whole's lock (`partFieldsWriter.ts`,
 * `part_site_components()`), so a place that became a whole while the merge
 * waited is seen as one.
 */
export async function partsBarMerge(
  client: PoolClient,
  a: LockedExperience,
  b: LockedExperience,
): Promise<'whole' | 'one-whole' | null> {
  const found = await client.query<{ whole: boolean; one_whole: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM experience_parts WHERE whole_id IN ($1, $2)) AS whole,
            EXISTS (SELECT 1 FROM experience_parts pa JOIN experience_parts pb ON pb.whole_id = pa.whole_id
                     WHERE pa.part_id = $1 AND pb.part_id = $2)
            OR EXISTS (SELECT 1 FROM ${MEMBERSHIPS} ra
                         JOIN ${MEMBERSHIPS} rb ON rb.whole_id = ra.whole_id AND rb.source_id = ra.source_id
                        WHERE ra.experience_id = $1 AND rb.experience_id = $2) AS one_whole`,
    [a.id, b.id],
  );
  const { whole, one_whole: oneWhole } = found.rows[0];
  if (whole) return 'whole';
  return oneWhole ? 'one-whole' : null;
}
