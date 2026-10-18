/**
 * A place placed beside an internal border, where nothing confirms the side it
 * was put on (#1054).
 *
 * Placement tests a point against a region's full-resolution geometry, and
 * that is as exact as the boundary it reads. GADM 4.1 draws many internal
 * borders with a vertex every kilometre or more — Ararat with 169 for a 229 km
 * outline, Damascus with 12 — so a point closer to a border than that is placed
 * by the straight chord between two vertices, not by where the border runs.
 * Measured on the development catalogue on 2026-10-17: 735 of 4,034 world view
 * 5 placements sit within a kilometre of another region. Geghard and Garni are
 * under Ararat though they stand in Kotayk, and the Umayyad Mosque is under Rif
 * Dimashq though it stands in Damascus.
 *
 * The maintainer's decision on #1054: a curator decides a near-border
 * placement, and only an answer the data gives and a second source confirms
 * may stand without one. So this rule moves nothing, and asks a curator about
 * every such placement the data does not confirm. The item's administrative
 * chain (`P131`, up to six steps in the local Wikidata subset) is the one
 * second source read, and it confirms a placement only where it names the
 * region the place is in and not the neighbour. Every other answer is a
 * question:
 * - it names the neighbour: Geghard and Garni (Kotayk, not Ararat), the Umayyad
 *   Mosque (Damascus) — and Kourion and Old St. Peter's, where it is wrong;
 * - it names both, or neither by name: the Old City of Jerusalem's sites on a
 *   disputed line, and the Valley of the Kings, whose chain says *Luxor
 *   Governorate* where GADM says *Al Uqsur*;
 * - the item has no chain, or there is no item: the Pietà, St Peter's
 *   Baldachin, the Sydney Opera House.
 * Measured on world view 5 on 2026-10-17, the only one placed: 190 placements
 * sit within a kilometre of another region by their own point; the chain
 * confirms 54, and of the other 136 the 129 a reader is offered are asked.
 *
 * A row is answered by a curator. Moving it adds the object to the right region
 * and removes it from the wrong one; confirming it adds the object to the
 * region it is in by hand. Either way the place is no longer asked about, and a
 * later placement run does not bring the question back: a placement run clears
 * only automatic rows and places the point again, which puts the automatic row
 * a curator removed back in place, so the rule skips a pair a curator rejected
 * (`experience_rejections`, the guard the removal writes) and a place a curator
 * placed by hand in any leaf of the same world view.
 *
 * What it reads:
 * - only an automatic placement (`assignment_type = 'auto'`) of an object a
 *   reader is offered, in a leaf region whose pieces contain the object's own
 *   point — the placement that point made, not one a component made, which is
 *   how a serial site spread over many regions is left out;
 * - the nearest other leaf of the same world view within `NEAR_BORDER_M`,
 *   searched in degrees widened by the point's latitude, so a neighbour a
 *   kilometre east of a place in Iceland is reached;
 * - the item a membership names, or, for a World Heritage row known by
 *   UNESCO's number, the item that number resolves to, as the run stored it
 *   on the membership (`wikidata_items`, ADR-0088): looking the number up in
 *   `wikidata_claims` has no index to use and reads every claim, about half a
 *   minute for each such row;
 * - region and item matched by English label, either containing the other.
 *
 * Eleven seconds over the development catalogue on 2026-10-18, on a machine
 * under load.
 */

import { experienceOfferedToReaderSql, hideLostSql } from '../../../db/readerPredicates.js';
import { MEMBERSHIPS } from '../../../db/membership.js';
import { count, text } from './assertion.js';
import type { CatalogueAssertion } from './assertion.js';

/** The World Heritage source, whose rows carry UNESCO's number rather than a Wikidata item. */
const WORLD_HERITAGE_SOURCE = 1;
/** How near another region a point must be for its border's resolution to decide it. */
export const NEAR_BORDER_M = 1000;
/**
 * The search radius in degrees of latitude, a margin over `NEAR_BORDER_M`
 * (0.009°); a degree of longitude shrinks with latitude, so the query widens it
 * by the point's latitude rather than missing an eastern neighbour up north.
 */
const SEARCH_DEGREES = 0.02;
/** How many steps of `P131` are followed: a monument, its village, its municipality, its district, its province, its country. */
const CHAIN_STEPS = 6;

/** A label read the way the two sides are compared: lower case, accents taken off. */
const folded = (sql: string) => `lower(unaccent(${sql}))`;
/** Whether a label of the chain and a region's name name one place, either containing the other. */
const namesRegion = (label: string, region: string) =>
  `(${label} LIKE '%' || ${folded(region)} || '%' OR ${folded(region)} LIKE '%' || ${label} || '%')`;

