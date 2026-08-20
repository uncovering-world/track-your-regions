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
import { hidePendingSql, hideRefusedSql, lifecycleSelectSql, offeredLocationSql } from './experienceLifecycle.js';
import { CURATED_KEY_BY_FIELD } from '../../services/sync/changeSet.js';
import { CHANGESET_LANDED_SQL } from '../../services/sync/syncLogMarkers.js';
import { ACCEPTABLE_FIELDS } from './acceptableFields.js';

/** How many items a queue page holds by default. */
const QUEUE_PAGE_SIZE = 25;

/**
 * How many unread points or works one `contents` card lists.
 *
 * The count beside the list is always the whole number, so this caps what is
 * shown and never what is said. Set to the page size on purpose: a card is a
 * page's worth of rows at most, and beyond that the answer a curator needs is
 * the object's, not each row's — the catalogue's largest serial nomination holds
 * 758 points, and a list of 758 is a wall rather than a question.
 */
const CONTENTS_ROWS_SHOWN = QUEUE_PAGE_SIZE;

/**
 * What the object *is*, for a card that asks a question about it.
 *
 * Every kind here asks a curator to judge something — whether a site is gone, whether a
 * description is better, whether a museum should be visible — and until now none of them
 * showed the thing being judged: no picture, no coordinates, no way to open the source
 * page. Deciding meant leaving the queue.
 *
 * Carried on every kind through one fragment rather than added per query, so the eight
 * cards cannot drift into showing different amounts about the same object. It costs each
 * query four columns off the row it already reads plus one region lookup; the regions are
 * a list because an object crosses them, and their names are what a curator recognises —
 * the ids on the object are not.
 */
function objectContextSelectSql(alias = 'e'): string {
  return `${alias}.image_url,
          ST_Y(${alias}.location) AS latitude,
          ST_X(${alias}.location) AS longitude,
          ${alias}.metadata->>'website' AS website_url,
          ${alias}.metadata->>'wikipediaUrl' AS wikipedia_url,
          (SELECT jsonb_agg(r.name ORDER BY r.name)
             FROM experience_regions er
             JOIN regions r ON r.id = er.region_id
            WHERE er.experience_id = ${alias}.id) AS region_names,
          -- How much the object holds, which is part of what it *is* and what every
          -- card here was missing: a text diff about one component of a serial site
          -- read as a diff about the site. UNESCO 1239 is the case — the source
          -- proposed a description of Waldsiedlung Zehlendorf, one of seven parts,
          -- and nothing on the card said the object had parts at all.
          --
          -- Both counts on every kind, reversing the narrower judgement the works
          -- total was added under ("only the two kinds whose text cites the count").
          -- That was right while the number served a refusal's sentence; it is the
          -- object's own shape now, and a fragment that answers "what is this"
          -- cannot answer it differently per card. Two indexed counts per row,
          -- 25 rows a page.
          -- Through the fragment, not spelled out: this count is what every card
          -- turns "made of N places" on, and a point a curator declared gone from the
          -- world is not one of them. Written by hand it would have counted one, which
          -- is the divergence the contents join below already learned once.
          (SELECT count(*) FROM experience_locations off
            WHERE off.experience_id = ${alias}.id AND ${offeredLocationSql('off')})::int
            AS offered_locations,
          (SELECT count(*) FROM experience_treasures et
            WHERE et.experience_id = ${alias}.id)::int AS counted_works_total`;
}

/**
 * The famous works a refusal counted, named — and, below, how many there are in all.
 *
 * A refusal reads "0 of 5 famous works are paintings" and a curator's first question is
 * *which five*. They are in the catalogue already — the run imports a venue's works before
 * deciding about the venue — so the card can name them instead of asserting a number.
 * Ordered as the rule ordered them, by how widely known each work is, and capped at twelve:
 * the widest holding a refusal cites here is sixteen, so the cap almost never bites, and
 * where it does the card says how many it is not showing rather than quietly stopping.
 * `counted_works_total` is what makes that possible on a refusal whose sentence cites no
 * number of its own — a cathedral's does not, and the array alone cannot tell a holding of
 * twelve from the first twelve of thirty. It now lives in `objectContextSelectSql` above,
 * with the point count beside it: how much an object holds turned out to be part of what
 * the object *is*, needed by every card rather than by the two whose text cites it.
 *
 * The named array stays on those two kinds alone. UNESCO sites hold no works, and adding
 * the lookup to every kind would cost a join for an empty array on each one that holds
 * none.
 */
