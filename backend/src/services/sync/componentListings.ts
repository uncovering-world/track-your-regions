/**
 * What the World Heritage run's list says of each component of a site, read
 * for the part's record in World Heritage components (ADR-0156 decision 2):
 * which incoming point is the component's, and whether a record holds another
 * view than the list gives. `writePartListings` (`db/partFieldsWriter.ts`)
 * writes it, inside the run's write of the site's points (`locationWriter.ts`).
 */

import { pool } from '../../db/index.js';
import { COMPONENTS_KIND_ID, MEMBERSHIPS } from '../../db/membership.js';
import { partListingChangesSql } from '../../db/partFieldsWriter.js';
import { foldedPointsSql } from '../../db/placePoints.js';
import { bindParams, incomingCte, type IncomingLocation } from './locationIncoming.js';

/**
 * What the run's list gives each component of the site (`$1`), as rows
 * `(record_id, name, lon, lat)` for the part's record in World Heritage
 * components (ADR-0156 decision 2): the incoming point whose ordinal and
 * reference the component's point carries once the run has paired it, read off
 * the part's own point or, after a merge, off the point the merge folded into
 * the place it kept (`foldedPointsSql`), the own first. A component the list
 * dropped is paired with none, its point withdrawn with its ordinal. Read
 * inside a statement whose `incoming` holds the run's points.
 */
export const COMPONENT_LISTINGS = `SELECT DISTINCT ON (rec.id) rec.id AS record_id, i.name, i.lon, i.lat
    FROM experience_parts p
    JOIN ${MEMBERSHIPS} rec ON rec.experience_id = p.part_id AND rec.kind_id = ${COMPONENTS_KIND_ID}
                           AND rec.external_id = 'component:' || p.id
    JOIN experience_locations c ON c.external_ref = p.external_ref AND c.missing_since IS NULL
     AND ((c.experience_id = p.part_id AND c.merged_into_id IS NULL)
          OR c.id = ANY(ARRAY(SELECT ff.id FROM ${foldedPointsSql('ARRAY[p.part_id]')} ff)))
    JOIN incoming i ON i.ordinal = c.ordinal AND i.external_ref = c.external_ref
   WHERE p.whole_id = $1 AND p.reason = 'component'
   ORDER BY rec.id, c.merged_into_id IS NOT NULL, c.id`;

/**
 * Whether a component's record holds another view than the list gives it
 * now: written before the records existed, say, or the list moved a component
 * within the ten metres the fast path forgives. The fast path then gives way
 * to the write, which records it under the site's lock.
 */
export async function listingsDrift(experienceId: number, incoming: IncomingLocation[]): Promise<boolean> {
  const drift = await pool.query(
    `WITH ${incomingCte(incoming.length)}, listed AS (${COMPONENT_LISTINGS})
     SELECT 1 FROM (${partListingChangesSql('listed')}) changed LIMIT 1`,
    bindParams(experienceId, incoming),
  );
  return (drift.rowCount ?? 0) > 0;
}
