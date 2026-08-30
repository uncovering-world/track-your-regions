/**
 * The queue lists that are about what an object *holds* rather than about the object.
 *
 * Split out of `reviewQueueController.ts` when the itemised `contents` card took
 * that file past the eight-hundred-line line `docs/tech/development-guide.md`
 * draws (#569). They belong together and away from the rest: they read
 * `experience_locations` rather than `experiences`, they are about a component
 * rather than an object, and between them they carry the only per-row lists the
 * queue returns — so the cap that bounds those lists lives here too.
 *
 * Two of them ask a question — `contents`, unread rows under a visible object, and
 * `withdrawn`, a point the source stopped offering. The third asks nothing:
 * `answeredWithdrawals` is the withdrawn card's own answered half, carried because
 * answering one takes the point off every screen there is (#544).
 *
 * Each takes what the handler already computed for every kind — the scope
 * fragments, their parameters, the page size and this kind's own offset — and
 * returns the rows. Nothing here decides who may see what: the scope fragments are
 * built once, in the handler, from `resolveExperienceScope`'s answer.
 */

import { pool } from '../../db/index.js';
import { CURATOR_SCOPED_REGIONS_CTE } from '../../middleware/auth.js';
import type { QueryResult } from 'pg';
import {
  hidePendingSql, hideRefusedSql, lifecycleSelectSql, offeredLocationSql,
} from './experienceLifecycle.js';
import { objectContextSelectSql, QUEUE_PAGE_SIZE } from './reviewQueueContext.js';
import { recordedLocationSql, recordedTreasureSql } from './partRecord.js';

/**
 * The held fields of an object's parts, as the held card carries them.
 *
 * A run records what moved *inside* an object as `contents.<kind>.changed[]`,
 * each entry naming the part and carrying the same `fields[]` shape the
 * object's own changes use; since ADR-0037 a field of a part readers can see is
 * held like the object's own, and the card shows it as a group under the
 * part's name. This is what feeds that group: one element per part with a held
 * field, carrying the record's name and reference, the held fields alone, and
 * the stored row behind the record — a coordinate and an ordinal for a place,
 * the maker, the year and the picture with its credit for a work — so the card
 * can open the part and say "place 4 of 8" without a second read.
 *
 * Held entries only, twice over: a part is listed only where one of its fields
 * is held, and only those fields are carried. A change the run wrote is news
 * the run report shows, not a question; a field a claim refused is the
 * conflict card's, and answering it here would apply a curator's own value
 * back as though a source had sent it.
 *
 * The row is found through `partRecord.ts`, the rule publishing resolves the
 * same entry by, so the row the card opens is the row publishing writes. Where
 * no stored row answers — a place the source has since withdrawn — the entry
 * stays, with nothing to open: the proposal is still what the run recorded.
 * NULL where no part holds anything, so a card with nothing on this half reads
 * the object's half alone. `ch` is the `experience_sync_changes` alias, `e`
 * the object's.
 */
export function heldPartsSelectSql(changes = 'ch', experience = 'e'): string {
  const location = recordedLocationSql({
    experienceId: `${experience}.id`, ref: "c->'item'->>'ref'", name: "c->'item'->>'name'",
  });
  const treasure = recordedTreasureSql({ experienceId: `${experience}.id`, ref: "c->'item'->>'ref'" });
  return `(SELECT jsonb_agg(part ORDER BY part->>'kind', (part->>'ordinal')::int NULLS LAST, part->'item'->>'name')
             FROM (
               SELECT jsonb_build_object(
                        'kind', k.kind,
                        'item', c -> 'item',
                        'fields', (SELECT jsonb_agg(f) FROM jsonb_array_elements(c -> 'fields') AS f
                                    WHERE (f->>'held')::boolean),
                        'locationId', loc.id, 'latitude', loc.latitude, 'longitude', loc.longitude,
                        'ordinal', loc.ordinal,
                        'treasureId', work.id, 'artist', work.artist, 'year', work.year,
                        'imageUrl', work.image_url, 'imageCredit', work.image_credit,
                        'treasureType', work.treasure_type) AS part
                 FROM (VALUES ('locations'), ('treasures')) AS k(kind)
                 CROSS JOIN LATERAL jsonb_array_elements(
                   COALESCE(${changes}.contents -> k.kind -> 'changed', '[]'::jsonb)) AS c
                 LEFT JOIN LATERAL (${location}) AS loc ON k.kind = 'locations'
                 LEFT JOIN LATERAL (${treasure}) AS work ON k.kind = 'treasures'
                WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(c -> 'fields') AS f
                               WHERE (f->>'held')::boolean)
             ) AS parts) AS proposed_parts`;
}

