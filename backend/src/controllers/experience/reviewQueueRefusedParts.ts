/**
 * The parts a curator turned down, listed back to them (#859).
 *
 * The third of the review page's answered lists, and the last one ADR-0053 owed.
 * A refused point or work link is invisible everywhere else by design — readers
 * hid it before the refusal and the queue stopped asking about it after — so
 * without this statement a mis-click on *Turn them down* can be found only in
 * the curation log, and cannot be undone at all. It sits beside *what you have
 * kept out* and *the lost places you have answered* for the same reason both of
 * those exist: an answer with nowhere to be seen is an answer with no way back.
 *
 * Shaped like `queryAnsweredWithdrawals` next door, because it answers the same
 * question about a different mark: one row per object, two laterals that number
 * their rows before aggregating so the list can be capped without cutting the
 * count, newest answer first because whoever opens this list has just noticed a
 * mis-click and wants the row they last touched.
 *
 * **Who turned it down is read by timestamp.** The refusal writes `refused_at =
 * NOW()` and its `contents_refused` log row inside one transaction, and `now()`
 * is one value for a whole transaction, so the mark and the log row carry the
 * same instant and `log.created_at = el.refused_at` names the act. The obvious
 * alternative — matching the ids the log row carries — fails for exactly the
 * case that matters: the batch answer calls the refusal writer with no ids named
 * (`reviewAnswerDispatch.ts`), which is how a run of a thousand arrivals gets
 * answered, so its log row lists none. The name is scoped in the select list
 * rather than in the WHERE, for the reason the answered-withdrawals query spells
 * out at length: in the WHERE it would pick the newest act *this reader may
 * see*, and compose a sentence naming one curator over another curator's words.
 */

import { pool } from '../../db/index.js';
import { CURATOR_SCOPED_REGIONS_CTE } from '../../middleware/auth.js';
import type { QueryResult } from 'pg';
import { lifecycleSelectSql } from './experienceLifecycle.js';
import { objectContextSelectSql } from './reviewQueueContext.js';
import { contentsAnswerableSql } from './waitingCounts.js';
import { MEMBERSHIPS, membershipToAnswerSql } from '../../db/membership.js';
import { type AnsweredQueryContext, CONTENTS_ROWS_SHOWN } from './reviewQueueContents.js';

/**
 * The one act that marks a part refused, for the log join above.
 *
 * An array of one, and deliberately an array: `queryAnsweredWithdrawals` reads
 * its author out of four possible verdicts through `= ANY($n::text[])`, and the
 * two statements are read side by side. A second act that sets `refused_at`
 * would join this list rather than change the shape around it.
 */
const PART_REFUSAL_ACTIONS = ['contents_refused'];

