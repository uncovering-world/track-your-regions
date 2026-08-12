/**
 * Curator decisions about an experience's lifecycle.
 *
 * A sync run can observe that a source stopped listing an object, or that it
 * wants to change a field a curator has claimed. It cannot decide what either
 * means: a site absent from the list may be delisted or destroyed or simply
 * missed, and only a person can tell which. This is where that judgement is
 * recorded — see ADR-0020 for why the two axes are separate.
 */

import { Response } from 'express';
import type { PoolClient } from 'pg';
import { pool, rollbackQuietly } from '../../db/index.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { CURATOR_SCOPED_REGIONS_CTE, curatorUnrestrictedScopeExists } from '../../middleware/auth.js';
import { resolveExperienceScope } from './experienceScope.js';
import { publishContents, placeAfterRelease } from './publishContents.js';
import { hidePendingSql, hideRefusedSql, lifecycleSelectSql } from './experienceLifecycle.js';
import { CURATED_KEY_BY_FIELD, claimKeyFor } from '../../services/sync/changeSet.js';
import { CHANGESET_LANDED_SQL } from '../../services/sync/syncLogMarkers.js';

/** How many items a queue page holds by default. */
const QUEUE_PAGE_SIZE = 25;

/**
 * Which of the fields a run can propose this endpoint will write back.
 *
 * Deliberately a subset. `location` and the country arrays need more than an
 * assignment, and `metadata` is claimed per key — `editExperience` writes
 * `metadata.website`, which is no column at all — so accepting it wholesale
 * would discard the keys the curator did not touch. These five are the ones
 * whose `curated_fields` entry happens to be exactly the column, which is why
 * `CURATED_KEY_BY_FIELD` can answer both questions for them without the two
 * ever drifting from what the upsert honours.
 */
const ACCEPTABLE_FIELDS = new Set(['name', 'shortDescription', 'description', 'category', 'imageUrl']);

/** The column an accepted field writes to, or null if it is not acceptable. */
function columnFor(field: string): string | null {
  if (!ACCEPTABLE_FIELDS.has(field)) return null;
  return CURATED_KEY_BY_FIELD[field] ?? null;
}

type Membership = 'present' | 'former';
type Existence = 'extant' | 'lost';

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
  // is the shape `setExperienceState` reasoned itself out of a few hundred
  // lines down and the one "Take a verdict back" promises against.
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

/**
 * Record what a curator decided about an object's lifecycle.
 * POST /api/experiences/:id/state
 * Body: { membership?: 'present'|'former', existence?: 'extant'|'lost', note?: string,
 *         expected: { membership, existence, flagged } }
 *
 * `expected` is required — the row as the caller was looking at it. Compared
 * under the write lock; see the comment on that comparison for why nothing
 * else can tell a stale view from a deliberate correction.
 *
 * Clearing `missing_since` is part of every answer: whichever verdict the
 * curator reaches, the machine's observation has been dealt with and should
 * stop appearing in the queue. Sending `membership: 'present'` alone is the
 * "false alarm" case — the source hiccupped and the object never went anywhere.
 */
