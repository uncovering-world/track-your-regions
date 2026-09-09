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
import type { QueryResult } from 'pg';
import { pool } from '../../db/index.js';
import { MEMBERSHIPS, admissionPinnedSql } from '../../db/membership.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { CURATOR_SCOPED_REGIONS_CTE, curatorUnrestrictedScopeExists } from '../../middleware/auth.js';
import { lifecycleSelectSql } from './experienceLifecycle.js';
import { CLAIM_KEY_BY_FAMILY, CURATED_KEY_BY_FIELD } from '../../services/sync/changeSet.js';
import { ACCEPTABLE_FIELDS } from './acceptableFields.js';
import {
  objectContextSelectSql, countedWorksSelectSql, QUEUE_PAGE_SIZE,
} from './reviewQueueContext.js';
import {
  heldPartsSelectSql, queryAnsweredWithdrawals, queryContents, queryWithdrawn,
} from './reviewQueueContents.js';
import { queryRefusedParts } from './reviewQueueRefusedParts.js';
import {
  QUEUE_KINDS, WAITING_SUBS, likeParam, queryQueueKeys,
} from './reviewQueueKeys.js';
import type { QueueFilters, QueueKind, WaitingSub } from './reviewQueueKeys.js';
import {
  arrivalOpenSql, claimKeySql, conflictChangeOpenSql, heldOpenSql, missingOpenSql, refusedOpenSql,
} from './reviewQueuePredicates.js';
import { heldFieldAnsweredSql } from './heldDecisions.js';
import { withDangerFields } from './experienceDanger.js';

/** The request as `reviewQueueQuerySchema` leaves it, and as a test may not. */
interface ReviewQueueQuery {
  q?: string;
  source?: string;
  kind?: string;
  region?: number | 'none';
  run?: number;
  aside?: 'show';
  sort?: 'date' | 'question';
  cursor?: string;
  limit?: number;
  keptOutOffset?: number;
  answeredWithdrawalsOffset?: number;
  refusedPartsOffset?: number;
}

/** The words a `kind` chip may carry: the five classes and the three sub-kinds. */
const KIND_WORDS = new Set<string>([...QUEUE_KINDS, ...WAITING_SUBS]);

/**
 * The largest `experience_categories.id` there can be: the column is SERIAL, so
 * a bigger number names no source and, bound into an `int[]`, would be an error
 * from Postgres rather than a filter that matches nothing.
 */
const MAX_SOURCE_ID = 2147483647;

/**
 * The request's controls as the keys phase reads them.
 *
 * A word the vocabulary does not know is dropped rather than refused, and a
 * `kind` of nothing but unknown words filters nothing: the filter set is the
 * page's address (ADR-0051 decision 5), and an address that does not parse opens
 * the list rather than an error (`docs/tech/addresses.md`).
 *
 * A source id out of `int4` is dropped by the same rule, and it has to be
 * dropped *here*: the schema bounds the parameter's length but not the value of
 * each id in it, and an id that never reaches the SQL is one Postgres is never
 * asked to fit into an `int[]`.
 */
function queueFilters(query: ReviewQueueQuery, limit: number): QueueFilters {
  const words = (value: string | undefined): string[] => (value ? value.split(',') : []);
  return {
    q: query.q,
    sourceIds: query.source === undefined
      ? undefined
      : words(query.source).map(Number).filter(id => id >= 1 && id <= MAX_SOURCE_ID),
    kinds: words(query.kind).filter((k): k is QueueKind | WaitingSub => KIND_WORDS.has(k)),
    regionId: query.region,
    runId: query.run,
    showAside: query.aside === 'show',
    sort: query.sort === 'question' ? 'question' : 'date',
    cursor: query.cursor,
    limit,
  };
}

