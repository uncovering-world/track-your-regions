/**
 * The one read among the curator's lifecycle endpoints: everything waiting for a
 * decision, in one page.
 *
 * Split from `lifecycleController.ts` (#526), which holds the writes. They share
 * the table and nothing else: this has no transaction and no row lock, its
 * subject is which rows a curator may be *asked* about, and it is the half that
 * keeps growing — Stage 2 rebuilds it and Stage 3 adds counts to it. The moved
 * text is unchanged; the split is a move.
 */

import { Response } from 'express';
import { pool } from '../../db/index.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { CURATOR_SCOPED_REGIONS_CTE, curatorUnrestrictedScopeExists } from '../../middleware/auth.js';
import { hidePendingSql, hideRefusedSql, lifecycleSelectSql } from './experienceLifecycle.js';
import { CURATED_KEY_BY_FIELD } from '../../services/sync/changeSet.js';
import { CHANGESET_LANDED_SQL } from '../../services/sync/syncLogMarkers.js';
import { ACCEPTABLE_FIELDS } from './acceptableFields.js';

/** How many items a queue page holds by default. */
const QUEUE_PAGE_SIZE = 25;

/**
 * The decisions waiting for a curator, scoped to what they cover.
 * GET /api/experiences/review/queue?categoryId=&limit=&offset=
 *
 * Six kinds of open question, and one list that is not a question at all:
 *
 * - **gone from the source** — a run stamped `missing_since` and stopped there.
 *   Users still see the object exactly as before; nothing about it changes
 *   until someone says whether it was delisted, destroyed, or never gone.
 * - **the source disagrees with an edit** — `curated_fields` refused a change
 *   and the divergence has been accumulating since. The value the source
 *   proposed is carried in the changeset, so it can still be applied.
 * - **this category turned it down** — a rule refused the row and it is already
 *   hidden (ADR-0024). The one kind of item here that a run has *already* acted
 *   on, and the exception to the page's usual promise that nothing has changed
 *   what visitors see. It sits apart from the first kind because none of those
 *   three verdicts is true of it: the British Museum is open, so not `lost`; it
 *   was never a legitimate member of *Top Art Museums*, so not `former`; and the
 *   refusal was right, so not a false alarm. Its two answers are its own.
 * - **arrived from a gated source, and nobody has looked** — `curation_state =
 *   'pending'` (ADR-0025). Readers see nothing at this address; a curator sees
 *   the whole object, because the queue is the only place there is anything
 *   to look at yet.
 * - **a visible row is holding a newer proposal** — a gated source proposed a
 *   change to a row that was already published, and the upsert kept the
 *   stored content rather than overwrite what a reader can already see.
 *   `pending_change_sync_log_id` names the run whose proposal is waiting. This
 *   is distinct from `conflicts`: a `curated_fields` claim is answered through
 *   `accept-source`, while a gate-held field is answered through
 *   `POST /:id/publish`, which is what clears this pointer in response to a
 *   person. A later run proposing nothing clears it too, on its own.
 * - **a visible row is holding unread contents** — its points or its works
 *   arrived `pending` while the experience itself was already published.
 *   Counted, not listed: the expandable detail is a separate read.
 *
 * `keptOut` is the exception to all of it: those rows are answered, not
 * waiting, and are carried here only because nowhere else can show them.
 */