export async function queryRefusedParts(
  {
    scopeFilter, categoryFilter, nameFilter, logScopeFilter, params, pageSize, offset,
  }: AnsweredQueryContext,
): Promise<QueryResult> {
  // Who turned the part down and what they wrote, read off the log row the
  // refusal wrote in the same transaction as the mark. Repeated per lateral
  // rather than joined once, because the two marks are on two tables and the
  // scope test has to stay in the select list on both.
  const decidedBy = (mark: string) => `
    (SELECT CASE WHEN ${logScopeFilter} THEN u.display_name END
       FROM experience_curation_log log
       JOIN users u ON u.id = log.curator_id
      WHERE log.experience_id = e.id
        AND log.action = ANY($${params.length + 1}::text[])
        AND log.created_at = ${mark}
      ORDER BY log.id DESC
      LIMIT 1)`;
  // Scoped exactly as the name above is, and it is not the neighbour's shape:
  // an answered withdrawal reads its note from `experience_locations.state_note`,
  // a column on the row this reader may already see, while this one reads the
  // *act* — a log row that carries the region it was made in. A curator scoped to
  // one region would otherwise be shown what a curator of another wrote. NULL
  // where it is out of reach, which the card already renders as no note at all.
  const noteOf = (mark: string) => `
    (SELECT CASE WHEN ${logScopeFilter} THEN log.details->>'note' END
       FROM experience_curation_log log
      WHERE log.experience_id = e.id
        AND log.action = ANY($${params.length + 1}::text[])
        AND log.created_at = ${mark}
      ORDER BY log.id DESC
      LIMIT 1)`;

  return pool.query(`${CURATOR_SCOPED_REGIONS_CTE},
    -- The objects that hold a turned-down part at all, named before anything else
    -- runs. Two laterals in the FROM clause are evaluated for every row that
    -- reaches them, so without this the statement aggregates nothing 2749 times on
    -- every read of the review page, whether or not a curator opens the list —
    -- measured at ~100 ms against the 19 ms of the one-lateral list beside it, on a
    -- catalogue holding no refused part at all. Restating the laterals as EXISTS in
    -- the WHERE does not help, and was measured making it worse: a CROSS JOIN
    -- LATERAL has already run by the time a WHERE term is applied. MATERIALIZED is
    -- what keeps the planner from folding this back into that shape.
    --
    -- Both branches are index-only probes of the two partial indexes migration 052
    -- adds, so the gate costs about nothing on the catalogue where the answer is
    -- "none of them", which is every catalogue until a curator turns something down.
    refused_part_holders AS MATERIALIZED (
      SELECT el.experience_id AS id
        FROM experience_locations el
       WHERE el.refused_at IS NOT NULL
       UNION
      SELECT et.experience_id
        FROM experience_treasures et
       WHERE et.refused_at IS NOT NULL
    )
    SELECT e.id, e.external_id, e.name, e.category_id, c.name AS category_name,
           ${lifecycleSelectSql()}, ${objectContextSelectSql()},
           'contents-refused' AS kind,
           -- Whether the take-back will be accepted at all, decided by the
           -- writer's own fragment rather than by a second spelling of it: a card
           -- offering a button that 409s is a dead end with nothing on it to act
           -- on. The two columns beside it choose the sentence, never the verdict.
           (${contentsAnswerableSql('e', 'answerable_m')}) AS takeable,
           answerable_m.admission AS object_admission,
           answerable_m.curation_state AS object_curation_state,
           points.total AS refused_points_total,
           points.items AS refused_points,
           works.total AS refused_works_total,
           works.items AS refused_works,
           NULL::jsonb AS proposed
    FROM refused_part_holders h
    JOIN experiences e ON e.id = h.id
    JOIN experience_categories c ON c.id = e.category_id
    -- The membership the take-back answers through, joined the way the writer
    -- reads it, so the two ask about the same row.
    LEFT JOIN ${MEMBERSHIPS} answerable_m
      ON answerable_m.id = ${membershipToAnswerSql('e.id', 'waiting')}
    CROSS JOIN LATERAL (
      SELECT COUNT(*)::int AS total, MAX(refused_at) AS newest,
             COALESCE(jsonb_agg(jsonb_build_object(
               'id', id,
               'name', name,
               'externalRef', external_ref,
               'latitude', lat,
               'longitude', lon,
               'curatedFields', curated_fields,
               'refusedAt', refused_at,
               'refusedBy', refused_by,
               'note', note,
               -- Whether the source still lists it. A point can be turned down
               -- and withdrawn afterwards, and taking it back then restores the
               -- question without restoring the offer -- the card says so rather
               -- than letting the row read as one the next run will propose.
               'missingSince', missing_since,
               -- Whether anyone had been there. A visit survives a refusal
               -- (ADR-0022) and it is the weight of the decision being taken back.
               'visited', visited
             ) ORDER BY refused_at DESC NULLS LAST, id)
               FILTER (WHERE rn <= ${CONTENTS_ROWS_SHOWN}), '[]'::jsonb) AS items
      FROM (
        SELECT el.id, el.name, el.external_ref, el.curated_fields, el.refused_at,
               el.missing_since,
               ST_Y(el.location) AS lat, ST_X(el.location) AS lon,
               ${decidedBy('el.refused_at')} AS refused_by,
               ${noteOf('el.refused_at')} AS note,
               EXISTS (SELECT 1 FROM user_visited_locations v
                        WHERE v.location_id = el.id) AS visited,
               row_number() OVER (ORDER BY el.refused_at DESC NULLS LAST, el.id) AS rn
        -- The mark alone. A refused point is always pending -- the refusal
        -- reaches only what unreadPointSql reaches -- and the withdrawn card
        -- asks for curation_state <> 'pending', so a refused point the source
        -- then stops offering raises no card of its own. An offered term here
        -- would leave it on no screen at all, with the answer that put it there
        -- permanently unanswerable. Its row says the source dropped it instead.
        FROM experience_locations el
        WHERE el.experience_id = e.id
          AND el.refused_at IS NOT NULL
      ) el
    ) points
    CROSS JOIN LATERAL (
      SELECT COUNT(*)::int AS total, MAX(refused_at) AS newest,
             COALESCE(jsonb_agg(jsonb_build_object(
               -- The treasure's id, not the link's: it is what a curator sees a
               -- work named by everywhere else, and what the take-back takes.
               'id', id,
               'name', name,
               'artists', artists,
               'artistsCurated', artists_curated,
               'year', year,
               'curatedFields', curated_fields,
               'externalId', external_id,
               'refusedAt', refused_at,
               'refusedBy', refused_by,
               'note', note,
               -- The link's own withdrawal, for the reason the points carry it.
               'missingSince', missing_since
             ) ORDER BY refused_at DESC NULLS LAST, sitelinks_count DESC NULLS LAST, id)
               FILTER (WHERE rn <= ${CONTENTS_ROWS_SHOWN}), '[]'::jsonb) AS items
      FROM (
        -- What the card renders and nothing more. The contents card selects the
        -- picture, its credit, the type and the venue count because its rows open
        -- the work-correction dialog; this list offers one answer -- ask again --
        -- and a correction belongs on the contents card the work returns to. The
        -- venue count in particular is a correlated COUNT(*) per link, paid for
        -- every row including the ones the cap then discards.
        SELECT t.id, t.name, t.artists, t.curated_fields ? 'artists' AS artists_curated,
               t.year, t.sitelinks_count, t.external_id, t.curated_fields,
               et.refused_at, et.missing_since,
               ${decidedBy('et.refused_at')} AS refused_by,
               ${noteOf('et.refused_at')} AS note,
               row_number() OVER (
                 ORDER BY et.refused_at DESC NULLS LAST, t.sitelinks_count DESC NULLS LAST, t.id) AS rn
        FROM experience_treasures et
        JOIN treasures t ON t.id = et.treasure_id
        WHERE et.experience_id = e.id
          AND et.refused_at IS NOT NULL
      ) t
    ) works
    WHERE (points.total > 0 OR works.total > 0)
      AND ${scopeFilter} ${categoryFilter} ${nameFilter}
    -- Newest of either kind, so an object whose works were turned down last week
    -- and whose point was turned down a minute ago is where the eye goes first.
    ORDER BY GREATEST(
      COALESCE(points.newest, works.newest), COALESCE(works.newest, points.newest)
    ) DESC NULLS LAST, e.id
    LIMIT $${params.length + 2} OFFSET $${params.length + 3}
  `, [...params, PART_REFUSAL_ACTIONS, pageSize, offset]);
}