/**
 * How many unread points or works one `contents` card lists.
 *
 * The count beside the list is always the whole number, so this caps what is
 * shown and never what is said. The page size by construction rather than by
 * coincidence: a card is a page's worth of rows at most, and beyond that the
 * answer a curator needs is the object's, not each row's — the catalogue's
 * largest serial nomination holds 758 points, and a list of 758 is a wall rather
 * than a question.
 */
export const CONTENTS_ROWS_SHOWN = QUEUE_PAGE_SIZE;

/** What every queue query needs and none of them decides for itself. */
export interface QueueQueryContext {
  scopeFilter: string;
  categoryFilter: string;
  params: unknown[];
  pageSize: number;
  offset: number;
}

/**
 * The one query here that names a person, and therefore the one that needs the log's
 * own scope predicate beside the object's.
 *
 * Built in the handler like every other fragment, because it is the same predicate
 * `getCurationLog` and the conflict card use, and three copies of it is how they would
 * come to disagree.
 */
export interface AnsweredQueryContext extends QueueQueryContext {
  logScopeFilter: string;
}

export async function queryContents(
  { scopeFilter, categoryFilter, params, pageSize, offset }: QueueQueryContext,
): Promise<QueryResult> {
  // contents: a visible experience holding unread points or works of its own
  // (ADR-0025 decision 2 — the gate is on the content row, not only on its
  // container). Counted *and* listed: the count is the whole number and the list
  // is its first `CONTENTS_ROWS_SHOWN` rows, because neither alone is a card a
  // curator can answer — a count asks them to approve twelve works they cannot
  // see (#524), and an unbounded list turns a 758-point site into 758 rows.
  //
  // `offeredLocationSql()` alongside `el.curation_state = 'pending'`, and both of
  // its terms carry: a point the source has withdrawn, or one a curator has declared
  // gone from the world, is not "unread" in any sense a reader would ever notice,
  // since every reader-facing location read carries the same fragment — publishing
  // either changes nothing on screen.
  //
  // Treasures need a second table, not a second column on one: a link's own
  // `curation_state` and its treasure's are independent axes (a work is
  // "checked once, globally", a link "as being HERE" — ADR-0025), so
  // `getExperienceTreasures` gates both separately (three predicates, not
  // one) and this count has to ask the same two questions or it would miss a
  // treasure whose link was already reviewed while the work itself was not
  // (a treasure shared across venues is exactly this shape). Both questions sit
  // in the works lateral's own `WHERE`, which is where they can be asked at all:
  // `t.curation_state` is not visible from inside `et`'s JOIN condition.
  //
  // `::int` on both counts: `COUNT(*)` is `bigint`, which `pg` hands to
  // JavaScript as a *string* to keep values above 2^53 exact. No count here can
  // reach that — 758 locations is the catalogue's largest — so the cast costs
  // nothing and stops
  // `"12"` reaching a client. It matters beyond arithmetic, where coercion would
  // cover for it: a plural rule compares against 1, and `'1' === 1` is false, so
  // an uncast count reads "1 points" on the queue page. Every other count in
  // this codebase casts for the same reason (`missingDetection.ts`,
  // `admission.ts`, `experienceRegionQuery.ts`).
  //
  // Two lateral subqueries rather than two joins, and it is the joins' own
  // problem that decides it: `el` and `et` are independent one-to-many on the
  // same experience, so their combined rows are a product — 3 pending points and
  // 12 pending works make 36. `COUNT(DISTINCT ...)` survived that; `jsonb_agg`
  // would not, listing each point twelve times. Aggregated apart, each side also
  // gets to carry its own `LIMIT`, which is what keeps a serial nomination's 93
  // unread components from arriving as 93 rows nobody asked for.
  //
  // The counts stay beside the lists deliberately: they are the *whole* number,
  // and the list is the first `CONTENTS_ROWS_SHOWN` of it. A card saying "12 new
  // works" over a list of 25 of 93 points is telling the truth twice rather than
  // once, and a list without its total is a silent cap.
  return pool.query(`${CURATOR_SCOPED_REGIONS_CTE}
    SELECT e.id, e.external_id, e.name, e.category_id, c.name AS category_name,
           ${lifecycleSelectSql()}, ${objectContextSelectSql()},
           'contents' AS kind,
           points.total AS pending_locations,
           works.total AS pending_treasures,
           points.items AS pending_points,
           works.items AS pending_works,
           NULL::jsonb AS proposed
    FROM experiences e
    JOIN experience_categories c ON c.id = e.category_id
    CROSS JOIN LATERAL (
      SELECT COUNT(*)::int AS total,
             COALESCE(jsonb_agg(jsonb_build_object(
               'id', id,
               'name', name,
               'externalRef', external_ref,
               'latitude', lat,
               'longitude', lon
             ) ORDER BY ordinal) FILTER (WHERE rn <= ${CONTENTS_ROWS_SHOWN}), '[]'::jsonb) AS items
      FROM (
        SELECT el.id, el.name, el.external_ref, el.ordinal,
               ST_Y(el.location) AS lat, ST_X(el.location) AS lon,
               row_number() OVER (ORDER BY el.ordinal) AS rn
        -- The shared fragment rather than the predicate spelled out, because
        -- contentsWaitingSql composes it and the two are written to count the same
        -- rows: spelled out here, this join missed the existence term when the
        -- fragment gained it, so the badge and the card would have disagreed about
        -- an object holding one unread point a curator had declared gone.
        FROM experience_locations el
        WHERE el.experience_id = e.id AND el.curation_state = 'pending'
          AND ${offeredLocationSql('el')}
      ) el
    ) points
    CROSS JOIN LATERAL (
      SELECT COUNT(*)::int AS total,
             COALESCE(jsonb_agg(jsonb_build_object(
               'id', id,
               'name', name,
               'artist', artist,
               'year', year,
               'imageUrl', image_url,
               'iconic', is_iconic
             ) ORDER BY sitelinks_count DESC NULLS LAST, id)
               FILTER (WHERE rn <= ${CONTENTS_ROWS_SHOWN}), '[]'::jsonb) AS items
      FROM (
        -- Both axes, the way every reader-facing treasure read asks them: the link
        -- says the work is here, the work says it is a work, and either being unread
        -- is a question. A work turned down globally leaves every venue at once,
        -- which is why the two are separate columns (ADR-0025).
        SELECT t.id, t.name, t.artist, t.year, t.image_url, t.is_iconic, t.sitelinks_count,
               row_number() OVER (ORDER BY t.sitelinks_count DESC NULLS LAST, t.id) AS rn
        FROM experience_treasures et
        JOIN treasures t ON t.id = et.treasure_id
        WHERE et.experience_id = e.id
          AND (et.curation_state = 'pending' OR t.curation_state = 'pending')
      ) t
    ) works
    WHERE ${hidePendingSql()}            -- an unread experience is an arrival, not this
      AND ${hideRefusedSql()}
      AND (points.total > 0 OR works.total > 0)
      -- Withdrawn rows belong to the 'missing' card, like an arrival and like a
      -- held proposal: the same row under two headings would ask two questions
      -- whose answers contradict each other. "May readers see these twelve
      -- works?" is not answerable while "did this venue disappear?" is open, and
      -- publishing the works would not put them anywhere a reader looks anyway.
      AND e.missing_since IS NULL
      AND ${scopeFilter} ${categoryFilter}
    ORDER BY e.id
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `, [...params, pageSize, offset]);
}

