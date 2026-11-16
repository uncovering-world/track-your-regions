/**
 * What must be true of a whole's parts (ADR-0100, ADR-0198): one line of a
 * source's list is one part, and an item names one place.
 *
 * Both read the parts' records in their whole (`partRecordSql`), the column
 * that makes a place a part, rather than the relation derived from it.
 */

import {
  MEMBERSHIPS, membershipAdmittedSql, partRecordSql, partRecordUnreadSql, partRecordWithdrawnSql, placeOfferedSql,
} from '../../../db/membership.js';
import { hideLostSql, offeredLocationSql, partRecordShownSql, publishedContentSql } from '../../../db/readerPredicates.js';
import { MOST_LEVELS } from '../../experience/partRecordController.js';
import { withdrawnPointOpenSql } from '../../experience/reviewQueuePredicates.js';
import { unreadPointSql } from '../../experience/waitingCounts.js';
import { count, text } from './assertion.js';
import type { AssertionRow, CatalogueAssertion } from './assertion.js';

/** How far apart two parts under one reference may stand and still be one line read twice. */
const ONE_SPOT_M = 10;
/** How far apart two parts carrying one item stand before the item cannot be both. */
const FAR_APART_M = 1000;

/**
 * A point of the part `part` that is still in the world and not turned down:
 * what keeps a copy of a line standing. A curator who turns the copy's point
 * down settles the row (ADR-0053).
 */
const standingPointSql = (part: string) => `EXISTS (
  SELECT 1 FROM experience_locations el
   WHERE el.experience_id = ${part}.id AND el.merged_into_id IS NULL
     AND ${hideLostSql('el')} AND el.refused_at IS NULL)`;

/**
 * Two parts of one whole under one reference, standing at one spot.
 *
 * The list gives each line a reference, and a run pairs a line it reads again
 * with the part already standing there (ADR-0137). Two parts at one spot under
 * one reference are that line read twice, so a row means a writer wrote a
 * line twice. Hidden copies count too, since they hide the part's reference
 * from the run's lookup (the registry holds a reference two places claim as
 * identifying neither).
 */
const partsOfOneWholeAtOneSpot: CatalogueAssertion = {
  id: 'parts-of-one-whole-at-one-spot',
  area: 'places',
  title: 'Two parts of one site under one reference, at one spot',
  kind: 'invariant',
  meaning:
    'One line of the site\'s list stands twice, as two parts at the same spot. '
    + 'A curator turns down the copy that waits unread on the site\'s card. '
    + 'A copy no card shows means a run wrote the line twice, so tell the admin who runs it.',
  sql: `SELECT w.id AS whole_id, w.name AS whole_name, ra.external_id AS reference,
               a.id AS first_id, a.name AS first_name, b.id AS second_id, b.name AS second_name,
               ST_Distance(a.location::geography, b.location::geography) AS metres
          FROM ${MEMBERSHIPS} ra
          JOIN ${MEMBERSHIPS} rb
            ON rb.source_id = ra.source_id AND rb.whole_id = ra.whole_id
           AND rb.external_id = ra.external_id AND rb.experience_id > ra.experience_id
           AND ${partRecordSql('rb')}
          JOIN experiences a ON a.id = ra.experience_id AND a.merged_into_id IS NULL
          JOIN experiences b ON b.id = rb.experience_id AND b.merged_into_id IS NULL
          JOIN experiences w ON w.id = ra.whole_id
         WHERE ${partRecordSql('ra')}
           AND ST_DWithin(a.location::geography, b.location::geography, ${ONE_SPOT_M})
           AND ${standingPointSql('a')} AND ${standingPointSql('b')}
         ORDER BY w.name, ra.external_id, a.id`,
  describe: (row: AssertionRow) => `${text(row, 'whole_name')} (#${count(row, 'whole_id')}), `
    + `${text(row, 'reference')}: ${text(row, 'first_name')} (#${count(row, 'first_id')}) and `
    + `${text(row, 'second_name')} (#${count(row, 'second_id')}), `
    + `${Math.round(count(row, 'metres'))} m apart`,
};