/** The best-known twelve of them, ranked, with what each one is. */
function countedWorksSelectSql(alias = 'e'): string {
  // `row_number()` rather than `ORDER BY w->>'name'`: the aggregate imposes its own order on
  // what the subquery hands it, so sorting it by name would leave the LIMIT picking the
  // twelve best-known works and then present them alphabetically — and the card's own
  // headings ("less widely known", "the least widely known") would rank nothing.
  return `(SELECT jsonb_agg(w ORDER BY fame)
             FROM (SELECT jsonb_build_object(
                            'name', t.name, 'type', t.treasure_type, 'artist', t.artist,
                            'imageUrl', t.image_url, 'year', t.year,
                            -- The source's own id, so the preview can stop being a dead
                            -- end: a curator who does not recognise a work needs somewhere
                            -- to go, and this is where the work came from.
                            'externalId', t.external_id) AS w,
                          row_number() OVER (ORDER BY t.sitelinks_count DESC NULLS LAST) AS fame
                     FROM experience_treasures et
                     JOIN treasures t ON t.id = et.treasure_id
                    WHERE et.experience_id = ${alias}.id
                    ORDER BY t.sitelinks_count DESC NULLS LAST
                    LIMIT 12) top) AS counted_works`;
}

/**
 * The decisions waiting for a curator, scoped to what they cover.
 * GET /api/experiences/review/queue?categoryId=&limit=&<kind>Offset=
 *
 * Seven kinds of open question, and one list that is not a question at all:
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
 *   Counted *and* listed: the count is the whole number and the list is its first
 *   `CONTENTS_ROWS_SHOWN` rows, so a card can be decided on without asking a
 *   curator to approve twelve things they cannot see (#524) and without turning a
 *   758-point site into 758 rows.
 * - **the object lost places it is made of** — a run stopped offering them and
 *   marked them (ADR-0022), so readers lost those pins the moment it noticed, and
 *   nobody has said what any of it means (ADR-0026). The row carries every such
 *   point of the object, since one run can drop several components of a serial
 *   site; the verdict is per *point* rather than per object, which no other kind
 *   is, and it is answered at a different endpoint —
 *   `POST /locations/:locationId/state`.
 *
 * `keptOut` is the exception to all of it: those rows are answered, not
 * waiting, and are carried here only because nowhere else can show them.
 */