// A point the source stopped offering, waiting on a verdict (ADR-0026, #541).
//
// One row per container listing the points inside it, not one row per point: the
// queue is a list of objects, and a serial site can lose two components in one
// run. The decision stays per point — `POST /locations/:locationId/state` — which
// is the shape the gated `contents` card already has.
//
// The three predicates on `el` are what make the card answerable exactly once.
// `missing_since IS NOT NULL` is the run's observation; the two axes are whether
// anyone has answered it. A verdict deliberately leaves the flag standing, because
// that flag is what keeps the point off every reader-facing read, so without the
// axes here an answered point would come back for ever with its own answer
// recorded on it.
//
// `withdrawal_deferred_for_location_id` says a *different* row is waiting to
// replace this one. Such a withdrawal has not happened yet — the point is still on
// the map with `missing_since IS NULL` — so it cannot reach this query anyway; the
// predicate is here for the row that *is* flagged while an arrival still names it,
// which the writer produces when the source withdraws the replacement in turn. A
// curator asked "did this go?" about a point their readers can still see has no
// true answer available.
export async function queryWithdrawn(
  { scopeFilter, categoryFilter, params, pageSize, offset }: QueueQueryContext,
): Promise<QueryResult> {
  return pool.query(`${CURATOR_SCOPED_REGIONS_CTE}
    SELECT e.id, e.external_id, e.name, e.category_id, c.name AS category_name,
           ${lifecycleSelectSql()}, ${objectContextSelectSql()},
           'withdrawn' AS kind,
           jsonb_agg(jsonb_build_object(
             'id', el.id,
             'name', el.name,
             'externalRef', el.external_ref,
             'missingSince', el.missing_since,
             'latitude', ST_Y(el.location),
             'longitude', ST_X(el.location),
             -- Whether anyone had been there. It is what makes the verdict matter
             -- rather than tidy-up: the visit survives either answer (ADR-0022), and
             -- the point it is attached to stops being shown.
             'visited', EXISTS (SELECT 1 FROM user_visited_locations v WHERE v.location_id = el.id),
             -- How far away the source now offers this same component, or NULL where
             -- it offers it nowhere. Identity is the point together with the
             -- reference, so a coordinate rewritten far enough is a withdrawal plus an
             -- arrival, and this is the difference between "the component is gone" and
             -- "the source moved it". Since ADR-0027 "far enough" is ten metres: a
             -- rewrite inside that is absorbed by the writer and raises no card at all.
             -- So a distance up to ten metres reaching here is not a contradiction, and it
             -- is worth knowing which of three ways it got in rather than assuming one.
             -- Migration 026 left the pair standing, on either of its carve-outs: a visit
             -- on the marked row, or a region assignment on it -- the second needing no
             -- visit anywhere near it, because placement only ever deletes auto rows, so a
             -- curator's manual assignment outlives the withdrawal. Or the database has
             -- not had 026 applied, nothing recording which migrations it has seen. Or,
             -- **on an ungated source only**, the pairing was greedy and this row lost it:
             -- ADR-0027 decision 5a-i, where the loser is marked while a row is inserted
             -- for the ordinal it lost, both within ten metres of one incoming point by
             -- construction and sharing the reference this subquery joins on. Ungated
             -- only because the deferral is what decides it -- see the note further down.
             --
             -- Or the deferral ran short: two points of one reference dropped against a
             -- single unread arrival, one held and the other marked at once. That one has
             -- nothing to do with the tolerance and predates it; what the tolerance
             -- changed is that its distance can land in the band the card reads as a
             -- rewrite. The subquery below stops measuring against the held row, so this
             -- route no longer reaches the card as a short distance -- and it is left
             -- named rather than deleted, because that is the route a reader will
             -- otherwise re-derive from the note further down. Up to ten, not under one: the card that
             -- reads this splits at the same number the writer uses.
             --
             -- A distance rather than a flag, because the flag was not enough to
             -- decide with: Bilbao's replacement is **1.2 cm** away — the stored
             -- latitude had been rounded to six decimals and a later run wrote the
             -- source's full value — and a card showing two coordinates rounded to
             -- four decimals showed the same numbers twice. The number is what tells
             -- a rewritten coordinate from a component that really moved.
             --
             -- Nearest, because nine (experience_id, external_ref) pairs cover two
             -- points: with two candidates the question is what replaced *this* one.
             'replacedMetres', (
               SELECT round(MIN(ST_Distance(el.location::geography, moved.location::geography))::numeric, 2)
               FROM experience_locations moved
               WHERE moved.experience_id = e.id
                 -- The same fragment, and worth stating what it does *not* carry: it is
                 -- missing_since IS NULL AND existence <> 'lost', with no curation_state
                 -- term, so a pending arrival counts as a replacement
                 -- here. That is right for the question the distance answers -- whether
                 -- the source still lists this part, and where -- and it is why the card's
                 -- sentences about what readers see are true of every pair reachable
                 -- today rather than of every pair in principle. A gated arrival is
                 -- invisible, and a row can be marked beside one whenever the deferral
                 -- runs short: two rows withdrawn under one reference against a single
                 -- arrival, where the pairing by position gives the slot to one and the
                 -- other is marked at once. That is the documented min(withdrawals,
                 -- arrivals) behaviour and older than the tolerance; what changed is that
                 -- the distance can now land in the band the card reads as a rewrite.
                 --
                 -- Not the greedy pairing's loser, and here the gate is what decides it,
                 -- which is why route 3 above says "ungated only". Under a gate the insert
                 -- lands pending, so the deferral statement runs, the loser satisfies its
                 -- withdrawn set, the row inserted for the ordinal it lost shares its
                 -- reference and pairs with it, and the mark passes it over: held, never
                 -- marked, never on this card. Ungated, every insert is auto, the deferral
                 -- statement is skipped for want of an unread arrival, and the mark marks
                 -- the loser at once -- with a *visible* replacement metres away, which is
                 -- the case route 3 names (ADR-0027 decision 5a-i).
                 AND ${offeredLocationSql('moved')}
                 -- And not a row whose own withdrawal is merely waiting its turn. A
                 -- deferral holds one departure per unread arrival, so where a run drops
                 -- two points of one reference and offers a single arrival, the second
                 -- stays visible with an arrival pointing at it -- offered by this
                 -- predicate, metres away, and about to go. Measured as a replacement it
                 -- makes the card say "the source still lists this part, 5 m from here,
                 -- readers never lost it" about a part the source stopped listing and a
                 -- pin that is leaving. It is the same departure paused, not a
                 -- replacement.
                 AND NOT EXISTS (
                   SELECT 1 FROM experience_locations pausing
                   WHERE pausing.experience_id = e.id
                     AND pausing.withdrawal_deferred_for_location_id = moved.id
                 )
                 AND moved.external_ref IS NOT DISTINCT FROM el.external_ref
             )
           ) ORDER BY el.missing_since DESC, el.id) AS withdrawn_points,
           NULL::jsonb AS proposed
    FROM experiences e
    JOIN experience_categories c ON c.id = e.category_id
    JOIN experience_locations el
      ON el.experience_id = e.id
     AND el.missing_since IS NOT NULL
     AND el.source_membership = 'present'
     AND el.existence = 'extant'
     AND el.withdrawal_deferred_for_location_id IS NULL
     -- A point nobody ever saw raises no question about its departure, the same
     -- reasoning ADR-0025 section 3.6 applies to an unread object: the card asks
     -- whether a place readers could see has gone, and about an arrival the gate
     -- never released there is no such fact. Reachable — a gated source can offer a
     -- point and withdraw it before anyone publishes it, and the mark statement
     -- treats it like any other stored row.
     AND el.curation_state <> 'pending'
    WHERE ${hidePendingSql()}
      AND ${hideRefusedSql()}
      -- The object's own disappearance is the missing kind's question, and that one
      -- comes first: what a component of a vanished site did is not answerable while
      -- the site itself is unaccounted for.
      AND e.missing_since IS NULL
      AND ${scopeFilter} ${categoryFilter}
    GROUP BY e.id, e.external_id, e.name, e.category_id, c.name
    ORDER BY e.id
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `, [...params, pageSize, offset]);
}