export async function setExperienceState(req: AuthenticatedRequest, res: Response): Promise<void> {
  const experienceId = parseInt(String(req.params.id));
  const userId = req.user!.id;
  const userRole = req.user!.role;
  const { membership, existence, note, expected } = req.body as {
    membership?: Membership; existence?: Existence; note?: string;
    expected: { membership: Membership; existence: Existence; flagged: boolean };
  };

  if (!membership && !existence) {
    res.status(400).json({ error: 'Nothing to decide: pass membership, existence, or both' });
    return;
  }

  const expResult = await pool.query(
    `SELECT id, category_id, source_membership, existence FROM experiences WHERE id = $1`,
    [experienceId],
  );
  if (expResult.rows.length === 0) {
    res.status(404).json({ error: 'Experience not found' });
    return;
  }
  const existing = expResult.rows[0];

  const { permitted, logRegionId } = await resolveExperienceScope(
    userId, userRole, experienceId, existing.category_id as number,
  );
  if (!permitted) {
    res.status(403).json({ error: 'You do not have curator permissions for this experience' });
    return;
  }

  // One client, not pool.query('BEGIN') — see the note in curationController:
  // pg.Pool hands out an arbitrary idle client per call, so a transaction has
  // to be pinned or its statements land on different connections.
  const client = await pool.connect();
  let unusable: Error | undefined;
  let nextMembership: Membership;
  let nextExistence: Existence;
  let before: { source_membership: string; existence: string; missing_since?: Date | null };
  try {
    await client.query('BEGIN');

    // Both columns are written whatever the curator sent, the unsent axis
    // defaulting to what is already there — so the axis nobody decided has to
    // be read under the lock that writes it. Two curators on one item is the
    // normal case, not a corner: every region-scoped curator covering any of
    // its regions sees it, as do its category curator and every admin. From an
    // unlocked read, a verdict on one axis silently reverts a verdict on the
    // other, and the log would then assert `former` beside a column saying
    // `present`. Reverting `lost` costs more still: it puts the row back inside
    // missing detection's `existence <> 'lost'` predicate, so the next clean
    // run re-flags it and the item returns to the queue for good.
    const locked = await client.query(
      `SELECT source_membership, existence, missing_since FROM experiences WHERE id = $1 FOR UPDATE`,
      [experienceId],
    );
    before = locked.rows[0] ?? existing;
    nextMembership = membership ?? (before.source_membership as Membership);
    nextExistence = existence ?? (before.existence as Existence);

    // Does the row still look the way the curator saw it? Only the request can
    // say — a card drawn before the question was answered is otherwise
    // indistinguishable from a deliberate correction, and the difference hides
    // where it is least visible: "false alarm" over a recorded `former` is a
    // real transition, so no check on the verdict alone catches it.
    //
    // The flag is part of that picture, not a separate concern. A run that
    // finds the object again clears `missing_since` and touches neither axis
    // (`syncUtils.ts`), so a stale queue card matches on both while the
    // question it asks has been withdrawn — and answering "former" there
    // records as delisted an object the source currently lists, which no
    // detection predicate will ever raise again.
    //
    // Comparing state rather than refusing every decided row is what keeps a
    // verdict correctable. Refusing them wholesale made `former` and `lost`
    // terminal: detection re-flags neither, so one mis-click would remove an
    // object from the product with no remedy short of SQL.
    if (before.source_membership !== expected.membership
      || before.existence !== expected.existence
      || (before.missing_since != null) !== expected.flagged) {
      unusable = await rollbackQuietly(client);
      res.status(409).json({
        error: 'Someone else answered this first — reload to see where it stands',
        sourceMembership: before.source_membership,
        existence: before.existence,
      });
      return;
    }

    const actions = decidedActions(before, nextMembership, nextExistence);
    if (actions.length === 0) {
      // Nothing moved, and the state is the one the curator saw. With a flag
      // standing that is the false alarm — the one verdict with no transition
      // to name. With none, the question was already closed: taking it would
      // write a second `missing_dismissed` and move `state_decided_by` to
      // whoever clicked last.
      if (before.missing_since == null) {
        unusable = await rollbackQuietly(client);
        res.status(409).json({
          error: 'Already answered: this object is not waiting on a decision',
          sourceMembership: before.source_membership,
          existence: before.existence,
        });
        return;
      }
      actions.push('missing_dismissed');
    }

    await client.query(`
      UPDATE experiences
      SET source_membership = $2,
          existence = $3,
          missing_since = NULL,
          state_decided_by = $4,
          state_decided_at = NOW(),
          state_note = $5,
          updated_at = NOW()
      WHERE id = $1
    `, [experienceId, nextMembership, nextExistence, userId, note ?? null]);

    for (const action of actions) {
      await client.query(`
        INSERT INTO experience_curation_log (experience_id, curator_id, action, region_id, details)
        VALUES ($1, $2, $3, $4, $5)
      `, [experienceId, userId, action, logRegionId, JSON.stringify({
        membership: { old: before.source_membership, new: nextMembership },
        existence: { old: before.existence, new: nextExistence },
        note: note ?? null,
      })]);
    }
    await client.query('COMMIT');
  } catch (error) {
    // A client whose ROLLBACK also failed must be destroyed, not pooled: it
    // would otherwise carry an open transaction into the next request.
    unusable = await rollbackQuietly(client);
    throw error;
  } finally {
    client.release(unusable);
  }

  res.json({
    experienceId,
    sourceMembership: nextMembership,
    existence: nextExistence,
  });
}

