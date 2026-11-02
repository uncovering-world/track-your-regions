/**
 * A find linked to the site it came from by its own coordinate, as a
 * proposal a curator confirms (#2242).
 *
 * A site's card lists the finds dug up there through the find's Wikidata
 * "location of discovery" (`metadata.foundAt`), and many finds carry none. The
 * Dendera zodiac, cut from a chapel ceiling of the Temple of Hathor and held by
 * the Louvre, has no `P189`, but its own coordinate (`P625`) stands on the
 * temple, 3,637 km from the Louvre. So the end of every real run proposes, for
 * each find without one, the site its coordinate stands on, and leaves the
 * answer to a curator, because a coordinate says different things:
 *
 * - where the find comes from: the Dendera zodiac, the Code of Ur-Nammu at Ur,
 *   the Ishtar Gate at Babylon, the Libyco-Punic Mausoleum's inscription at
 *   Dougga. These are proposed;
 * - what a painting shows: The Yellow House's coordinate is Arles. Paintings
 *   are never proposed;
 * - where a memorial stood: Harmodius and Aristogeiton in Naples, a Roman copy,
 *   carries the Agora's coordinate, where the lost original stood. An item
 *   that is a memorial (`P31` Q5003624) is never proposed;
 * - where it is shown: the Rampin Rider's coordinate is the Acropolis Museum's.
 *   Where the nearest place is a museum, nothing is proposed.
 *
 * A find is a work an admitted archaeology museum holds. The site is the
 * nearest admitted World Heritage or Archaeology place within `REACH_M` of the
 * coordinate, never the museum itself, and the find's museum is more than
 * `AWAY_M` from it, so a work whose coordinate is its own museum's is left
 * alone. Measured on dev on 2026-11-02: four proposals, the four above; the
 * next place out, the Church of the Nativity for the Ain Sakhri lovers, stands
 * at 1,141 m and is not the cave they came from.
 *
 * A pair a curator has answered, or any pair of a find that already has a link,
 * is never proposed again. Read from the local Wikidata subset; where it holds
 * no coordinates, nothing is proposed.
 */

import { pool } from '../../db/index.js';
import { WORLD_HERITAGE_KIND_ID } from '../../db/inscription.js';
import { onEarthSql } from './subset/kit.js';

/** How near the site's point a find's coordinate must stand. */
export const REACH_M = 500;
/** How far from its own museum a find's coordinate must stand to say anything but the museum. */
export const AWAY_M = 50_000;
const ARCHAEOLOGY_KIND_ID = 5;
/**
 * The box a site's point is first looked for in around a find's coordinate,
 * in degrees, so the index on `experiences.location` answers before the exact
 * distance is measured: 500 m is under 0.05° of longitude up to 84° of latitude.
 */
const REACH_BOX_DEG = 0.05;
const MEMORIAL = 'Q5003624';

/** Proposes a site for every find its coordinate places at one, and answers how many it proposed; null where the subset's claims table is not there. */
export async function proposeFindSites(): Promise<number | null> {
  const ready = await pool.query<{ present: boolean }>(
    `SELECT to_regclass('workbench.wikidata_claims') IS NOT NULL AS present`,
  );
  if (!ready.rows[0]?.present) return null;
  const proposed = await pool.query(
    `WITH finds AS (
       SELECT DISTINCT t.id, t.external_id, et.experience_id AS museum_id
         FROM treasures t
         JOIN experience_treasures et ON et.treasure_id = t.id AND et.missing_since IS NULL
         JOIN experience_kind_memberships mm ON mm.experience_id = et.experience_id
              AND mm.kind_id = $1 AND mm.admission = 'admitted'
        WHERE t.metadata->'foundAt' IS NULL AND t.treasure_type <> 'painting'
          AND NOT EXISTS (SELECT 1 FROM find_site_links l WHERE l.treasure_id = t.id)
          AND NOT EXISTS (SELECT 1 FROM wikidata_claims c WHERE c.subject = t.external_id AND c.property = 'P31'
                           AND c.value_item = $5 AND c.rank >= 0)
     ), placed AS (
       SELECT f.*, ST_SetSRID(ST_MakePoint((c.value->>'longitude')::float8, (c.value->>'latitude')::float8), 4326) AS pt
         FROM finds f CROSS JOIN LATERAL (
           SELECT c.value FROM wikidata_claims c
            WHERE c.subject = f.external_id AND c.property = 'P625' AND c.rank >= 0
              AND c.value ? 'latitude' AND ${onEarthSql('c')}
            ORDER BY c.rank DESC, c.statement_id LIMIT 1) c
     ), nearest AS (
       SELECT p.id AS treasure_id, s.id AS site_id, s.distance, s.museum
         FROM placed p
         JOIN experiences own ON own.id = p.museum_id
         CROSS JOIN LATERAL (
           SELECT e.id, ST_Distance(p.pt::geography, e.location::geography) AS distance,
                  EXISTS (SELECT 1 FROM experience_kind_memberships m
                           WHERE m.experience_id = e.id AND m.kind_id = $1 AND m.type = 'museum') AS museum
             FROM experiences e
            WHERE e.location && ST_Expand(p.pt, $6) AND ST_DWithin(p.pt::geography, e.location::geography, $3)
              AND e.id <> p.museum_id
              AND EXISTS (SELECT 1 FROM experience_kind_memberships m
                           WHERE m.experience_id = e.id AND m.kind_id IN ($1, $2) AND m.admission = 'admitted')
            ORDER BY distance LIMIT 1) s
        WHERE NOT ST_DWithin(p.pt::geography, own.location::geography, $4)
     )
     INSERT INTO find_site_links (treasure_id, site_id, state, origin, distance_m)
     SELECT treasure_id, site_id, 'proposed', 'coordinate', round(distance)::int FROM nearest WHERE NOT museum
     ON CONFLICT (treasure_id, site_id) DO NOTHING`,
    [ARCHAEOLOGY_KIND_ID, WORLD_HERITAGE_KIND_ID, REACH_M, AWAY_M, MEMORIAL, REACH_BOX_DEG],
  );
  return proposed.rowCount ?? 0;
}