/**
 * The decisions waiting for a curator, scoped to what they cover.
 * GET /api/experiences/review/queue
 *   ?q=&source=&kind=&region=&run=&aside=&sort=&cursor=&limit=
 *   &keptOutOffset=&answeredWithdrawalsOffset=&refusedPartsOffset=
 *
 * Seven kinds of open question, and three lists that are not questions at all:
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
 *   was never a legitimate member of *Art Museums*, so not `former`; and the
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
 *   `POST /:id/publish` — writing the value — or `POST /:id/decline-held` —
 *   refusing it, writing nothing (#722). Either clears this pointer in
 *   response to a person, and only once nothing on the card is left open, so a
 *   card answered one row at a time keeps the rest findable. A later run
 *   proposing nothing clears it too, on its own.
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
 * `keptOut`, `answeredWithdrawals` and `refusedParts` are the exception to all of
 * it: those rows are answered, not waiting, and are carried here only because
 * nowhere else can show them — one at the level of an object a rule kept out, one
 * at the level of a point a curator answered and thereby left on no screen (#544),
 * one at the level of a point or work a curator turned down (#859).
 *
 * **The page is chosen before it is drawn** (ADR-0051 decision 2). The seven
 * questions are one list: `queryQueueKeys` orders every kind by the date of the
 * run that asked it, filters it, and takes one page of keys by keyset — so this
 * handler no longer pages anything, and the seven `<kind>Offset` parameters are
 * gone with the seven `LIMIT`s. What is left here is drawing the cards: the
 * page's keys are grouped by kind, and each statement below runs once, for the
 * ids of its own kind, or not at all. Each keeps the `ORDER BY` it had, and what
 * that orders is now its own array rather than anything a curator sees: `order`
 * is the page, in the one order across the kinds, and the arrays are a lookup by
 * id beside it. `total` and `facets` are counted over the union under the
 * filter, so the page no longer has to say "the first N of this kind, and there
 * may be more".
 * `keptOut`, `answeredWithdrawals` and `refusedParts` are outside all of that and
 * keep their own offsets: they are not open questions, carry no date to order the
 * union by, and are not in it. Two of the filters still reach them, as predicates of their own
 * on the object's row — the source chip and the search, because a curator
 * narrowing the queue to one source or looking for one object by name means the
 * whole page. The region, the run and the set-aside do not: a run is what a
 * question was asked by and these are answered, and neither list is counted in
 * the facets that the region chip states.
 */