/**
 * Publish an override's contents, but only when the override published the
 * object too.
 *
 * Split out on its own rather than an `if` inline in `setExperienceAdmission`,
 * which already carries the weight of two verdicts, a pin and a locked
 * re-read: one more branch there is the difference between this function
 * reading as one clause and reading as two. `publishes` decides everything —
 * an `auto` row was already visible, and this verdict says nothing about
 * whether anyone has read what is under it, so it must not publish a single
 * one of its pending rows.
 */
async function publishArrivalContents(
  client: PoolClient, experienceId: number, publishes: boolean,
): Promise<{
  locationsPublished: number;
  treasureLinksPublished: number;
  treasuresPublished: number;
  withdrawalsReleased: number;
}> {
  if (!publishes) {
    return { locationsPublished: 0, treasureLinksPublished: 0, treasuresPublished: 0, withdrawalsReleased: 0 };
  }
  // Un-refusing an arrival is a publication (ADR-0025 § 4.5), and a publication
  // takes everything that arrived with the object, not only its own fields —
  // otherwise the button says "Put it back" and the curator watches the museum
  // appear with no pin and no works, because nothing else here ever moves a
  // point or a link off `pending`. `publishContents` is `publishController.ts`'s
  // own answer to "which rows does a publish reach", shared rather than copied
  // so the two can never answer that question differently again: a
  // hand-written twin here would not have gained the `missing_since IS NULL`
  // guard the shared one already carries.
  return publishContents(client, experienceId);
}

/**
 * Answer a refusal.
 * POST /api/experiences/:id/admission
 * Body: { decision: 'confirm' | 'override', note?: string }
 *
 * Two answers, because a refusal has two and neither of them is a verdict about
 * the world (ADR-0024):
 *
 * - **confirm** — the rule was right. The row stays refused and hidden.
 * - **override** — the rule was wrong. The row is admitted again.
 *
 * Both pin `admission` in `curated_fields`, and that pin is what takes the item
 * out of the queue. It is also what makes the answer durable against *runs*, in
 * both directions: a curator who has looked at the thing outranks the rule, so
 * no later run re-refuses an overridden row or re-admits a confirmed one. The
 * sync's three admission writes all skip a pinned row for that reason.
 *
 * Durable against runs is not the same as final. `override` stays available on
 * a confirmed row, because confirming hides an object from everyone and a way
 * back that an earlier click can close is not a way back — the one thing this
 * endpoint must never become is the one-way door `setExperienceState` reasoned
 * itself out of. Confirmed rows are reachable in the queue's own kept-out list,
 * since `hideRefusedSql` leaves them visible nowhere else.
 *
 * No `expected` block here, unlike `setExperienceState`. `confirm` uses the pin
 * as its concurrency check — it hides, so a second curator on a stale card must
 * not silently re-hide a row the first one just put back — while `override`
 * needs none: it reveals, and two curators clicking it reach the same state.
 */