/**
 * One Wikidata item on parts of one whole that stand far apart.
 *
 * A list line's item is its part's (ADR-0200), and parts a kilometre or more
 * apart are not one place, so the item names one of them, or the whole they
 * make up. Measured on the development catalogue on 2026-11-13: 10 items on
 * parts a reader is shown, among them Masoala National Park on its six
 * parcels, 73 km apart, and the Daursky reserve on both Dauria parts, 78 km
 * apart. The registry already holds such an item as referring on every part,
 * so nothing is joined by it; what is wrong is the picture and article each
 * part takes from it. Only parts a reader is shown are asked about, since a
 * part no reader sees still waits for a curator who can settle its item then,
 * and a part a curator has answered the item on (`place_identifier_verdicts`)
 * is settled.
 */
const itemOnFarParts: CatalogueAssertion = {
  id: 'item-on-far-parts',
  area: 'places',
  title: 'One Wikidata item on parts of one site more than a kilometre apart',
  kind: 'invariant',
  meaning:
    'Parts this far apart are not one place, so the item names at most one of them. '
    + 'Under Identifiers on each part\'s card, a curator says which part it names. '
    + 'On the others it only refers to the place, or is taken off.',
  sql: `WITH carried AS (
          SELECT rec.whole_id, item, part.id AS part_id, part.name, part.location
            FROM ${MEMBERSHIPS} rec
            JOIN experiences part ON part.id = rec.experience_id AND part.merged_into_id IS NULL
            JOIN experiences whole ON whole.id = rec.whole_id
           CROSS JOIN LATERAL unnest(rec.wikidata_items) AS item
           WHERE ${partRecordSql('rec')} AND ${placeOfferedSql('whole')}
             AND EXISTS (SELECT 1 FROM experience_locations el
                          WHERE el.experience_id = part.id AND ${offeredLocationSql('el')}
                            AND ${publishedContentSql('el')})
             AND NOT EXISTS (SELECT 1 FROM place_identifier_verdicts v
                              WHERE v.experience_id = part.id AND v.scheme = 'wikidata' AND v.value = item
                                AND v.verdict IN ('refers', 'removed'))
        ), far AS (
          SELECT a.whole_id, a.item, max(ST_Distance(a.location::geography, b.location::geography)) AS metres
            FROM carried a
            JOIN carried b ON b.whole_id = a.whole_id AND b.item = a.item AND b.part_id <> a.part_id
           GROUP BY a.whole_id, a.item
          HAVING max(ST_Distance(a.location::geography, b.location::geography)) > ${FAR_APART_M}
        )
        SELECT far.whole_id, w.name AS whole_name, far.item, label.label, far.metres,
               array_agg(c.name || ' (#' || c.part_id || ')' ORDER BY c.name, c.part_id) AS parts
          FROM far
          JOIN experiences w ON w.id = far.whole_id
          JOIN carried c ON c.whole_id = far.whole_id AND c.item = far.item
          LEFT JOIN workbench.wikidata_labels label ON label.id = far.item AND label.language = 'en'
         GROUP BY far.whole_id, w.name, far.item, label.label, far.metres
         ORDER BY far.metres DESC, far.item`,
  describe: (row: AssertionRow) => {
    const label = text(row, 'label');
    const item = label ? `${text(row, 'item')} (${label})` : text(row, 'item');
    // Names come from outside; each is read as `text` reads a column.
    const parts = Array.isArray(row.parts) ? (row.parts as unknown[]).map(one => text({ one }, 'one')) : [];
    return `${text(row, 'whole_name')} (#${count(row, 'whole_id')}): ${item} on parts up to `
      + `${(count(row, 'metres') / 1000).toFixed(1)} km apart, ${parts.join(', ')}`;
  },
};