/**
 * The actions a verdict on a point writes, which is what the log has to be asked for.
 *
 * All four, not only the two that hide a point: the question this list answers is *who
 * last decided*, and taking one axis back is as much a decision as setting it — a curator
 * who undid a `lost` while a `former` still stands is the person the next reader of the
 * card should be shown. Kept beside the query that reads them rather than imported from
 * the writer, because `locationStateController.ts` names them one branch at a time and
 * there is no list there to import.
 */
const POINT_VERDICT_ACTIONS = [
  'location_marked_former', 'location_marked_lost',
  'location_state_restored', 'location_missing_dismissed',
];

/**
 * The points a curator has answered, and which no reader can see — the only surface
 * they appear on at all (#544).
 *
 * The mirror of `keptOut` one level down, and it exists for the same reason that list
 * does. Answering a withdrawal is what removes the row from `queryWithdrawn`: that query
 * asks about a flagged point whose two axes are still clean, so a verdict on either axis
 * takes it out — by design, or a card would come back with its own answer written on it.
 * Nothing then showed it. A point is not reachable at its own address, and every
 * reader-facing read carries `offeredLocationSql`, so an answered-and-hidden point was
 * on no screen in the product and the verdict could not be taken back from it.
 *
 * **Two predicates, and both halves matter.** A verdict *stands* — `former` or `lost` —
 * and no reader can see the point.
 *
 * The first is what there is to take back, and it is also what makes this row not a
 * waiting one: `queryWithdrawn` asks about a flagged point whose two axes are still
 * clean, so the two sets are disjoint by construction rather than by a guard either one
 * carries. It is asked of the axes rather than of `state_decided_at`, though that column
 * has a single writer and would answer nearly the same question, because the axes are
 * *themselves* the record of a person: no arm of `locationWriter` ever writes `former` or
 * `lost` — the schema comments on both columns say "set by a curator only", and ADR-0026
 * decision 6 has the restore move toward `present` and never away. A row carrying a
 * verdict and no timestamp would be a bug, and hiding it from the only screen that can
 * undo it is the wrong way to answer one.
 *
 * The second is what makes this list the only way back rather than a second copy of the
 * map, and it earns its place on one state: `{former, extant, flag NULL}`, which is
 * visible, because membership is in no reader-facing read. A point in it is on the map at
 * its own address, where its standing claim can be read, so listing it here would put a
 * reachable point in a list whose whole premise is that nothing else reaches it.
 *
 * **No run produces that state**, and it is worth saying which does, since a wrong example
 * here is what the next reader would build the next criterion from. Every arm of
 * `locationWriter` that clears the flag restores membership in the same statement — the
 * `returned` arm writes `missing_since = NULL` and `source_membership = 'present'`
 * together, and its own note says why (a row returning visible while recorded as delisted
 * could never be asked about again). What reaches it is a *person*: `POST
 * /locations/:locationId/state` accepts `former` on a row whose flag is already clear, and
 * leaves it clear, because only an answer with both axes clean clears anything. No card in
 * the product sends that — the open card asks about flagged points and this one sends
 * take-backs — so it is the documented endpoint's other clients, the audience
 * `locationStateController.ts` names for its own unreachable-from-a-card branch.
 *
 * The pair also decides what one card can offer. Each standing verdict is taken back on
 * its own, and the point returns to readers only where both axes come clear — which is
 * `offeredLocationSql` read forward rather than a rule this list invents.
 *
 * **No object-level lifecycle guards, unlike every kind above.** `hidePendingSql`,
 * `hideRefusedSql` and `e.missing_since IS NULL` are on the queue's questions so that one
 * row never raises two cards whose answers contradict each other. This asks nothing, so
 * there is nothing to contradict — and each of those guards hides the *object* from
 * readers, which makes the point inside it more unreachable rather than less. Scope is
 * the one filter that stays, because it is about who may look rather than about what is
 * being asked.
 *
 * **`replacedMetres` is deliberately absent**, though `queryWithdrawn` carries it: that
 * field exists to tell a rewritten coordinate from a component that really moved, which
 * is the open question. This card is not re-asking it — it says what was answered and
 * offers the way back — so paying for a nearest-neighbour distance per point would buy
 * a sentence nobody is deciding from.
 *
 * **Capped like `contents` and unlike `withdrawn`**, and the difference between those two
 * is why. A withdrawal card drains: a run raises it, a curator answers it, the row leaves.
 * This one only ever *grows* — a point enters when it is answered and leaves only if the
 * verdict is taken back — so on the catalogue's largest serial nomination, 758 points, a
 * curator working through components over months would accumulate the answered ones into
 * a single card, each row carrying its own state and its own map. The cap is
 * `CONTENTS_ROWS_SHOWN` with the whole number beside it, which is the module's own rule:
 * a list without its total is a silent cap.
 */