export async function setExperienceAdmission(req: AuthenticatedRequest, res: Response): Promise<void> {
  const experienceId = parseInt(String(req.params.id));
  const userId = req.user!.id;
  const userRole = req.user!.role;
  const { decision, note } = req.body as { decision: 'confirm' | 'override'; note?: string };

  const expResult = await pool.query(
    `SELECT id, category_id FROM experiences WHERE id = $1`,
    [experienceId],
  );
  if (expResult.rows.length === 0) {
    res.status(404).json({ error: 'Experience not found' });
    return;
  }

  const { permitted, logRegionId } = await resolveExperienceScope(
    userId, userRole, experienceId, expResult.rows[0].category_id as number,
  );
  if (!permitted) {
    res.status(403).json({ error: 'You do not have curator permissions for this experience' });
    return;
  }

  const admitted = decision === 'override';
  const client = await pool.connect();
  let unusable: Error | undefined;
  // Read by the response after the transaction settles, so they have to be
  // hoisted out of the `try` block that assigns them.
  let publishes = false;
  let curationState = '';
  let locationsPublished = 0;
  let treasureLinksPublished = 0;
  let treasuresPublished = 0;
  let withdrawalsReleased = 0;
  try {
    await client.query('BEGIN');

    // Locked, for the same reason `setExperienceState` locks: every curator
    // covering any of the row's regions sees this card, and two answers racing
    // would leave the log asserting one verdict beside a column holding the
    // other.
    const locked = await client.query(
      `SELECT admission, admission_reason, curated_fields, curation_state
         FROM experiences WHERE id = $1 FOR UPDATE`,
      [experienceId],
    );
    const before = locked.rows[0];
    // The existence check above ran on the pool, on another connection and
    // earlier in time. A row deleted in that window leaves nothing to lock, and
    // reading `curated_fields` off it would answer 500 to a question whose true
    // answer is 404. `setExperienceState` guards the same gap.
    if (!before) {
      unusable = await rollbackQuietly(client);
      res.status(404).json({ error: 'Experience not found' });
      return;
    }
    const alreadyAnswered = ((before.curated_fields as string[]) ?? []).includes('admission');

    // Putting a row back is allowed whatever the pin says, and confirming is
    // not. The asymmetry is the point: `override` is the way back, and a way
    // back that a previous answer can close is not one. It is also the safe
    // direction — it reveals rather than hides, and two curators both clicking
    // it reach the same state, so nothing is lost to a race.
    //
    // `confirm` keeps the pin as its concurrency check, because it hides: a
    // second curator arriving at a stale card must not silently re-hide a row
    // the first one just put back. That row is no longer `refused` anyway, so
    // it is caught by the same condition.
    const confirmBlocked = !admitted && alreadyAnswered;
    if (before.admission !== 'refused' || confirmBlocked) {
      unusable = await rollbackQuietly(client);
      res.status(409).json({
        error: alreadyAnswered
          ? 'Someone else answered this first — reload to see where it stands'
          : 'Already answered: this row is not waiting on a refusal decision',
        admission: before.admission,
      });
      return;
    }

    const curated = [...new Set([...((before.curated_fields as string[]) ?? []), 'admission'])];
    // The reason is resolved here rather than in a CASE over $2. Postgres has to
    // deduce one type per placeholder, and a parameter used both as the value of
    // a varchar column and as the left side of a text comparison gives it two —
    // "inconsistent types deduced for parameter $2", which no mocked-pool test
    // can see and the first real click found immediately.
    //
    // Kept on a confirmed row: it is the record of what the rule objected to,
    // and the archaeology category will be built by reading exactly these.
    // Cleared on an override, where it has stopped being true.
    const nextReason = admitted ? null : before.admission_reason;

    // A refusal overridden is a publication (ADR-0025 § 4.5): otherwise the
    // button says "Put it back" and puts nothing anywhere — the curator
    // un-refuses a museum, watches it stay invisible, and has to find it again
    // in another queue to say yes a second time. Only an override, and only
    // from `pending`: an `auto` row was already visible and this verdict says
    // nothing about whether anyone read it; a `confirm` leaves an
    // already-invisible row invisible.
    //
    // `verified` rather than `auto`, because a person did look: they read the
    // card, the reason and the name, and overruled a rule about this specific
    // object. That claim is thinner than a full content pass — nobody checked
    // the description, the image or the treasures underneath — and that is the
    // deliberate cost of not asking the same question twice: the curator has
    // just answered "does this belong here", and asking "has anyone looked at
    // it" a moment later, about the same click, would be asking the same
    // question with different words.
    //
    // Built here rather than as a `CASE` over a parameter, for the reason
    // `nextReason` is: a parameter used both as the value of a varchar column
    // and as the left side of a text comparison gives Postgres two types to
    // deduce for one placeholder, and the error is invisible to every
    // mocked-pool test.
    publishes = admitted && before.curation_state === 'pending';
    curationState = publishes ? 'verified' : (before.curation_state as string);
    const publishSet = publishes
      ? `, curation_state = 'verified', published_at = COALESCE(published_at, NOW())`
      : '';

    await client.query(`
      UPDATE experiences
      SET admission = $2,
          admission_reason = $3,
          curated_fields = $4,
          state_decided_by = $5,
          state_decided_at = NOW(),
          state_note = $6,
          updated_at = NOW()${publishSet}
      WHERE id = $1
    `, [
      experienceId, admitted ? 'admitted' : 'refused', nextReason,
      JSON.stringify(curated), userId, note ?? null,
    ]);

    ({ locationsPublished, treasureLinksPublished, treasuresPublished, withdrawalsReleased } =
      await publishArrivalContents(client, experienceId, publishes));

    // No placement for the admission columns themselves. Placement's insert
    // predicate is `el.missing_since IS NULL` and nothing else — it filters
    // neither `curation_state` nor `admission` — so a refused row was placed
    // exactly like any other one the moment its location landed, and
    // un-refusing it moves no geometry, no point and no membership by itself.
    // Verified on 2026-08-11 against a same-day clone of the live
    // `track_regions`: `SELECT count(*) FROM experience_regions WHERE
    // experience_id = <a refused row>` returned the same non-zero count as an
    // admitted row's, confirming the row was already placed. "Un-refusing
    // should re-place" is the intuitive answer and the wrong one — for the
    // admission columns.
    //
    // `publishArrivalContents` above is a different story: nothing about a row
    // being refused stops a later sync run deferring a withdrawal on one of
    // its locations, so an override that publishes an arrival's contents can
    // release one exactly as `publishController.ts`'s own publish can — same
    // unit, same consequence, so it gets the same follow-up below.

    await client.query(`
      INSERT INTO experience_curation_log (experience_id, curator_id, action, region_id, details)
      VALUES ($1, $2, $3, $4, $5)
    `, [experienceId, userId, admitted ? 'admission_overridden' : 'admission_confirmed', logRegionId,
      JSON.stringify({
        reason: before.admission_reason, note: note ?? null, published: publishes,
        locations: locationsPublished, treasureLinks: treasureLinksPublished,
        treasures: treasuresPublished, withdrawalsReleased,
      })]);

    await client.query('COMMIT');
  } catch (error) {
    unusable = await rollbackQuietly(client);
    throw error;
  } finally {
    client.release(unusable);
  }

  const placementFields = await placeAfterAdmissionRelease(experienceId, withdrawalsReleased);

  res.json({
    experienceId,
    admission: admitted ? 'admitted' : 'refused',
    published: publishes,
    // The rest mirrors `publish`'s own response, deliberately: a curator who
    // clicks "Put it back" on an arrival gets both the admission verdict and
    // the publish outcome that came with it, in the shape the review page
    // already knows how to say in one sentence. Never a held field — an
    // override does not apply a proposal; that is `/publish`'s question, not
    // this one's, and a row holding one keeps its pointer and its own card.
    curationState,
    appliedFields: [] as string[],
    claimedFieldsSkipped: [] as string[],
    fromSyncLogId: null,
    locationsPublished,
    treasureLinksPublished,
    treasuresPublished,
    withdrawalsReleased,
    ...placementFields,
  });
}

