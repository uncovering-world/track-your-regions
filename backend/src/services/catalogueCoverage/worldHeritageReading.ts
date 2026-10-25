/**
 * The World Heritage List as a coverage survey reads it (#1981): the
 * properties and their components the catalogue's UNESCO run holds, read off
 * the catalogue's own rows. The run reads UNESCO's open dataset (`whc001` on
 * data.unesco.org, CC BY-SA 4.0, `unescoApi.ts`) as a program under its
 * operator's rules (ADR-0148). A survey's agent, reading pages, may not read
 * whc.unesco.org, whose pages answer 403 to its fetch tool, nor fetch the
 * dataset's `/api/` paths, which its robots.txt closes to every agent but
 * Googlebot (`docs/sources/site-access.md`). So the survey reads what the run already
 * holds rather than fetch the dataset a second time.
 *
 * A property is a place holding a membership of the World Heritage source the
 * source still lists; its components are the points the place shows (its own
 * and its parts') under the property's number, whatever extension renumbered
 * it (`1459-113` of 1459, `91quater-001` of 91), and
 * the points a merge folded into one it shows (`foldedPointsSql`), which keep
 * UNESCO's reference and name while the property's membership still places
 * the point they were folded into; a component the source no longer lists is
 * left out. In reference order.
 */

import type { Pool, PoolClient } from 'pg';
import { MEMBERSHIPS } from '../../db/membership.js';
import { foldedPointsSql, placePointsSql, pointNameSql } from '../../db/placePoints.js';
import { offeredLocationSql } from '../../db/readerPredicates.js';

/** The World Heritage source, as seeded. */
const UNESCO_SOURCE_ID = 1;

export interface WorldHeritageProperty {
  /** UNESCO's id of the property, `274` for Machu Picchu. */
  id: string;
  name: string;
  countries: string[];
  /** Each component as UNESCO lists it: its reference (`1459-007`) and its name. */
  components: Array<{ ref: string; name: string | null }>;
}

/**
 * The properties in any of `countries` (ISO 3166-1 alpha-2 codes, as the
 * catalogue stores a property's states party) or with any of `ids`, each with
 * its components, in UNESCO's order.
 */
export async function worldHeritageReading(
  query: Pick<Pool | PoolClient, 'query'>,
  { countries = [], ids = [] }: { countries?: readonly string[]; ids?: readonly string[] },
): Promise<WorldHeritageProperty[]> {
  const result = await query.query<{ id: string; name: string; countries: string[] | null; components: Array<{ ref: string; name: string | null }> | null }>(
    `SELECT m.external_id AS id, e.name, e.country_codes AS countries,
            (SELECT json_agg(json_build_object('ref', c.ref, 'name', c.name) ORDER BY c.ref)
               FROM (SELECT el.external_ref AS ref, ${pointNameSql('el')} AS name
                       FROM ${placePointsSql()} pp
                       JOIN experience_locations el ON el.id = pp.location_id
                      WHERE pp.place_id = e.id AND ${offeredLocationSql('el')}
                        -- UNESCO's own components: a reference under the property's
                        -- number, whatever extension renumbered it (1459-113 of 1459,
                        -- 91quater-001 of 91), never another kind's point a merge brought.
                        AND substring(el.external_ref from '^[0-9]+') = substring(m.external_id from '^[0-9]+')
                     UNION
                     -- A component whose point a merge folded into another kind's
                     -- point (ADR-0088 decision 3): the kept point is shown, and
                     -- the folded one still carries UNESCO's reference and name.
                     -- A reference the source dropped leaves the folded point as it
                     -- was, so what says the source still lists it is the property's
                     -- placement of the kept point, which the run takes away.
                     SELECT f.external_ref, f.name
                       FROM ${foldedPointsSql('ARRAY[e.id]')} fp
                       JOIN experience_locations f ON f.id = fp.id
                       JOIN experience_locations kept ON kept.id = fp.kept_id
                      WHERE ${offeredLocationSql('kept')} AND substring(f.external_ref from '^[0-9]+') = substring(m.external_id from '^[0-9]+')
                        AND EXISTS (SELECT 1 FROM experience_location_placements pl
                                     WHERE pl.location_id = kept.id AND pl.membership_id = m.id)) c) AS components
       FROM ${MEMBERSHIPS} m
       JOIN experiences e ON e.id = m.experience_id AND e.merged_into_id IS NULL
      WHERE m.source_id = $1 AND m.missing_since IS NULL
        AND (e.country_codes::text[] && $2::text[] OR m.external_id = ANY($3::text[]))
      ORDER BY (substring(m.external_id from '^[0-9]+'))::int, m.external_id`,
    [UNESCO_SOURCE_ID, countries.map(code => code.toUpperCase()), [...ids]],
  );
  return result.rows.map(row => ({
    id: row.id, name: row.name, countries: row.countries ?? [], components: row.components ?? [],
  }));
}