export async function getReviewQueue(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  const isAdmin = req.user!.role === 'admin';
  const { categoryId, limit = QUEUE_PAGE_SIZE, offset = 0 } = req.query as {
    categoryId?: number; limit?: number; offset?: number;
  };

  // The rows span categories, so the unrestricted check correlates on each
  // row's own category rather than on the optional request filter.
  const scopeFilter = isAdmin
    ? 'TRUE'
    : `(${curatorUnrestrictedScopeExists('e.category_id')} OR EXISTS (
         SELECT 1 FROM experience_regions er
         JOIN curator_scoped_regions s ON s.id = er.region_id
         WHERE er.experience_id = e.id
       ))`;

  // Only bind what the SQL references. A placeholder that appears in the
  // parameter list but in no expression has no inferable type, and Postgres
  // refuses the whole statement with "could not determine data type".
  const params: unknown[] = [userId];
  let categoryFilter = '';
  if (categoryId) {
    params.push(categoryId);
    categoryFilter = `AND e.category_id = $${params.length}`;
  }

  // A refused row is excluded here even when it also carries `missing_since`.
  // The same row under two headings would ask two contradictory questions —
  // "did this disappear?" beside "was refusing it right?" — and only the second
  // has a true answer.
  //
  // A `pending` row is excluded too (ADR-0025 § 3.6): no reader has ever seen
  // it, so there is no verdict to give about whether it disappeared from in
  // front of anyone. It stays out of `arrivals` as well, guarded there by
  // `missing_since IS NULL` — the two predicates are what makes such a row
  // raise no card in either kind rather than a wrong one in either.
  const missing = await pool.query(`${CURATOR_SCOPED_REGIONS_CTE}
    SELECT e.id, e.external_id, e.name, e.category_id, c.name AS category_name,
           ${lifecycleSelectSql()},
           'missing' AS kind, NULL::jsonb AS proposed
    FROM experiences e
    JOIN experience_categories c ON c.id = e.category_id
    WHERE e.missing_since IS NOT NULL
      AND e.source_membership = 'present'
      AND ${hideRefusedSql()}
      AND ${hidePendingSql()}
      ${categoryFilter}
      AND ${scopeFilter}
    ORDER BY e.missing_since DESC, e.id
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `, [...params, limit, offset]);

  // Ordered by id rather than by time: admission carries no date of its own,
  // and `updated_at` moves for every unrelated edit, so ordering by it would
  // shuffle the queue under a curator working through it. Stable beats fresh
  // here — the page is a list someone is walking down.
  //
  // An answered row is gone from this query, because both answers pin
  // `admission` in `curated_fields`. That pin is also what stops a later run
  // reversing either answer.
  const refused = await pool.query(`${CURATOR_SCOPED_REGIONS_CTE}
    SELECT e.id, e.external_id, e.name, e.category_id, c.name AS category_name,
           e.admission_reason,
           ${lifecycleSelectSql()},
           'refused' AS kind, NULL::jsonb AS proposed
    FROM experiences e
    JOIN experience_categories c ON c.id = e.category_id
    WHERE e.admission = 'refused'
      AND NOT COALESCE(e.curated_fields ? 'admission', false)
      ${categoryFilter}
      AND ${scopeFilter}
    ORDER BY e.id
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `, [...params, limit, offset]);

  // The rows a curator confirmed, and the only place they can be seen.
  //
  // Every other verdict is taken back where the object is: `former` never
  // hides it, and `lost` has a reader toggle that reveals it. A confirmed
  // refusal has neither — `hideRefusedSql` is on every read and rides on no
  // toggle, so the row answers 404 by id and appears in no list. Without this
  // query one mis-click would put an object out of the product for good, which
  // is the shape `setExperienceState` (`lifecycleController.ts`) reasoned
  // itself out of, and the one "Take a verdict back" promises against.
  //
  // Deliberately not "open questions": these are answered, and the queue is a
  // list of things waiting. They are returned separately so the page can keep
  // them out of the way of the work.
  //
  // Newest answer first, which is the opposite of the ordering directly above
  // and for the opposite reason. That list is walked down, so it must not
  // reshuffle under the curator. This one is not walked at all — someone comes
  // to it looking for a row they answered a moment ago, having noticed the
  // mis-click, and the row they want is the last one they touched.
  const keptOut = await pool.query(`${CURATOR_SCOPED_REGIONS_CTE}
    SELECT e.id, e.external_id, e.name, e.category_id, c.name AS category_name,
           e.admission_reason, e.state_decided_at, e.state_note,
           ${lifecycleSelectSql()},
           'kept-out' AS kind, NULL::jsonb AS proposed
    FROM experiences e
    JOIN experience_categories c ON c.id = e.category_id
    WHERE e.admission = 'refused'
      AND COALESCE(e.curated_fields ? 'admission', false)
      ${categoryFilter}
      AND ${scopeFilter}
    ORDER BY e.state_decided_at DESC NULLS LAST, e.id
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `, [...params, limit, offset]);

  // A conflict is worth answering only while it is still the source's current
  // position, so the newest changeset row for the experience wins — and only
  // while the curator still claims the field. Accepting the source releases
  // that claim, which is what takes the item out of the queue: the changeset
  // row stays as a record of what the run did, so nothing else would.
  //
  // The claim key is usually the column name, but not always: editing only a
  // website claims `metadata.website`, which is no column at all. Hence the
  // map, and hence the fallback to the field's own name for the keys it does
  // not carry. Each field also says whether `accept-source` can write it —
  // `location` and the rest are shown but not offered, since a button that
  // 409s would leave the item unanswerable.
  const keyMapIdx = params.length + 1;
  const acceptableIdx = keyMapIdx + 1;
  const conflicts = await pool.query(`${CURATOR_SCOPED_REGIONS_CTE}
    SELECT * FROM (
      SELECT DISTINCT ON (e.id)
             e.id, e.external_id, e.name, e.category_id, c.name AS category_name,
             ${lifecycleSelectSql()},
             'conflict' AS kind, ch.sync_log_id,
             (SELECT jsonb_agg(f || jsonb_build_object(
                       'acceptable', $${acceptableIdx}::jsonb ? (f->>'field')))
               FROM jsonb_array_elements(ch.changed_fields) f
               WHERE (f->>'curatedConflict')::boolean
                 AND e.curated_fields ? COALESCE($${keyMapIdx}::jsonb->>(f->>'field'), f->>'field')
             ) AS proposed
      FROM experience_sync_changes ch
      JOIN experiences e ON e.id = ch.experience_id
      JOIN experience_categories c ON c.id = e.category_id
      JOIN experience_sync_logs l ON l.id = ch.sync_log_id
      WHERE l.is_dry_run = FALSE
        AND ch.changed_fields @> '[{"curatedConflict": true}]'
        -- A run that finds the source agreeing again writes no row at all
        -- (see worthRecording), so the absence of a newer conflict is not
        -- evidence the disagreement stands. What such a run does leave is
        -- last_seen_sync_log_id, and a value newer than this row's means a
        -- later run saw the object and had nothing to propose.
        --
        -- Only once that run has finished and its batch actually landed.
        -- last_seen is stamped per item inside the loop while the changeset is
        -- written in one batch after it, so mid-run the newer value exists and
        -- the rows it would be read against do not — every conflict in the
        -- category would vanish for the length of the run.
        --
        -- A closed log is not by itself proof the batch landed, and status
        -- cannot answer it either: a run that throws after the item loop
        -- records its changes and only then marks itself failed. What
        -- distinguishes the two runs that recorded nothing is the marker each
        -- leaves — see CHANGESET_LANDED_SQL. Without that the inference would
        -- silence a standing disagreement for a whole sync cycle.
        AND (e.last_seen_sync_log_id IS NULL
             OR ch.sync_log_id >= e.last_seen_sync_log_id
             OR NOT EXISTS (
               SELECT 1 FROM experience_sync_logs prev
               WHERE prev.id = e.last_seen_sync_log_id AND ${CHANGESET_LANDED_SQL}))
        ${categoryFilter}
        AND ${scopeFilter}
      ORDER BY e.id, ch.id DESC
    ) q
    WHERE q.proposed IS NOT NULL
    ORDER BY q.id
    LIMIT $${acceptableIdx + 1} OFFSET $${acceptableIdx + 2}
  `, [...params, JSON.stringify(CURATED_KEY_BY_FIELD), JSON.stringify([...ACCEPTABLE_FIELDS]), limit, offset]);

  // arrival: the whole object is the proposal. A row from a gated source that
  // nobody has passed yet (ADR-0025) — the queue's own version of "created",
  // for a source that does not get to publish on its own say.
  //
  // A refused row is excluded for the same reason `missing` excludes one: it
  // already has a card of its own (§ 2.3), and one asking "may a reader see
  // this?" would be asking the second question before the first is settled.
  //
  // A row the source has since stopped offering withdraws instead (§ 3.6),
  // guarded by `missing_since IS NULL` — there is nobody it could be shown to
  // either way, and `missing` excludes the same row so it raises no card
  // under that heading either.
  const arrivals = await pool.query(`${CURATOR_SCOPED_REGIONS_CTE}
    SELECT e.id, e.external_id, e.name, e.category_id, c.name AS category_name,
           e.curation_state, e.first_seen_sync_log_id AS sync_log_id,
           ${lifecycleSelectSql()},
           'arrival' AS kind, NULL::jsonb AS proposed
    FROM experiences e
    JOIN experience_categories c ON c.id = e.category_id
    WHERE e.curation_state = 'pending'
      AND ${hideRefusedSql()}
      AND e.missing_since IS NULL
      AND ${scopeFilter} ${categoryFilter}
    ORDER BY e.first_seen_sync_log_id DESC NULLS LAST, e.id
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `, [...params, limit, offset]);

  // held: an already-visible row whose newest content proposal was kept out
  // by the upsert's own gate (ADR-0025 § "A gated source may not overwrite
  // what a reader can already see", `syncUtils.ts`) rather than applied.
  //
  // The pointer is set for *any* refused proposal, not only a gate-held one:
  // `syncUtils.ts`'s `proposedAnything` fires equally for a field a curator
  // individually claimed. Without the filter below, a row refused only by a
  // `curated_fields` claim would carry the same field under two contradictory
  // cards — `conflicts`, which `accept-source` answers, and `held`, which
  // publishing answers — and after the curator answered via `accept-source` this
  // card would stay behind showing a value already written. `(f->>'held')` keeps
  // the two questions separate: this card is only the fields the *category's
  // gate* held, never one a claim already refused for its own reason.
  //
  // The field says so itself rather than being inferred from the absence of a
  // claim (#519). The old `NOT (f->>'curatedConflict')::boolean` was right only
  // while the gate was the sole other reason a write could be refused: a third
  // reason would have been reclassified as gate-held here, and offered to
  // publishing, which writes all eleven columns.
  //
  // `e.missing_since IS NULL` for the same reason `arrivals` carries it: a row
  // the source has stopped offering is `missing`'s question, not this one,
  // and showing both would ask two things about one row.
  //
  // `POST /:id/publish` is what clears this pointer in response to a person —
  // under its own staleness check, whenever a curator's `expectedSyncLogId`
  // matches what is stored (or the call has nothing left to be stale about).
  // `syncUtils.ts` is the only other thing that ever clears it, and only when
  // a *later run* proposes nothing at all (the source came back to what is
  // stored). Answering a refusal at `POST /:id/admission` does not, even
  // though an override can publish the same row: admitting it says the object
  // belongs, not what a later proposal against it holds, and that stays a
  // separate question with its own card for a curator to answer through
  // `/publish`.
  //
  // What actually excludes an empty proposal is the `WHERE` above, not the
  // `q.proposed IS NOT NULL` below. `CROSS JOIN LATERAL` plus a per-field
  // predicate drops the rows before `GROUP BY` runs, so a changeset whose only
  // fields were claimed — or whose `changed_fields` is `[]` — forms no group at
  // all and `jsonb_agg` is never called on an empty set. Measured against a
  // real database: the result is byte-identical with the guard removed.
  //
  // It stays as a floor, and this comment exists so the next reader is not
  // misled about which line is doing the work: the guard starts mattering the
  // moment this becomes a `LEFT JOIN LATERAL`, or the field predicate moves into
  // a `FILTER`, either of which would keep the group and hand `jsonb_agg` an
  // empty set — and NULL there would render a card with nothing on it, which is
  // worse than no card. The neighbouring `conflict` kind is the opposite case:
  // there the same guard is load-bearing, because it wraps a correlated
  // subquery that genuinely returns NULL for a row that exists.
  const held = await pool.query(`${CURATOR_SCOPED_REGIONS_CTE}
    SELECT * FROM (
      SELECT e.id, e.external_id, e.name, e.category_id, c.name AS category_name,
             ${lifecycleSelectSql()},
             ch.sync_log_id, 'held' AS kind, jsonb_agg(f) AS proposed
      FROM experiences e
      JOIN experience_categories c ON c.id = e.category_id
      JOIN experience_sync_changes ch ON ch.experience_id = e.id
                                     AND ch.sync_log_id = e.pending_change_sync_log_id
      CROSS JOIN LATERAL jsonb_array_elements(ch.changed_fields) AS f
      WHERE e.pending_change_sync_log_id IS NOT NULL
        AND ${hideRefusedSql()}
        AND e.missing_since IS NULL
        AND (f->>'held')::boolean
        AND ${scopeFilter} ${categoryFilter}
      GROUP BY e.id, e.external_id, e.name, e.category_id, c.name, ch.sync_log_id
    ) q WHERE q.proposed IS NOT NULL
    ORDER BY q.sync_log_id DESC, q.id
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `, [...params, limit, offset]);

  // contents: a visible experience holding unread points or works of its own
  // (ADR-0025 decision 2 — the gate is on the content row, not only on its
  // container). Counted rather than listed: nobody approves 758 coordinates
  // one at a time, and for a large site the count plus the anchor's movement
  // is the whole judgement. The expandable row list is a separate, per-item
  // read — this endpoint only says that unread contents exist.
  //
  // `el.missing_since IS NULL` alongside `el.curation_state = 'pending'`: a
  // point the source has withdrawn is not "unread" in any sense a reader would
  // ever notice, since every reader-facing location read already carries
  // `offeredLocationSql()` — publishing it changes nothing on screen.
  //
  // Treasures need a second table, not a second column on one: a link's own
  // `curation_state` and its treasure's are independent axes (a work is
  // "checked once, globally", a link "as being HERE" — ADR-0025), so
  // `getExperienceTreasures` gates both separately (three predicates, not
  // one) and this count has to ask the same two questions or it would miss a
  // treasure whose link was already reviewed while the work itself was not
  // (a treasure shared across venues is exactly this shape). `et`/`t` are
  // joined unfiltered and the pending check moves to `WHERE`/`FILTER`,
  // because `t.curation_state` is not visible from inside `et`'s own JOIN
  // condition.
  //
  // `::int` on both counts, wrapping the whole aggregate because `FILTER` binds
  // to it: `COUNT(*)` is `bigint`, which `pg` hands to JavaScript as a *string*
  // to keep values above 2^53 exact. No count here can reach that — 758
  // locations is the catalogue's largest — so the cast costs nothing and stops
  // `"12"` reaching a client. It matters beyond arithmetic, where coercion would
  // cover for it: a plural rule compares against 1, and `'1' === 1` is false, so
  // an uncast count reads "1 points" on the queue page. Every other count in
  // this codebase casts for the same reason (`missingDetection.ts`,
  // `admission.ts`, `experienceRegionQuery.ts`).
  //
  // `COUNT(DISTINCT ...)` is load-bearing, not decoration: `el` and `et` are
  // independent one-to-many joins on the same experience, so their combined
  // row count is a product, not a sum — 3 pending points and 12 pending
  // works join to 36 raw rows for one experience, and a plain `COUNT(...)`
  // without `DISTINCT` would report 36 for a treasure count that is actually
  // 12 (and 36 again for a location count that is actually 3).
  const contents = await pool.query(`${CURATOR_SCOPED_REGIONS_CTE}
    SELECT e.id, e.external_id, e.name, e.category_id, c.name AS category_name,
           ${lifecycleSelectSql()},
           'contents' AS kind,
           -- No FILTER, unlike the treasures below: the join above already
           -- restricts el to pending, offered rows, so repeating it here would
           -- state the rule twice and leave the fragment appearing twice in one
           -- statement — which is what made two tests on this branch pass while
           -- the clause they were about had been deleted. The treasure count
           -- keeps its FILTER because et and t are joined unfiltered.
           COUNT(DISTINCT el.id)::int AS pending_locations,
           (COUNT(DISTINCT et.treasure_id)
             FILTER (WHERE et.curation_state = 'pending' OR t.curation_state = 'pending'))::int AS pending_treasures,
           NULL::jsonb AS proposed
    FROM experiences e
    JOIN experience_categories c ON c.id = e.category_id
    LEFT JOIN experience_locations el
           ON el.experience_id = e.id AND el.curation_state = 'pending' AND el.missing_since IS NULL
    LEFT JOIN experience_treasures et ON et.experience_id = e.id
    LEFT JOIN treasures t ON t.id = et.treasure_id
    WHERE ${hidePendingSql()}            -- an unread experience is an arrival, not this
      AND ${hideRefusedSql()}
      AND (el.id IS NOT NULL OR et.curation_state = 'pending' OR t.curation_state = 'pending')
      -- Withdrawn rows belong to the 'missing' card, like an arrival and like a
      -- held proposal: the same row under two headings would ask two questions
      -- whose answers contradict each other. "May readers see these twelve
      -- works?" is not answerable while "did this venue disappear?" is open, and
      -- publishing the works would not put them anywhere a reader looks anyway.
      AND e.missing_since IS NULL
      AND ${scopeFilter} ${categoryFilter}
    GROUP BY e.id, e.external_id, e.name, e.category_id, c.name
    ORDER BY e.id
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `, [...params, limit, offset]);

  res.json({
    missing: missing.rows,
    refused: refused.rows,
    keptOut: keptOut.rows,
    conflicts: conflicts.rows,
    arrivals: arrivals.rows,
    held: held.rows,
    contents: contents.rows,
    limit: Number(limit),
    offset: Number(offset),
  });
}