/**
 * How far the check walks a chain down, past any depth a writer makes: a chain
 * to this many places, and a loop of up to this many, whose closing step back
 * to its start is taken at the limit.
 */
const WALK_LIMIT = 32;

/**
 * A whole that is, through its parts, a part of itself, or a chain of wholes
 * and parts longer than four places (#2118, #2126).
 *
 * A curator's word refuses both (`partRecordController.ts`), and curators'
 * words take one key in turn, so two of them cannot close a loop together.
 * The other writers of part records do not ask: the World Heritage run makes
 * a site's component its part (`part_site_components()`) whatever the site is
 * a part of, so a site a curator made a part of a place, whose component the
 * run then finds that place to be, closes a loop; and a merge's record moves
 * join two places' chains. The longest chain on the development catalogue on
 * 2026-11-13 held two places (Zacatecas in the Camino Real de Tierra
 * Adentro). A loop would make every walk up a whole's chain circle, and a
 * visit cascade up it. A curator takes the wrong part out on the card of a
 * place the row names.
 *
 * One row per place a loop starts at, its least id, with the places the
 * shortest such loop goes round (a second loop through the same least place
 * shows once the first is undone);
 * one row per topmost whole of a chain too deep, with its longest chain and
 * how many places that is, counted to `WALK_LIMIT`.
 */
const partsInALoopOrTooDeep: CatalogueAssertion = {
  id: 'parts-in-a-loop-or-too-deep',
  area: 'places',
  title: `A place that is a part of itself, or a chain of more than ${MOST_LEVELS} places`,
  kind: 'invariant',
  meaning:
    'A place cannot be a part of its own part, and wholes nest at most four places deep. '
    + 'A curator takes the wrong part out under Parts on the card of a place named.',
  sql: `WITH RECURSIVE chain AS (
          SELECT ARRAY[prt.whole_id, prt.part_id] AS path, prt.part_id AS last, false AS closes, false AS revisits
            FROM experience_parts prt
          UNION ALL
          SELECT c.path || prt.part_id, prt.part_id, prt.part_id = c.path[1], prt.part_id = ANY(c.path[2:])
            FROM chain c JOIN experience_parts prt ON prt.whole_id = c.last
           WHERE NOT c.closes AND NOT c.revisits
             AND (cardinality(c.path) < ${WALK_LIMIT} OR prt.part_id = c.path[1])
        ), loops AS (
          SELECT DISTINCT ON (c.path[1]) c.path[1] AS whole_id, true AS loop, cardinality(c.path) - 1 AS places, c.path
            FROM chain c
           WHERE c.closes AND c.path[1] = (SELECT min(member) FROM unnest(c.path) AS member)
           ORDER BY c.path[1], cardinality(c.path)
        ), deep AS (
          SELECT DISTINCT ON (c.path[1]) c.path[1] AS whole_id, false AS loop, cardinality(c.path) AS places, c.path
            FROM chain c
           WHERE NOT c.closes AND NOT c.revisits AND cardinality(c.path) > ${MOST_LEVELS}
             AND NOT EXISTS (SELECT 1 FROM experience_parts up WHERE up.part_id = c.path[1])
           ORDER BY c.path[1], cardinality(c.path) DESC
        )
        SELECT found.whole_id, found.loop, found.places,
               ARRAY(SELECT e.name || ' (#' || e.id || ')' FROM unnest(found.path) WITH ORDINALITY AS u(id, n)
                       JOIN experiences e ON e.id = u.id ORDER BY u.n) AS chain
          FROM (SELECT * FROM loops UNION ALL SELECT * FROM deep) found
         ORDER BY found.loop DESC, found.whole_id`,
  describe: (row: AssertionRow) => {
    // Names come from outside; each is read as `text` reads a column.
    const chain = Array.isArray(row.chain) ? (row.chain as unknown[]).map(one => text({ one }, 'one')) : [];
    const places = count(row, 'places');
    let shape = `A loop of ${places} places`;
    if (!row.loop) shape = places >= WALK_LIMIT ? `${WALK_LIMIT} places deep or more` : `${places} places deep`;
    return `${shape}: ${chain.join(' › ')}`;
  },
};

