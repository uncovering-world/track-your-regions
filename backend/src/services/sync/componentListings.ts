/**
 * What the World Heritage run's list says of each component of a site, read
 * for the part's record in World Heritage components (ADR-0156 decision 2):
 * which incoming point is the component's, and whether a record holds another
 * view than the list gives. `writePartListings` (`db/partFieldsWriter.ts`)
 * writes it, inside the run's write of the site's points (`locationWriter.ts`),
 * which then names each part for its point (`writeParts`).
 */

import type { PoolClient } from 'pg';
import { approximateReasons, type ApproximateReason } from '@tyr/shared/precision';
import { pool } from '../../db/index.js';
import type { LockedExperience } from '../../db/experienceWriter.js';
import { MEMBERSHIPS, componentRecordSql, membershipVisibleSql, partRecordSql } from '../../db/membership.js';
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
 * How roughly the run's list places each of its points, in the list's order
 * (#1853, `approximateReasons`): what a line's record holds beside the
 * coordinate (`reported_location_rough`), read whatever a curator made of the
 * point, since it is the list's view.
 */
export function listingRoughness(incoming: readonly IncomingLocation[]): (ApproximateReason | null)[] {
  return approximateReasons(incoming.map(point => ({ ref: point.externalRef, lon: point.lon, lat: point.lat })));
}

/**
 * The listings of `COMPONENT_LISTINGS` with how roughly each places its line
 * (`rough`), off the run's roughness by ordinal, bound as `roughParam`.
 */
const roughListingsSql = (roughParam: string) =>
  `SELECT cl.*, (${roughParam}::text[])[cl.ordinal] AS rough FROM (${COMPONENT_LISTINGS}) cl`;

/**
 * The point `alias` is the line point of a part of the site `$1` that the
 * run's list (`incoming`) no longer gives: the part's record in the site
 * carries that withdrawal (`writePartListings`), and the point stays standing,
 * so every reader shows the part and counts it in its site until a curator
 * answers (ADR-0216). A line the list gives again elsewhere, as a point the
 * run pairs with no part's point (`paired_rows`: an arrival is written on the
 * site, and joins the pairing as it is written), is a move, and its old point
 * goes as any point does, paired as the run pairs a move (`heldByNameSql`):
 * under its name, or under its record's reference where no other line of the
 * site carries the name the list gives it. A line the list gives under a
 * point the site already holds is no move: Western Tien-Shan's Maidantal area
 * is `1490-010` on a part of its own since a run made one, and its old part
 * stands, withdrawn on its record. Western
 * Tien-Shan's `1490-003` named the Karabastau area, the list dropped it, and
 * gives `1490-003` to the Boraldaitau area now: the Karabastau area stands,
 * withdrawn on its record. So does the line of a part nobody has read go,
 * which no reader was shown and nobody is asked about.
 */
export function lineWithdrawnOnItsRecordSql(alias: string): string {
  return `EXISTS (SELECT 1 FROM ${MEMBERSHIPS} gone_line
             WHERE gone_line.experience_id = ${alias}.experience_id AND gone_line.whole_id = $1
               AND ${partRecordSql('gone_line')} AND ${membershipVisibleSql('gone_line')}
               AND is_part_line_point(${alias}.id, gone_line.whole_id)
               AND NOT EXISTS (
                 SELECT 1 FROM incoming gone_i
                  WHERE NOT EXISTS (SELECT 1 FROM paired_rows gone_p
                                      JOIN experience_locations gone_pl ON gone_pl.id = gone_p.location_id
                                     WHERE gone_p.ordinal = gone_i.ordinal AND gone_pl.experience_id <> $1)
                    AND ((NOT names_nothing(gone_i.name) AND name_match_key(gone_i.name) = name_match_key(${alias}.name))
                     OR (lower(gone_i.external_ref) = lower(gone_line.external_id)
                         AND NOT EXISTS (
                           SELECT 1 FROM ${MEMBERSHIPS} other_line
                             JOIN experience_locations other ON other.experience_id = other_line.experience_id
                            WHERE other_line.whole_id = $1 AND ${partRecordSql('other_line')}
                              AND other.id <> ${alias}.id AND other.merged_into_id IS NULL
                              AND is_part_line_point(other.id, other_line.whole_id)
                              AND NOT names_nothing(gone_i.name)
                              AND name_match_key(other.name) = name_match_key(gone_i.name))))))`;
}

/**
 * Whether a component's record holds another view than the list gives it
 * now: written before the records existed, say, or the list moved a component
 * within the ten metres the fast path forgives. The fast path then gives way
 * to the write, which records it under the site's lock.
 */
export async function listingsDrift(experienceId: number, incoming: IncomingLocation[]): Promise<boolean> {
  const params = [...bindParams(experienceId, incoming), listingRoughness(incoming), incoming.length];
  const listed = roughListingsSql(`$${params.length - 1}`);
  const standing = `$${params.length}::int`;
  const drift = await pool.query(
    `WITH ${incomingCte(incoming.length)}, listed AS (${listed})
     SELECT 1 FROM (${partListingChangesSql('listed', standing)}) changed
      UNION ALL ${siteLineBehindSql()}
     LIMIT 1`,
    params,
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
  incoming: readonly IncomingLocation[],
): Promise<void> {
  if (run.components) {
    // The site's record of its own line first, so its listing is written with the parts'.
    await followTheSiteLine(client, lock);
    const listings = await client.query<{ record_id: number; name: string | null; lon: number; lat: number; ordinal: number }>(
      `WITH ${cte} ${COMPONENT_LISTINGS}`, params,
    );
    const rough = listingRoughness(incoming);
    await writePartListings(client, lock, listings.rows.map(row => (
      { recordId: row.record_id, name: row.name, lon: row.lon, lat: row.lat, ordinal: row.ordinal,
        rough: rough[row.ordinal - 1] ?? null })), incoming.length);
  }
  await followTheirPoints(client, lock, null);
}