/**
 * Place the object again if publishing its contents released a withdrawal,
 * and fold the outcome into the response.
 *
 * Split out on its own for the same reason `publishArrivalContents` is: one
 * more branch inline in `setExperienceAdmission` is the difference between
 * the function reading as a sequence of decisions and reading as a maze of
 * them. Run after `setExperienceAdmission`'s own `try`/`finally` has released
 * the client — after the COMMIT and off it, since `assignRegionsForExperiences`
 * opens a transaction of its own, the same reason `publishController.ts`
 * places after its own COMMIT rather than inside the transaction it just
 * closed.
 */
async function placeAfterAdmissionRelease(
  experienceId: number, withdrawalsReleased: number,
): Promise<{
  placementFailed?: true;
  placementFailedWorldViews?: Array<{ id: number | null; name: string | null }>;
}> {
  if (withdrawalsReleased === 0) return {};
  const failures = await placeAfterRelease(experienceId);
  if (failures.length === 0) return {};
  // The list, not only the flag. The remedy — a region re-assignment — is
  // admin-only, so a curator's actionable step is to tell an admin *which*
  // object and *which* world views, and a bare boolean reduces them to
  // "something about regions failed on the Prado". `placeAfterRelease` already
  // returns one entry per failed world view with its id and its name, and
  // `/:id/publish` already passes them through; dropping them here would have
  // made three sentences in this branch false about this one endpoint.
  // Reshaped to the same `{ id, name }` the publish endpoint answers with, so
  // the page renders one sentence for both rather than two.
  return {
    placementFailed: true,
    placementFailedWorldViews: failures.map(f => ({ id: f.worldViewId, name: f.worldViewName })),
  };
}