/**
 * A whole whose shape is not the one its parts and records give it (ADR-0210).
 *
 * `whole_shape_follows_parts()` gives a place its shape when it gains its
 * first part and takes it away with its last, so a row here is a writer that
 * went around the trigger: a serial World Heritage site that is not dispersed,
 * a place with no part that keeps a shape, a whole with none. A container is
 * not shaped again as parts come, so one whose parts now lie more than a
 * kilometre apart is listed too: it may be dispersed, and #2125's curator pin
 * is what will settle it. The reverse, a dispersed whole whose parts came
 * within a walk, stays dispersed and is not listed.
 */
const wholeShapeDrift: CatalogueAssertion = {
  id: 'whole-shape-drift',
  area: 'places',
  title: 'A whole whose shape is not the one its parts give it',
  kind: 'invariant',
  meaning:
    'A serial World Heritage site is its parts and has no point of its own, and only a place made of parts has a shape. '
    + 'A row means a writer went around the database\'s rule, so tell the admin who runs it. '
    + 'A container whose parts now lie more than a kilometre apart may be dispersed instead.',
  sql: `SELECT e.id, e.name, e.whole_shape AS shape, expected.shape AS expected
          FROM experiences e
         CROSS JOIN LATERAL (
           SELECT CASE WHEN EXISTS (SELECT 1 FROM experience_parts p WHERE p.whole_id = e.id)
                       THEN whole_shape_of(e.id) END AS shape) expected
         WHERE e.merged_into_id IS NULL
           AND e.whole_shape IS DISTINCT FROM expected.shape
           -- IS NOT TRUE, not NOT: a place made of parts with no shape, or a
           -- dispersed one left with none, is a row too.
           AND (e.whole_shape = 'dispersed' AND expected.shape = 'container') IS NOT TRUE
         ORDER BY e.id`,
  describe: (row: AssertionRow) =>
    `${text(row, 'name')} (#${count(row, 'id')}) is ${text(row, 'shape') || 'not a whole'}, `
    + `and its parts make it ${text(row, 'expected') || 'not a whole'}`,
};

/**
 * A dispersed whole holding a standing point of its own (ADR-0210).
 *
 * Every line of a serial site is a part (`part_site_components()`), and the
 * migration that took the wholes' points away left none standing. A point the
 * run cannot part is one under the site's own reference, the export's site
 * coordinate rather than a line, and stands on the map as a pin of its own.
 */
const wholeOwnPoint: CatalogueAssertion = {
  id: 'whole-own-point',
  area: 'places',
  title: 'A serial site with a point of its own beside its parts',
  kind: 'invariant',
  meaning:
    'A serial site is its parts, so its own point, the coordinate under the site\'s reference, is a pin no part stands for. '
    + 'Where a merge folded another place\'s point into it, undoing that merge settles it. '
    + 'Otherwise tell the admin who runs the World Heritage list.',
  sql: `SELECT e.id, e.name, el.id AS point_id, el.external_ref AS reference
          FROM experiences e
          JOIN experience_locations el ON el.experience_id = e.id AND el.merged_into_id IS NULL
         WHERE e.whole_shape = 'dispersed'
           AND ${offeredLocationSql('el')} AND el.refused_at IS NULL
         ORDER BY e.id, el.id`,
  describe: (row: AssertionRow) => {
    const under = text(row, 'reference') ? ` under ${text(row, 'reference')}` : '';
    return `${text(row, 'name')} (#${count(row, 'id')}) holds point ${count(row, 'point_id')}${under}`;
  },
};