export async function queryAnsweredWithdrawals(
  { scopeFilter, categoryFilter, logScopeFilter, params, pageSize, offset }: AnsweredQueryContext,
): Promise<QueryResult> {
  return pool.query(`${CURATOR_SCOPED_REGIONS_CTE}
    SELECT e.id, e.external_id, e.name, e.category_id, c.name AS category_name,
           ${lifecycleSelectSql()}, ${objectContextSelectSql()},
           'withdrawn-answered' AS kind,
           answered.total AS answered_points_total,
           answered.items AS answered_points,
           NULL::jsonb AS proposed
    FROM experiences e
    JOIN experience_categories c ON c.id = e.category_id
    -- A lateral rather than a join and a GROUP BY, for the cap: the rows have to be
    -- numbered before they are aggregated, or the list cannot be cut without cutting
    -- the count with it. queryContents above has the same shape for the same reason.
    CROSS JOIN LATERAL (
      SELECT COUNT(*)::int AS total,
             -- Newest answer first, which is the opposite of the queue's own ordering
             -- and for the opposite reason: this list is not walked down. Someone comes
             -- to it having just noticed a mis-click, and the row they want is the last
             -- one they touched — which is also what makes the cap take the right rows.
             MAX(decided_at) AS newest,
             COALESCE(jsonb_agg(jsonb_build_object(
               'id', id,
               'name', name,
               'externalRef', external_ref,
               'missingSince', missing_since,
               'latitude', lat,
               'longitude', lon,
               -- Both axes, because the card offers a way back from each one separately
               -- and the point returns to readers only where both come clear. They are
               -- also what the endpoint's own expected block is built from, so a card
               -- drawn before someone else answered collides rather than overwrites.
               'sourceMembership', source_membership,
               'existence', existence,
               'decidedAt', decided_at,
               'note', note,
               'decidedBy', decided_by,
               'visited', visited
             ) ORDER BY decided_at DESC NULLS LAST, id)
               FILTER (WHERE rn <= ${CONTENTS_ROWS_SHOWN}), '[]'::jsonb) AS items
      FROM (
        SELECT el.id, el.name, el.external_ref, el.missing_since,
               ST_Y(el.location) AS lat, ST_X(el.location) AS lon,
               el.source_membership, el.existence,
               el.state_decided_at AS decided_at, el.state_note AS note,
               -- Who answered, read from the log rather than from
               -- el.state_decided_by, and the difference is the scope. A curation act
               -- belongs to the region it was made in, and the log endpoint drops an act
               -- made by a curator of region B for a reader scoped only to A; the column
               -- carries no region and would name them anyway. The conflict card takes
               -- the same care with the same predicate, for the same reason.
               --
               -- NULL where the act is out of this reader's scope, or predates the log:
               -- the card says "a curator" then, because someone still decided.
               --
               -- **The scope test is in the select list, not in the WHERE**, and the
               -- difference is which act gets named. In the WHERE it picks the newest
               -- act this reader may see; here it picks the newest act, then decides
               -- whether it can be named. Those differ exactly when the newest act is
               -- out of scope and an older one is not — and the row's own columns are
               -- not scoped at all, so the WHERE form composed a sentence no single act
               -- performed: curator A of R1 marks a point former, curator B of R2 marks
               -- it lost with a note, and a reader scoped to R1 is shown B's timestamp
               -- and B's words under A's name. Worse than no name, because it is a
               -- claim rather than a gap. The conflict card takes its by and at off the
               -- same log row and so cannot have this; here two of the three fields
               -- come from experience_locations.
               (SELECT CASE WHEN ${logScopeFilter} THEN u.display_name END
                  FROM experience_curation_log log
                  JOIN users u ON u.id = log.curator_id
                 WHERE log.experience_id = e.id
                   AND log.action = ANY($${params.length + 1}::text[])
                   -- Compared as text rather than cast to int: the audit row is written
                   -- by hand as JSON, and a cast is a statement-level error on any row
                   -- whose value is not a number, where a comparison is simply false.
                   AND log.details->>'locationId' = el.id::text
                 ORDER BY log.created_at DESC, log.id DESC
                 LIMIT 1) AS decided_by,
               -- Whether anyone had been there, as the open card carries it: the visit
               -- survives either answer (ADR-0022) and it is the weight of the decision
               -- being taken back.
               EXISTS (SELECT 1 FROM user_visited_locations v
                        WHERE v.location_id = el.id) AS visited,
               row_number() OVER (
                 ORDER BY el.state_decided_at DESC NULLS LAST, el.id) AS rn
        FROM experience_locations el
        WHERE el.experience_id = e.id
          AND (el.source_membership = 'former' OR el.existence = 'lost')
          AND NOT (${offeredLocationSql('el')})
      ) el
    ) answered
    WHERE answered.total > 0
      AND ${scopeFilter} ${categoryFilter}
    ORDER BY answered.newest DESC NULLS LAST, e.id
    LIMIT $${params.length + 2} OFFSET $${params.length + 3}
  `, [...params, POINT_VERDICT_ACTIONS, pageSize, offset]);
}