/**
 * Name each transition the call actually makes, so the log reads as events
 * rather than as a diff. Empty means nothing moved, which the caller
 * distinguishes: an asserted false alarm is a verdict and gets
 * `missing_dismissed`, while a verdict someone else already recorded is not
 * this curator's to log a second time.
 */
function decidedActions(
  existing: { source_membership: string; existence: string },
  membership: Membership,
  existence: Existence,
): string[] {
  const actions: string[] = [];
  if (membership === 'former' && existing.source_membership !== 'former') actions.push('marked_former');
  if (existence === 'lost' && existing.existence !== 'lost') actions.push('marked_lost');
  // One restoration however many axes it undid — two identical rows would read
  // as two separate decisions.
  const restored = (membership === 'present' && existing.source_membership === 'former')
    || (existence === 'extant' && existing.existence === 'lost');
  if (restored) actions.push('state_restored');
  return actions;
}


/**
 * Apply the value a sync proposed for a field the curator had claimed.
 * POST /api/experiences/:id/accept-source
 * Body: { fields: string[], expectedSyncLogId: number }
 *
 * The upsert refused these values at the time, so they exist only in the
 * changeset. `expectedSyncLogId` names the run the caller was looking at and is
 * required: the proposal is re-resolved under the write lock, and one belonging
 * to a different run is refused rather than substituted. The response names it
 * back, along with which fields were applied now and which were only released.
 */
export async function acceptSourceValue(req: AuthenticatedRequest, res: Response): Promise<void> {
  const experienceId = parseInt(String(req.params.id));
  const userId = req.user!.id;
  const userRole = req.user!.role;
  const { fields, expectedSyncLogId } = req.body as {
    fields: string[]; expectedSyncLogId: number;
  };

  if (!Array.isArray(fields) || fields.length === 0) {
    res.status(400).json({ error: 'fields is required' });
    return;
  }

  const expResult = await pool.query(
    `SELECT id, category_id FROM experiences WHERE id = $1`,
    [experienceId],
  );
  if (expResult.rows.length === 0) {
    res.status(404).json({ error: 'Experience not found' });
    return;
  }
  const existing = expResult.rows[0];

  const { permitted, logRegionId } = await resolveExperienceScope(
    userId, userRole, experienceId, existing.category_id as number,
  );
  if (!permitted) {
    res.status(403).json({ error: 'You do not have curator permissions for this experience' });
    return;
  }

  const outcome = await applyProposedFields(experienceId, userId, logRegionId, fields, expectedSyncLogId);
  if (outcome.refusal) {
    res.status(409).json(outcome.refusal);
    return;
  }
  const { applied, released, fromSyncLogId } = outcome;

  res.json({
    experienceId,
    applied,
    // Fields this endpoint cannot write: the claim is gone, so the next run
    // applies the source's value through the ordinary upsert.
    released,
    fromSyncLogId,
  });
}

/**
 * Write the accepted values and release the curator's claim on those fields.
 *
 * Releasing the claim is the point, and it is the whole of the answer for
 * fields this endpoint cannot write. A curator who lets the source have the
 * coordinates cannot type them in — `editExperience` does not offer location at
 * all, and every path that writes `curated_fields` other than this one only
 * ever adds to it. So releasing is what lets the *next run* apply the source's
 * value through the ordinary upsert, and it is the only thing that takes such
 * an item off the queue. For the five writable fields the value is additionally
 * applied now, which is the only difference between the two cases.
 *
 * Everything the decision rests on is read inside the transaction that writes,
 * under the row lock: `curated_fields`, and the proposal itself. Resolving the
 * proposal earlier would leave the endpoint's own guarantee open — a run
 * landing between that read and this lock would have its values written under
 * the run id the curator sent, which is exactly the substitution
 * `expectedSyncLogId` exists to refuse. The claim has the same problem in
 * reverse: the whole column is rewritten, not one element of it, so a value
 * read before the lock discards whatever was claimed in between, and "is this
 * field still claimed?" stops being a guess only once it is asked here.
 */