export async function getReviewQueue(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  const isAdmin = req.user!.role === 'admin';
  const query = req.query as ReviewQueueQuery;
  const limit = Number(query.limit ?? QUEUE_PAGE_SIZE);
  const filters = queueFilters(query, limit);
  // The three lists that are not open questions keep an offset each, and need one
  // for the reason every kind used to: the page renders them in blocks of their
  // own, so a shared number would page one whenever a curator paged another.
  const offsets = {
    keptOut: query.keptOutOffset ?? 0,
    answeredWithdrawals: query.answeredWithdrawalsOffset ?? 0,
    refusedParts: query.refusedPartsOffset ?? 0,
  };

  // Those three ask for one row more than the page, so "is there another page" is
  // answered by the rows themselves rather than by a second count. The seven
  // questions do not: the keys phase pages them, and counts them — `total` and
  // the facets are counted under the filter the curator set, which is what lets
  // the page state a number it has actually counted.
  const pageSize = limit + 1;
  const paged = <T extends Record<string, unknown>>(rows: T[]) => ({
    items: rows.slice(0, limit).map(withDangerFields),
    hasMore: rows.length > limit,
  });

  // The rows span categories, so the unrestricted check correlates on each
  // row's own category rather than on the optional request filter.
  const scopeFilter = isAdmin
    ? 'TRUE'
    : `(${curatorUnrestrictedScopeExists('e.category_id')} OR EXISTS (
         SELECT 1 FROM experience_regions er
         JOIN curator_scoped_regions s ON s.id = er.region_id
         WHERE er.experience_id = e.id
       ))`;

  // The source chip, as a predicate on the row's own source. Redundant on the
  // seven kinds below — their ids come from the keys phase, which applied it
  // already — and load-bearing on the three lists that are not open questions and
  // are therefore not in that phase: without it a curator narrowing the queue to
  // one source would still be shown every other source's kept-out rows.
  //
  // Only bind what the SQL references. A placeholder that appears in the
  // parameter list but in no expression has no inferable type, and Postgres
  // refuses the whole statement with "could not determine data type".
  const params: unknown[] = [userId];
  let categoryFilter = '';
  if (filters.sourceIds?.length) {
    params.push(filters.sourceIds);
    categoryFilter = `AND e.category_id = ANY($${params.length}::int[])`;
  }

  // The search, on the same two lists and for the same reason: a curator looking
  // for one object by name has to find it wherever it is, and these two are the
  // only rows on the page the keys phase never sees. The escaping is
  // `likeParam`'s — the union's own — rather than a second spelling of it, so
  // `100%` means the same thing in all three statements.
  //
  // Bound onto a list of its own rather than onto `params`, by the rule above:
  // the seven card statements do not carry this predicate, and a parameter they
  // are sent but do not reference is one Postgres can infer no type for. It
  // refuses the whole statement then — which the mocked lane cannot see, so the
  // property is asserted instead ("binds no parameter the SQL does not
  // reference", with a search among its request shapes).
  const answeredParams = filters.q === undefined ? params : [...params, likeParam(filters.q)];
  const nameFilter = filters.q === undefined
    ? ''
    : `AND e.name ILIKE $${answeredParams.length} ESCAPE '\\'`;

  const { keys, nextCursor, total, facets } = await queryQueueKeys({ userId, isAdmin, filters });

  /** The ids of one class on this page. */
  const idsOf = (kind: QueueKind): number[] => keys.filter(k => k.kind === kind).map(k => k.id);
  /**
   * ...and of one sub-kind, which only a waiting row carries. The three gated
   * kinds are one key per object (ADR-0051 decision 2), so an object holding an
   * unread arrival and unread works is one question — and two cards, which is
   * what `subs` splits it back into here.
   */
  const waitingIds = (sub: WaitingSub): number[] => keys
    .filter(k => k.kind === 'waiting' && k.subs.includes(sub)).map(k => k.id);

  /**
   * One kind's cards, asked for only where the page named a row of that kind.
   *
   * A statement per empty list would be six round trips buying nothing: a page
   * of 25 keys is rarely more than two or three kinds. An id whose row the
   * statement's own `WHERE` rejects is simply absent, and the client skips a key
   * with no row — the two predicates are the same one restated, so that is a
   * race with a run, not a disagreement.
   *
   * Every kind carries the object fragment, so every kind goes through the same
   * danger mapping the reader-facing reads use — as do the three answered lists
   * through `paged` above: `in_danger` as a boolean and the listing's year as
   * `danger_since`, never the raw "Y 2003".
   */
  const hydrate = async (ids: number[], statement: () => Promise<QueryResult>) => (
    ids.length === 0 ? [] : (await statement()).rows.map(withDangerFields)
  );

  // What counts as `missing`, and why refused and unread rows are excluded:
  // the reasoning is on `missingOpenSql` (`reviewQueuePredicates.ts`).
  const missingIds = idsOf('missing');
  const missing = await hydrate(missingIds, () => pool.query(`${CURATOR_SCOPED_REGIONS_CTE}
    SELECT e.id, e.external_id, e.name, e.category_id, c.name AS category_name,
           ${lifecycleSelectSql()}, ${objectContextSelectSql()},
           'missing' AS kind, NULL::jsonb AS proposed
    FROM experiences e
    JOIN experience_categories c ON c.id = e.category_id
    WHERE ${missingOpenSql('e')}
      ${categoryFilter}
      AND ${scopeFilter}
      AND e.id = ANY($${params.length + 1}::int[])
    ORDER BY e.missing_since DESC, e.id
  `, [...params, missingIds]));

  // Ordered by id rather than by time: admission carries no date of its own,
  // and `updated_at` moves for every unrelated edit, so ordering by it would
  // shuffle the queue under a curator working through it. Stable beats fresh
  // here — the page is a list someone is walking down.
  //
  // What counts as `refused` and why an answered row leaves it: the reasoning
  // is on `refusedOpenSql` (`reviewQueuePredicates.ts`).
  //
  // Each of the four membership queues joins the membership the row's own
  // source brought — `m.source_id = e.category_id`, the equality the catalogue
  // check `membership-source-disagrees-with-row` asserts — rather than any
  // membership of the place. Today a place has one; the day #755 gives it two,
  // a card is per membership (ADR-0045 decision 7) and the queue is keyed on
  // it rather than on the place. Said in the join so that day cannot show one
  // source's refusal under another's heading, or the same held proposal twice.
  const refusedIds = idsOf('refused');
  const refused = await hydrate(refusedIds, () => pool.query(`${CURATOR_SCOPED_REGIONS_CTE}
    SELECT e.id, e.external_id, e.name, e.category_id, c.name AS category_name,
           m.admission_reason,
           ${lifecycleSelectSql()}, ${objectContextSelectSql()},
           'refused' AS kind, ${countedWorksSelectSql()},
           NULL::jsonb AS proposed
    FROM experiences e
    JOIN ${MEMBERSHIPS} m ON m.experience_id = e.id AND m.source_id = e.category_id
    JOIN experience_categories c ON c.id = e.category_id
    WHERE ${refusedOpenSql('m')}
      ${categoryFilter}
      AND ${scopeFilter}
      AND e.id = ANY($${params.length + 1}::int[])
    ORDER BY e.id
  `, [...params, refusedIds]));

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
           m.admission_reason, e.state_decided_at, e.state_note,
           ${lifecycleSelectSql()}, ${objectContextSelectSql()},
           'kept-out' AS kind, ${countedWorksSelectSql()},
           NULL::jsonb AS proposed
    FROM experiences e
    JOIN ${MEMBERSHIPS} m ON m.experience_id = e.id AND m.source_id = e.category_id
    JOIN experience_categories c ON c.id = e.category_id
    WHERE m.admission = 'refused'
      AND ${admissionPinnedSql('m')}
      ${categoryFilter}
      ${nameFilter}
      AND ${scopeFilter}
    ORDER BY e.state_decided_at DESC NULLS LAST, e.id
    LIMIT $${answeredParams.length + 1} OFFSET $${answeredParams.length + 2}
  `, [...answeredParams, pageSize, offsets.keptOut]);

  // A conflict is worth answering only while it is still the source's current
  // position, so the newest changeset row for the experience wins — and only
  // while the curator still claims the field. Accepting the source releases
  // that claim, which is what takes the item out of the queue: the changeset
  // row stays as a record of what the run did, so nothing else would.
  //
  // The claim key is usually the column name, but not always: editing only a
  // website claims `metadata.website`, which is no column at all. Hence the
  // map, and hence the fallback to the field's own name for the keys it does
  // not carry. Between the two sits the family lookup, for the per-part entries
  // of a column claimed whole: `nameLocal.ko` is protected by a claim on
  // `name_local` and by nothing a per-key name could match (#728). Each field
  // also says whether `accept-source` can write it — `location` and the rest
  // are shown but not offered, since a button that 409s would leave the item
  // unanswerable.
  //
  // Three lookups in one expression, built here rather than written out at each
  // of the two sites below: this is `claimKeyFor` in SQL, and the two runtimes
  // read the same two objects (`changeSet.ts`) so neither can drift into
  // protecting what the other asks about. `split_part` answers the whole name
  // where there is no dot, exactly as `field.split('.')[0]` does, so the family
  // is consulted for a bare name too and the map simply answers first; and the
  // family object deliberately does not carry `metadata`, whose claims are per key.
  // The COALESCE itself is `claimKeySql` (`reviewQueuePredicates.ts`), shared
  // with `reviewQueueKeys.ts`'s own `claimKey` — only the two placeholder
  // strings differ, since each statement binds `$keyMap`/`$family` its own way.
  const keyMapIdx = params.length + 1;
  const familyIdx = keyMapIdx + 1;
  const acceptableIdx = familyIdx + 1;
  const claimKeyFor = (field: string) => claimKeySql(field, `$${keyMapIdx}`, `$${familyIdx}`);

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
  const conflictIds = idsOf('conflict');
  const conflicts = await hydrate(conflictIds, () => pool.query(`${CURATOR_SCOPED_REGIONS_CTE}
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
                            AND log.details ? ${claimKeyFor(`f->>'field'`)}
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
                 AND e.curated_fields ? ${claimKeyFor(`f->>'field'`)}
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
      -- conflictChangeOpenSql (reviewQueuePredicates.ts) is the newest-row,
      -- landed-run test; its docblock has the reasoning for the staleness
      -- clause.
      WHERE ${conflictChangeOpenSql('e', 'ch', 'l')}
        ${categoryFilter}
        AND ${scopeFilter}
        -- Inside the DISTINCT ON rather than outside it, where the LIMIT used to
        -- sit: the pick is per experience, so narrowing to the page's ids first
        -- leaves the same newest changeset row per id and reads a handful of rows
        -- instead of every conflict in the catalogue.
        AND e.id = ANY($${acceptableIdx + 1}::int[])
      ORDER BY e.id, ch.id DESC
    ) q
    WHERE q.proposed IS NOT NULL
    ORDER BY q.id
  `, [...params, JSON.stringify(CURATED_KEY_BY_FIELD), JSON.stringify(CLAIM_KEY_BY_FAMILY),
    JSON.stringify([...ACCEPTABLE_FIELDS]), conflictIds]));

  // What counts as `arrival`: the reasoning is on `arrivalOpenSql`
  // (`reviewQueuePredicates.ts`).
  //
  // An arrival is a membership arriving (#822): the gate state and the
  // admission are the membership's, the source's observation is the row's.
  const arrivalIds = waitingIds('arrival');
  const arrivals = await hydrate(arrivalIds, () => pool.query(`${CURATOR_SCOPED_REGIONS_CTE}
    SELECT e.id, e.external_id, e.name, e.category_id, c.name AS category_name,
           m.curation_state, e.first_seen_sync_log_id AS sync_log_id,
           ${lifecycleSelectSql()}, ${objectContextSelectSql()},
           'arrival' AS kind, NULL::jsonb AS proposed
    FROM experiences e
    JOIN ${MEMBERSHIPS} m ON m.experience_id = e.id AND m.source_id = e.category_id
    JOIN experience_categories c ON c.id = e.category_id
    WHERE ${arrivalOpenSql('e', 'm')}
      AND ${scopeFilter} ${categoryFilter}
      AND e.id = ANY($${params.length + 1}::int[])
    ORDER BY e.first_seen_sync_log_id DESC NULLS LAST, e.id
  `, [...params, arrivalIds]));

  // held: an already-visible row whose newest content proposal was kept out
  // by the upsert's own gate (ADR-0025 § "A gated source may not overwrite
  // what a reader can already see", `experienceUpsert.ts`) rather than applied.
  //
  // The pointer is set for *any* refused proposal, not only a gate-held one:
  // `experienceUpsert.ts`'s `proposedAnything` fires equally for a field a curator
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
  // What counts as `held`: the reasoning is on `heldOpenSql`
  // (`reviewQueuePredicates.ts`).
  //
  // `POST /:id/publish` and `POST /:id/decline-held` are what clear this
  // pointer in response to a person — under the same staleness check, whenever
  // a curator's `expectedSyncLogId` matches what is stored (or, for a publish,
  // the call has nothing left to be stale about) — and only once nothing on
  // the card is left open, so answering one row of six leaves the other five
  // findable (#722). `experienceUpsert.ts` is the only other thing that ever clears
  // it, and only when a *later run* proposes nothing at all (the source came
  // back to what is stored). Answering a refusal at `POST /:id/admission` does not, even
  // though an override can publish the same row: admitting it says the object
  // belongs, not what a later proposal against it holds, and that stays a
  // separate question with its own card for a curator to answer through
  // `/publish`.
  //
  // Two halves to one card since ADR-0037: the object's own held fields
  // (`proposed`, off `changed_fields`) and the held fields of its parts
  // (`proposed_parts`, off the contents record — a place renamed, a work
  // re-attributed — resolved to the stored rows so the card can open them;
  // `heldPartsSelectSql` says how). A row is a card where either half holds
  // something, which is the pair `heldWaitingSql` counts by, so the panel's
  // number and the queue's cards agree.
  //
  // Both halves are scalar subqueries rather than a lateral join with a `GROUP
  // BY`, which is what the object's half used to be, and the change moves where
  // the empty case is decided. A lateral over `changed_fields` filtered on the
  // flag dropped a row with nothing held before any aggregate ran; a scalar
  // `jsonb_agg` over an empty set answers NULL instead, on a row the `WHERE`
  // has already admitted for its *other* half. So NULL here is ordinary — the
  // object's half of a card about a part, or the reverse — and the guard below
  // is what keeps a row with nothing on either half from rendering a card with
  // nothing on it, which is worse than no card. Load-bearing now, where it used
  // to be a floor; the neighbouring `conflict` kind's guard has always been.
  const heldIds = waitingIds('held');
  const held = await hydrate(heldIds, () => pool.query(`${CURATOR_SCOPED_REGIONS_CTE}
    SELECT * FROM (
      SELECT e.id, e.external_id, e.name, e.category_id, c.name AS category_name,
             ${lifecycleSelectSql()}, ${objectContextSelectSql()},
             ch.sync_log_id, 'held' AS kind,
             (SELECT jsonb_agg(f) FROM jsonb_array_elements(ch.changed_fields) AS f
               WHERE (f->>'held')::boolean
                 AND NOT ${heldFieldAnsweredSql('e.id')}) AS proposed,
             ${heldPartsSelectSql('ch', 'e')}
      FROM experiences e
      -- The pointer is the membership's (#822): the proposal was held for the
      -- source that made it, on the membership that source brought.
      JOIN ${MEMBERSHIPS} m ON m.experience_id = e.id AND m.source_id = e.category_id
      JOIN experience_categories c ON c.id = e.category_id
      JOIN experience_sync_changes ch ON ch.experience_id = e.id
                                     AND ch.sync_log_id = m.pending_change_sync_log_id
      WHERE m.pending_change_sync_log_id IS NOT NULL
        AND ${heldOpenSql('e', 'm', 'ch')}
        AND ${scopeFilter} ${categoryFilter}
        AND e.id = ANY($${params.length + 1}::int[])
    ) q WHERE (q.proposed IS NOT NULL OR q.proposed_parts IS NOT NULL)
    ORDER BY q.sync_log_id DESC, q.id
  `, [...params, heldIds]));

  // The two kinds that ask about what an object holds rather than about the
  // object, in their own module (`reviewQueueContents.ts`): they read a different
  // table, they carry the only per-row lists the queue returns, and this file had
  // reached the length the development guide says to split at.
  const queryContext = { scopeFilter, categoryFilter, params };
  const contentsIds = waitingIds('contents');
  const contents = await hydrate(
    contentsIds, () => queryContents({ ...queryContext, ids: contentsIds }),
  );
  const withdrawnIds = idsOf('withdrawn');
  const withdrawn = await hydrate(
    withdrawnIds, () => queryWithdrawn({ ...queryContext, ids: withdrawnIds }),
  );
  // The answered half of the one above, and the only list here that names a curator,
  // which is why it takes the log's scope predicate as well as the object's.
  const answeredWithdrawals = await queryAnsweredWithdrawals({
    ...queryContext,
    // Its own parameter list, carrying the search: `queryContext.params` is what
    // the seven card statements are sent, and they do not reference it.
    params: answeredParams,
    nameFilter,
    logScopeFilter,
    pageSize,
    offset: offsets.answeredWithdrawals,
  });

  // The parts a curator turned down (#859): the third list that is not an open
  // question, and the one ADR-0053 left owing. It names a curator too, so it
  // takes the log's scope predicate and the search on the same terms as the one
  // above.
  const refusedParts = await queryRefusedParts({
    ...queryContext,
    params: answeredParams,
    nameFilter,
    logScopeFilter,
    pageSize,
    offset: offsets.refusedParts,
  });

  const keptOutPage = paged(keptOut.rows);
  const answeredPage = paged(answeredWithdrawals.rows);
  const refusedPartsPage = paged(refusedParts.rows);

  // The arrays keep their names and their place at the top level — every reader of this
  // response indexes them by kind. What is new sits beside them: `order` is the page as
  // the keys phase chose it, which is the list the client actually draws (an array is
  // then a lookup by id, not an order of its own); `total` and `facets` are counted over
  // the union under the filter; and `paging` is the one cursor the seven kinds share,
  // beside the three offsets that are not part of it.
  res.json({
    missing,
    refused,
    keptOut: keptOutPage.items,
    conflicts,
    arrivals,
    held,
    contents,
    withdrawn,
    answeredWithdrawals: answeredPage.items,
    refusedParts: refusedPartsPage.items,
    limit,
    order: keys.map(k => ({
      kind: k.kind, id: k.id, askedAt: k.askedAt, runId: k.runId, subs: k.subs,
    })),
    total,
    facets,
    paging: {
      cursor: filters.cursor ?? null,
      nextCursor,
      keptOut: { offset: offsets.keptOut, hasMore: keptOutPage.hasMore },
      answeredWithdrawals: {
        offset: offsets.answeredWithdrawals, hasMore: answeredPage.hasMore,
      },
      refusedParts: {
        offset: offsets.refusedParts, hasMore: refusedPartsPage.hasMore,
      },
    },
  });
}