/**
 * A part whose record and line points say different things about its gate
 * (ADR-0213, #2123).
 *
 * A part's gate moves from the points of its list line to its record in its
 * whole. While it moves, the old reading (the points, by the predicates the
 * review queue composes today) and the new one (the record) must agree on
 * each part: shown to a reader, unread, turned down by a curator, withdrawn by
 * the list and still to be judged, or none of these. One label per side, the
 * first that holds in that order. The points go with #2124, and this check
 * with them. A part that holds no line point has no points' reading, and the
 * gate refresh leaves its record as it is (`refresh_part_record_gates()`), so
 * the check skips it: a list line a curator moved to the place it names, when
 * the line's point is the old place's own, placed by its kind too (#2527).
 */
const partGateOutOfStep: CatalogueAssertion = {
  id: 'part-gate-out-of-step',
  area: 'places',
  title: 'A part whose record and points disagree about whether it is shown or asked about',
  kind: 'invariant',
  meaning:
    'Until the points go, a part\'s record in its site follows the points of its list line. '
    + 'A row means it did not, so a curator is asked about a part a reader does not see, or the other way round. '
    + 'Tell the admin who runs the World Heritage list.',
  sql: `SELECT whole.id AS whole_id, whole.name AS whole_name, part.id AS part_id, part.name AS part_name,
               pts.state AS by_points, recd.state AS by_record
          FROM ${MEMBERSHIPS} rec
          JOIN experiences part ON part.id = rec.experience_id AND part.merged_into_id IS NULL
          JOIN experiences whole ON whole.id = rec.whole_id
          CROSS JOIN LATERAL (
            SELECT CASE WHEN bool_or(${offeredLocationSql('el')} AND ${publishedContentSql('el')}) THEN 'shown'
                        WHEN bool_or(${offeredLocationSql('el')} AND ${unreadPointSql('el')}) THEN 'unread'
                        WHEN bool_or(el.refused_at IS NOT NULL) THEN 'turned down'
                        WHEN bool_or(${withdrawnPointOpenSql('el')}) THEN 'withdrawn'
                        ELSE 'hidden' END AS state
              FROM experience_locations el
             WHERE el.experience_id = rec.experience_id AND el.merged_into_id IS NULL
               AND is_part_line_point(el.id, rec.whole_id)) pts
          CROSS JOIN LATERAL (
            SELECT CASE WHEN ${partRecordShownSql('rec', 'part')} THEN 'shown'
                        WHEN ${partRecordUnreadSql('rec')} AND ${hideLostSql('part')} THEN 'unread'
                        WHEN NOT ${membershipAdmittedSql('rec')} THEN 'turned down'
                        WHEN ${partRecordWithdrawnSql('rec')} AND ${hideLostSql('part')} THEN 'withdrawn'
                        ELSE 'hidden' END AS state) recd
         WHERE ${partRecordSql('rec')}
           -- A record whose part holds no line point is not read by its points (#2527);
           -- it goes when #2124 drops the points' reading.
           AND EXISTS (SELECT 1 FROM experience_locations lp
                        WHERE lp.experience_id = rec.experience_id AND lp.merged_into_id IS NULL
                          AND is_part_line_point(lp.id, rec.whole_id))
           AND pts.state <> recd.state
         ORDER BY whole.name, part.id`,
  describe: (row: AssertionRow) => `${text(row, 'whole_name')} (#${count(row, 'whole_id')}): `
    + `${text(row, 'part_name')} (#${count(row, 'part_id')}) is ${text(row, 'by_points')} by its points `
    + `and ${text(row, 'by_record')} by its record`,
};

/**
 * The parts' rules: one line, one part; one item, one place; no loop, four
 * places at most; a whole's shape as its parts give it, no point of a
 * dispersed whole's own, and a part's record gating it as its points do.
 */
export const partAssertions: CatalogueAssertion[] = [
  partsOfOneWholeAtOneSpot,
  itemOnFarParts,
  partsInALoopOrTooDeep,
  wholeShapeDrift,
  wholeOwnPoint,
  partGateOutOfStep,
];