async function applyProposedFields(
  experienceId: number,
  userId: number,
  logRegionId: number | null,
  fields: string[],
  expectedSyncLogId: number,
): Promise<{
  applied: string[];
  released: string[];
  fromSyncLogId: number;
  refusal?: { error: string; fromSyncLogId?: number };
}> {
  const client = await pool.connect();
  let unusable: Error | undefined;
  try {
    await client.query('BEGIN');
    const locked = await client.query(
      `SELECT curated_fields FROM experiences WHERE id = $1 FOR UPDATE`,
      [experienceId],
    );
    const claimed: string[] = locked.rows[0]?.curated_fields ?? [];

    // Same predicate as the queue, withdrawal check included: a conflict a
    // later run stopped proposing must not be writable here either, or the
    // guard below would refuse a newer proposal while letting a retracted one
    // through.
    const proposal = await client.query(`
      SELECT ch.sync_log_id, ch.changed_fields
      FROM experience_sync_changes ch
      JOIN experience_sync_logs l ON l.id = ch.sync_log_id
      JOIN experiences e ON e.id = ch.experience_id
      WHERE ch.experience_id = $1
        AND l.is_dry_run = FALSE
        AND ch.changed_fields @> '[{"curatedConflict": true}]'
        AND (e.last_seen_sync_log_id IS NULL
             OR ch.sync_log_id >= e.last_seen_sync_log_id
             OR NOT EXISTS (
               SELECT 1 FROM experience_sync_logs prev
               WHERE prev.id = e.last_seen_sync_log_id AND ${CHANGESET_LANDED_SQL}))
      ORDER BY ch.id DESC
      LIMIT 1
    `, [experienceId]);

    // Awaited at every call site. `return refuse(…)` without it settles the
    // try block immediately, so `finally` releases the client while the
    // ROLLBACK is still in flight on it — and reads `unusable` before this
    // line has run.
    const refuse = async (error: string, fromSyncLogId?: number) => {
      unusable = await rollbackQuietly(client);
      return { applied: [], released: [], fromSyncLogId: fromSyncLogId ?? 0, refusal: { error, fromSyncLogId } };
    };

    if (proposal.rows.length === 0) {
      return await refuse('No source proposal on record for this experience');
    }
    const fromSyncLogId = proposal.rows[0].sync_log_id as number;
    if (fromSyncLogId !== expectedSyncLogId) {
      return await refuse('A newer run has proposed something else — reload to see it', fromSyncLogId);
    }

    const proposed = (proposal.rows[0].changed_fields as Array<{ field: string; new: unknown; curatedConflict?: boolean }>)
      .filter(f => f.curatedConflict && fields.includes(f.field));
    if (proposed.length === 0) {
      return await refuse('The requested fields carry no source proposal');
    }

    // Still-claimed fields only: one released while this request was in flight
    // is an answer someone already gave.
    const open = proposed.filter(p => claimed.includes(claimKeyFor(p.field)));
    if (open.length === 0) {
      return await refuse('None of the requested fields is still an open conflict');
    }

    const writable = open.filter(p => columnFor(p.field) !== null);
    const assignments = writable.map((p, i) => `${columnFor(p.field)} = $${i + 2}`);
    const values = writable.map(p => p.new);
    const remaining = claimed.filter(k => !open.some(p => claimKeyFor(p.field) === k));

    await client.query(
      `UPDATE experiences
       SET ${assignments.map(a => `${a},`).join('\n           ')}
           curated_fields = $${writable.length + 2}::jsonb,
           updated_at = NOW()
       WHERE id = $1`,
      [experienceId, ...values, JSON.stringify(remaining)],
    );
    await client.query(`
      INSERT INTO experience_curation_log (experience_id, curator_id, action, region_id, details)
      VALUES ($1, $2, 'accepted_source', $3, $4)
    `, [experienceId, userId, logRegionId, JSON.stringify({
      fields: open.map(p => ({
        field: p.field,
        applied: columnFor(p.field) !== null ? p.new : undefined,
        appliesAtNextSync: columnFor(p.field) === null || undefined,
      })),
    })]);
    await client.query('COMMIT');
    return {
      applied: writable.map(p => p.field),
      released: open.filter(p => columnFor(p.field) === null).map(p => p.field),
      fromSyncLogId,
    };
  } catch (error) {
    // A client whose ROLLBACK also failed must be destroyed, not pooled: it
    // would otherwise carry an open transaction into the next request.
    unusable = await rollbackQuietly(client);
    throw error;
  } finally {
    client.release(unusable);
  }
}

