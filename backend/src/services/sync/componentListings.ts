/**
 * What the World Heritage run's list says of each component of a site, read
 * for the part's record in World Heritage components (ADR-0156 decision 2):
 * which incoming point is the component's, and whether a record holds another
 * view than the list gives. `writePartListings` (`db/partFieldsWriter.ts`)
 * writes it, inside the run's write of the site's points (`locationWriter.ts`),
 * which then names each part for its point (`writeParts`).
 */

import type { PoolClient } from 'pg';
import { pool } from '../../db/index.js';
import type { LockedExperience } from '../../db/experienceWriter.js';
import { MEMBERSHIPS, componentRecordSql, partRecordSql } from '../../db/membership.js';
import {
  followTheSiteLine, followTheirPoints, partListingChangesSql, partsBehindSql, siteLineBehindSql, writePartListings,
} from '../../db/partFieldsWriter.js';
import { foldedPointsSql } from '../../db/placePoints.js';
import { bindParams, incomingCte, type IncomingLocation } from './locationIncoming.js';

/**
 * What the run's list gives each line of the site (`$1`), as rows
 * `(record_id, name, lon, lat, ordinal)` for the line's record (ADR-0156
 * decision 2, ADR-0200): the incoming point whose ordinal and reference the
 * line's point carries once the run has paired it, read off the part's own
 * point or, after a merge, off the point the merge folded into the place it
 * kept (`foldedPointsSql`), the own first; for the site's record of itself, off
 * the site's own point under its reference. A line the list dropped is paired
 * with none, its point withdrawn with its ordinal. Read inside a statement
 * whose `incoming` holds the run's points.
 */
export const COMPONENT_LISTINGS = `(SELECT DISTINCT ON (rec.id) rec.id AS record_id, i.name, i.lon, i.lat, i.ordinal
    FROM experience_parts p
    JOIN ${MEMBERSHIPS} rec ON rec.experience_id = p.part_id AND rec.whole_id = p.whole_id
                           AND ${partRecordSql('rec')}
    JOIN experience_locations c ON c.external_ref = rec.external_id AND c.missing_since IS NULL
     AND ((c.experience_id = p.part_id AND c.merged_into_id IS NULL)
          OR c.id = ANY(ARRAY(SELECT ff.id FROM ${foldedPointsSql('ARRAY[p.part_id]')} ff)))
    JOIN incoming i ON i.ordinal = c.ordinal AND i.external_ref = c.external_ref
   WHERE p.whole_id = $1 AND p.reason = 'component'
   ORDER BY rec.id, c.merged_into_id IS NOT NULL, c.id)
  UNION ALL
  (SELECT DISTINCT ON (rec.id) rec.id, i.name, i.lon, i.lat, i.ordinal
    FROM ${MEMBERSHIPS} rec
    JOIN experience_locations c ON c.experience_id = $1 AND c.merged_into_id IS NULL AND c.missing_since IS NULL
                               AND c.external_ref = rec.external_id
    JOIN incoming i ON i.ordinal = c.ordinal AND i.external_ref = c.external_ref
   WHERE rec.whole_id = $1 AND rec.experience_id = $1 AND ${componentRecordSql('rec')}
   ORDER BY rec.id, c.id)`;

/**
 * Whether a component's record holds another view than the list gives it
 * now: written before the records existed, say, or the list moved a component
 * within the ten metres the fast path forgives. The fast path then gives way
 * to the write, which records it under the site's lock.
 */
export async function listingsDrift(experienceId: number, incoming: IncomingLocation[]): Promise<boolean> {
  const drift = await pool.query(
    `WITH ${incomingCte(incoming.length)}, listed AS (${COMPONENT_LISTINGS})
     SELECT 1 FROM (${partListingChangesSql('listed')}) changed
      UNION ALL ${siteLineBehindSql()}
     LIMIT 1`,
    bindParams(experienceId, incoming),
  );
  return (drift.rowCount ?? 0) > 0;
}

/**
 * Whether a part of the site is not what its point makes it (`partsBehindSql`):
 * its site renamed by a curator since the run named a part by it, say. The
 * fast path then gives way to the write, which names the part under the
 * site's lock.
 */
export async function partsBehind(experienceId: number): Promise<boolean> {
  const behind = await pool.query(`${partsBehindSql()} LIMIT 1`, [experienceId]);
  return (behind.rowCount ?? 0) > 0;
}

/**
 * The site's parts as the run left their points, under the site's lock: what
 * the list says of each component, on the part's record (ADR-0156 decision 2),
 * once a component that arrived is a part with one; and each part named,
 * placed and numbered for its point (`followTheirPoints`), whichever source's
 * run wrote the point.
 */
export async function writeParts(
  client: PoolClient,
  lock: LockedExperience,
  run: { components?: boolean },
  cte: string,
  params: unknown[],
): Promise<void> {
  if (run.components) {
    // The site's record of its own line first, so its listing is written with the parts'.
    await followTheSiteLine(client, lock);
    const listings = await client.query<{ record_id: number; name: string | null; lon: number; lat: number; ordinal: number }>(
      `WITH ${cte} ${COMPONENT_LISTINGS}`, params,
    );
    await writePartListings(client, lock, listings.rows.map(row => (
      { recordId: row.record_id, name: row.name, lon: row.lon, lat: row.lat, ordinal: row.ordinal })));
  }
  await followTheirPoints(client, lock, null);
}