export async function getReviewQueue(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  const isAdmin = req.user!.role === 'admin';
  const { categoryId, limit = QUEUE_PAGE_SIZE } = req.query as {
    categoryId?: number; limit?: number;
  };
  // Eight offsets, because they are eight queries with eight LIMITs. One shared number
  // moved all of them at once, so a full page of one kind hid a page 2 that no control
  // could ask for.
  const q = req.query as Record<string, number | undefined>;
  const offsets = {
    missing: q.missingOffset ?? 0,
    refused: q.refusedOffset ?? 0,
    keptOut: q.keptOutOffset ?? 0,
    conflicts: q.conflictsOffset ?? 0,
    arrivals: q.arrivalsOffset ?? 0,
    held: q.heldOffset ?? 0,
    contents: q.contentsOffset ?? 0,
    withdrawn: q.withdrawnOffset ?? 0,
  };

  // Asked for one more than the page, so "is there another page" is answered by the rows
  // themselves. A COUNT(*) per kind would be a second source of truth for a number, and
  // this endpoint deliberately returns no totals — see the note on counts below.
  const pageSize = Number(limit) + 1;
  const paged = <T>(rows: T[]) => ({ items: rows.slice(0, Number(limit)), hasMore: rows.length > Number(limit) });

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
           ${lifecycleSelectSql()}, ${objectContextSelectSql()},
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
  `, [...params, pageSize, offsets.missing]);

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
           ${lifecycleSelectSql()}, ${objectContextSelectSql()},
           'refused' AS kind, ${countedWorksSelectSql()},
           NULL::jsonb AS proposed
    FROM experiences e
    JOIN experience_categories c ON c.id = e.category_id
    WHERE e.admission = 'refused'
      AND NOT COALESCE(e.curated_fields ? 'admission', false)
      ${categoryFilter}
      AND ${scopeFilter}
    ORDER BY e.id
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `, [...params, pageSize, offsets.refused]);

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
           ${lifecycleSelectSql()}, ${objectContextSelectSql()},
           'kept-out' AS kind, ${countedWorksSelectSql()},
           NULL::jsonb AS proposed
    FROM experiences e
    JOIN experience_categories c ON c.id = e.category_id
    WHERE e.admission = 'refused'
      AND COALESCE(e.curated_fields ? 'admission', false)
      ${categoryFilter}
      AND ${scopeFilter}
    ORDER BY e.state_decided_at DESC NULLS LAST, e.id
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `, [...params, pageSize, offsets.keptOut]);

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

  // The curation log is scope-filtered **per row**, not per experience, and the two
  // subqueries below read it — so they carry the same predicate `getCurationLog` does.
  // Without it the queue would leak past its own scope: an object assigned to regions A
  // and B admits a curator scoped only to A through the outer filter (an EXISTS over
  // *any* region), while an edit made by a curator of B is logged with `region_id = B`.
  // The card would then name that curator, the date, and the values they applied —
  // exactly the rows the log endpoint drops for the same reader.
  //
  // A row with no region is an act that belonged to no one region (an admin's, a global
  // curator's), and stays visible to everyone, as it is in the log.
  const logScopeFilter = isAdmin
    ? 'TRUE'
    : `(${curatorUnrestrictedScopeExists('e.category_id')}
         OR log.region_id IS NULL
         OR log.region_id IN (SELECT id FROM curator_scoped_regions))`;
  const conflicts = await pool.query(`${CURATOR_SCOPED_REGIONS_CTE}
    SELECT * FROM (
      SELECT DISTINCT ON (e.id)
             e.id, e.external_id, e.name, e.category_id, c.name AS category_name,
             ${lifecycleSelectSql()}, ${objectContextSelectSql()},
             'conflict' AS kind, ch.sync_log_id,
             -- When the run that is asking finished. The card names a run either
             -- way; a curator deciding whose text is newer needs the date, and
             -- reading it off the log is the only place it exists.
             l.completed_at AS run_completed_at,
             (SELECT jsonb_agg(f || jsonb_build_object(
                       'acceptable', $${acceptableIdx}::jsonb ? (f->>'field'),
                       -- Who claimed this field and when, so the button stops
                       -- saying "my edit" about another curator's work. The
                       -- claim itself is a set membership in curated_fields and
                       -- carries no author; the act that put it there is a log
                       -- entry keyed by the *column* name, which is what the same
                       -- map above translates to.
                       --
                       -- Two actions can put a key there, not one. A correction
                       -- to a single-point object's own point claims location on
                       -- the experience and records location_edited
                       -- (ADR-0029 decision 6), so matching edited alone left
                       -- exactly that claim unattributed — and it is the ordinary
                       -- path, not a corner: one corrected UNESCO site raises a
                       -- conflict card on every run afterwards. That card would
                       -- then ask a curator to choose between two coordinates
                       -- without saying whose the standing one is, which is the
                       -- state this subquery exists to end.
                       --
                       -- But narrowly, because a key in the details is not a
                       -- claim on the *object*. A point rename writes a name key
                       -- and claims nothing here — the anchor branch is the only
                       -- writer of experiences.curated_fields in that endpoint
                       -- and only ever adds location — so a widening on the
                       -- action alone let the newest point rename outrank the
                       -- edit that really claimed the museum's name, and the card
                       -- would name a curator who never made that claim. The
                       -- anchorMoved flag is exactly "this act put location into
                       -- the experience's claim set", which is the question.
                       'claim', (
                         SELECT jsonb_build_object(
                                  'by', COALESCE(u.display_name, 'a curator'),
                                  'at', log.created_at)
                           FROM experience_curation_log log
                           JOIN users u ON u.id = log.curator_id
                          WHERE log.experience_id = e.id
                            AND (log.action = 'edited'
                              OR (log.action = 'location_edited'
                                  AND f->>'field' = 'location'
                                  AND (log.details->>'anchorMoved')::boolean))
                            AND log.details ? COALESCE(
                                  $${keyMapIdx}::jsonb->>(f->>'field'), f->>'field')
                            AND ${logScopeFilter}
                          ORDER BY log.created_at DESC, log.id DESC
                          LIMIT 1),
                       -- What was decided about this field before, newest first.
                       -- A curator meeting the same field a third time is owed
                       -- the answers already given to it — both kinds. Refusals
                       -- are read here too, and carry the action, because "took
                       -- the source's value" and "kept theirs" are the two
                       -- halves of the same history and a trail showing one of
                       -- them says the field was answered once when it was
                       -- answered twice.
                       'decidedBefore', COALESCE((
                         SELECT jsonb_agg(jsonb_build_object(
                                  'by', COALESCE(u.display_name, 'a curator'),
                                  'at', log.created_at,
                                  'action', log.action,
                                  'applied', COALESCE(d->>'applied', d->>'declined'))
                                ORDER BY log.created_at DESC)
                           FROM experience_curation_log log
                           JOIN users u ON u.id = log.curator_id
                           CROSS JOIN LATERAL jsonb_array_elements(
                                  COALESCE(log.details->'fields', '[]'::jsonb)) d
                          WHERE log.experience_id = e.id
                            AND log.action IN ('accepted_source', 'declined_source')
                            AND d->>'field' = f->>'field'
                            AND ${logScopeFilter}), '[]'::jsonb)))
               FROM jsonb_array_elements(ch.changed_fields) f
               WHERE (f->>'curatedConflict')::boolean
                 AND e.curated_fields ? COALESCE($${keyMapIdx}::jsonb->>(f->>'field'), f->>'field')
                 -- ...and the curator has not already answered *this* proposal. By
                 -- value, not by field: a refusal says "not that text", and a source
                 -- that comes back with different text is asking a new question, which
                 -- is the one case a suppressed card must not swallow. The field name
                 -- here is the changeset's own, since that is what the decision
                 -- recorded — no claim-key translation, unlike the line above.
                 --
                 -- COALESCE because a proposal can carry no value at all: a source that
                 -- stops publishing a claimed metadata key proposes undefined, which
                 -- JSON.stringify drops from the row, and the entry is still an ordinary
                 -- conflict. The refusal stores a jsonb null for it, so comparing against
                 -- SQL NULL would answer NULL, never true — that class of card
                 -- would come back after a refusal that reported success, which is the
                 -- exact failure this design exists to prevent. Both sides now agree on
                 -- the missing case.
                 AND NOT EXISTS (
                   SELECT 1 FROM experience_conflict_decisions d
                    WHERE d.experience_id = e.id
                      AND d.field = f->>'field'
                      AND d.declined = COALESCE(f->'new', 'null'::jsonb))
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
  `, [...params, JSON.stringify(CURATED_KEY_BY_FIELD), JSON.stringify([...ACCEPTABLE_FIELDS]), pageSize, offsets.conflicts]);

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
           ${lifecycleSelectSql()}, ${objectContextSelectSql()},
           'arrival' AS kind, NULL::jsonb AS proposed
    FROM experiences e
    JOIN experience_categories c ON c.id = e.category_id
    WHERE e.curation_state = 'pending'
      AND ${hideRefusedSql()}
      AND e.missing_since IS NULL
      AND ${scopeFilter} ${categoryFilter}
    ORDER BY e.first_seen_sync_log_id DESC NULLS LAST, e.id
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `, [...params, pageSize, offsets.arrivals]);

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
             ${lifecycleSelectSql()}, ${objectContextSelectSql()},
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
  `, [...params, pageSize, offsets.held]);

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
  const contents = await pool.query(`${CURATOR_SCOPED_REGIONS_CTE}
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
  `, [...params, pageSize, offsets.contents]);

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
  const withdrawn = await pool.query(`${CURATOR_SCOPED_REGIONS_CTE}
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
  `, [...params, pageSize, offsets.withdrawn]);

  const pages = {
    missing: paged(missing.rows),
    refused: paged(refused.rows),
    keptOut: paged(keptOut.rows),
    conflicts: paged(conflicts.rows),
    arrivals: paged(arrivals.rows),
    held: paged(held.rows),
    contents: paged(contents.rows),
    withdrawn: paged(withdrawn.rows),
  };

  // The arrays keep their names and their place at the top level — every reader of this
  // response indexes them by kind. What is new sits beside them: where each kind is and
  // whether it has another page, which is the pair a control needs to page one kind
  // without moving the others.
  res.json({
    missing: pages.missing.items,
    refused: pages.refused.items,
    keptOut: pages.keptOut.items,
    conflicts: pages.conflicts.items,
    arrivals: pages.arrivals.items,
    held: pages.held.items,
    contents: pages.contents.items,
    withdrawn: pages.withdrawn.items,
    limit: Number(limit),
    paging: Object.fromEntries(
      Object.entries(pages).map(([kind, page]) => [
        kind, { offset: offsets[kind as keyof typeof offsets], hasMore: page.hasMore },
      ]),
    ),
  });
}