const nearBorderUnconfirmed: CatalogueAssertion = {
  id: 'placed-near-a-border-unconfirmed',
  area: 'regions',
  title: 'A place within a kilometre of another region, its side not confirmed by its Wikidata item',
  kind: 'invariant',
  meaning:
    'The place was put in its region by a border drawn with a vertex every kilometre or so, and its own Wikidata '
    + 'item does not confirm that side (#1054): it names the neighbour, both, neither, or nothing. A curator decides. '
    + 'Where the place belongs next door, add it to that region and remove it from this one; where it is right '
    + 'where it is (a disputed line, an enclave, a chain that skips a level), add it to this region by hand. '
    + 'Either way the automatic placement stops being asked about.',
  sql: `WITH placed AS (
          SELECT e.id AS experience_id, e.name AS experience_name, e.location AS pt,
                 r.id AS region_id, r.name AS region_name, r.world_view_id,
                 COALESCE(
                   (SELECT km.external_id FROM ${MEMBERSHIPS} km
                     WHERE km.experience_id = e.id AND km.external_id ~ '^Q[0-9]+$' ORDER BY km.id LIMIT 1),
                   (SELECT min(item) FROM ${MEMBERSHIPS} km, unnest(km.wikidata_items) item
                     WHERE km.experience_id = e.id AND km.source_id = ${WORLD_HERITAGE_SOURCE})) AS item
            FROM experiences e
            JOIN experience_regions er ON er.experience_id = e.id AND er.assignment_type = 'auto'
            JOIN regions r ON r.id = er.region_id AND r.is_leaf
           WHERE e.location IS NOT NULL
             AND ${hideLostSql()}
             AND ${experienceOfferedToReaderSql()}
             AND EXISTS (SELECT 1 FROM region_geom_pieces p
                          WHERE p.region_id = r.id AND ST_Contains(p.geom, e.location))
             -- A curator's answer stands: a removal the next run undid, or a place set by hand.
             AND NOT EXISTS (SELECT 1 FROM experience_rejections x
                              WHERE x.experience_id = e.id AND x.region_id = r.id)
             AND NOT EXISTS (SELECT 1 FROM experience_regions m JOIN regions mr ON mr.id = m.region_id
                              WHERE m.experience_id = e.id AND m.assignment_type = 'manual'
                                AND mr.world_view_id = r.world_view_id AND mr.is_leaf)),
        near AS (
          SELECT placed.*, n.other_id, n.other_name, n.metres
            FROM placed
           CROSS JOIN LATERAL (
             SELECT o.id AS other_id, o.name AS other_name,
                    ST_Distance(placed.pt::geography, g.geom::geography) AS metres
               FROM region_geom_pieces g
               JOIN regions o ON o.id = g.region_id
              WHERE o.world_view_id = placed.world_view_id AND o.is_leaf AND o.id <> placed.region_id
                AND ST_DWithin(g.geom, placed.pt, ${SEARCH_DEGREES} / greatest(cos(radians(ST_Y(placed.pt))), 0.05))
              ORDER BY 3 LIMIT 1) n
           WHERE n.metres <= ${NEAR_BORDER_M}),
        chain AS (
          WITH RECURSIVE up (item, step, depth) AS (
            SELECT DISTINCT near.item, c.value_item, 1
              FROM near JOIN wikidata_claims c ON c.subject = near.item AND c.property = 'P131' AND c.rank >= 0
            UNION
            SELECT up.item, c.value_item, up.depth + 1
              FROM up JOIN wikidata_claims c ON c.subject = up.step AND c.property = 'P131' AND c.rank >= 0
             WHERE up.depth < ${CHAIN_STEPS})
          SELECT DISTINCT up.item, ${folded('l.label')} AS label
            FROM up JOIN wikidata_labels l ON l.id = up.step AND l.language = 'en'),
        judged AS (
          SELECT near.*,
                 EXISTS (SELECT 1 FROM chain WHERE chain.item = near.item) AS has_chain,
                 EXISTS (SELECT 1 FROM chain WHERE chain.item = near.item AND ${namesRegion('chain.label', 'near.region_name')}) AS names_placed,
                 EXISTS (SELECT 1 FROM chain WHERE chain.item = near.item AND ${namesRegion('chain.label', 'near.other_name')}) AS names_other
            FROM near)
        SELECT judged.experience_id, judged.experience_name, judged.item, judged.region_id, judged.region_name,
               judged.other_id, judged.other_name, round(judged.metres)::int AS metres, w.name AS world_view_name,
               CASE WHEN judged.item IS NULL THEN 'no-item'
                    WHEN NOT judged.has_chain THEN 'no-chain'
                    WHEN judged.names_other AND NOT judged.names_placed THEN 'names-other'
                    WHEN judged.names_other THEN 'names-both'
                    ELSE 'names-neither' END AS answer
          FROM judged
          JOIN world_views w ON w.id = judged.world_view_id
         WHERE NOT (judged.names_placed AND NOT judged.names_other)
         ORDER BY (judged.names_other AND NOT judged.names_placed) DESC, judged.metres DESC, judged.experience_name`,
  describe: row => `${text(row, 'experience_name')}${row.item ? ' (' + text(row, 'item') + ')' : ''}: placed in `
    + `${text(row, 'region_name')} (${text(row, 'world_view_name')}), ${count(row, 'metres')} m from `
    + `${text(row, 'other_name')}; ${ANSWERS[text(row, 'answer')] ?? 'Wikidata does not confirm the side'} `
    + `(experience ${count(row, 'experience_id')})`,
};

/** What the item's administrative chain said, as the row reads it. */
const ANSWERS: Record<string, string> = {
  'names-other': 'its Wikidata item names the neighbour',
  'names-both': 'its Wikidata item names both regions',
  'names-neither': 'its Wikidata item names neither region by name',
  'no-chain': 'its Wikidata item states no administrative region',
  'no-item': 'it has no Wikidata item',
};

export const borderPlacementAssertions: CatalogueAssertion[] = [nearBorderUnconfirmed];
