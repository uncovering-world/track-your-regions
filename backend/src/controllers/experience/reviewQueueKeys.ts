/**
 * The review queue's open questions as one dated list of keys (ADR-0051).
 *
 * The queue is seven predicates over five tables, and until now it was also
 * seven statements, each with its own `LIMIT`/`OFFSET` and its own `ORDER BY`.
 * This is the other half of that shape: a `UNION ALL` of the same predicates
 * selecting nothing but the key of each question — its kind, the object it is
 * about, the run that asked it, the source, and, for the three gated kinds, the
 * sub-kinds the object holds — ordered and paged across all of them at once.
 * `reviewQueueController.ts` then hydrates the page's ids with the statements
 * that already know how to draw a card.
 *
 * **One statement, not seven and a merge.** The order is over the union, so a
 * page cannot be assembled from per-kind pages without reading all of them
 * whole — which is the read this replaces. The filters and the facet counts are
 * the same reason: a chip states what picking it would leave, which is a count
 * over the union under the other chips, and a client holding one page can
 * count nothing.
 *
 * **How a kind is dated** (ADR-0051 decision 1): every open question was asked
 * by a run, and a run has `completed_at`. `held` reads it through the
 * membership's `pending_change_sync_log_id`, `arrival` through the row's
 * `first_seen_sync_log_id`, `conflict` through the changeset row's own
 * `sync_log_id`; `contents` has no run pointer and is dated by the newest
 * pending part it holds, `withdrawn` by the newest point a run marked,
 * `missing` by the object's own `missing_since`. `refused` dates loosely and
 * says so: a refusal is written on the membership, which carries no run, so it
 * takes the arrival run's date and falls back to the membership's `updated_at`.
 *
 * **The predicates are the queue's, shared.** Every branch below composes the
 * same `reviewQueuePredicates.ts` function its hydration statement in
 * `reviewQueueController.ts` / `reviewQueueContents.ts` does — `missingOpenSql`,
 * `refusedOpenSql`, `arrivalOpenSql`, `heldOpenSql`, `contentsOpenSql`,
 * `withdrawnPointOpenSql`/`withdrawnContainerOpenSql`, `conflictChangeOpenSql`
 * — plus the same claim-key formula, `claimKeySql`. ADR-0051 names the cost of
 * the design as what makes a question open having two places to land in one
 * endpoint; #805 Task 5 closed the gap that left between them — one function
 * per predicate, called from both — which is why both live in this directory
 * and why the facet counts read this union rather than re-deriving it.
 *
 * Measured on the development catalogue (2026-09-07, 1 621 open questions in
 * admin scope) for a page of 25 with its facets, either order, with or without
 * a search, a region, a kind or a run on it: **115–130 ms**, against 590 ms
 * for the nine statements the endpoint sends today.
 *
 * That number had a story: counting the region facet by walking the region
 * tree cost 330 ms and, worse, took the statement's estimate to 112 711, past
 * this server's `jit_above_cost` of 100 000 — so PostgreSQL compiled 454
 * functions (~300 ms) for a query that ran in 120. Counting through the root
 * row placement already writes (see `facet_region`) removes the walk: the
 * estimate is 79 688, no JIT, and the facets are identical row for row.
 */

import { pool } from '../../db/index.js';
import { MEMBERSHIPS } from '../../db/membership.js';
import { CURATOR_SCOPED_REGIONS_CTE, curatorUnrestrictedScopeExists } from '../../middleware/auth.js';
import { offeredLinkSql, offeredLocationSql } from './experienceLifecycle.js';
import { CLAIM_KEY_BY_FAMILY, CURATED_KEY_BY_FIELD } from '../../services/sync/changeSet.js';
import {
  arrivalOpenSql, claimKeySql, conflictChangeOpenSql, contentsOpenSql, heldOpenSql,
  missingOpenSql, refusedOpenSql, withdrawnContainerOpenSql, withdrawnPointOpenSql,
} from './reviewQueuePredicates.js';

export type QueueKind = 'conflict' | 'waiting' | 'withdrawn' | 'refused' | 'missing';
export type WaitingSub = 'arrival' | 'held' | 'contents';

/**
 * The class order: what a curator works down when they sort by question rather
 * than by date. A disagreement first, because it is the only kind where the
 * catalogue is actively saying two things; then what is waiting to be seen,
 * then what has left, then the two verdicts a rule already took.
 */
export const KIND_RANK: Record<QueueKind, number> = {
  conflict: 1, waiting: 2, withdrawn: 3, refused: 4, missing: 5,
};

/** The words a `kind` chip may carry, and the only ones. Exported because the
 *  controller drops anything else out of the request before it gets here. */
export const QUEUE_KINDS = Object.keys(KIND_RANK) as QueueKind[];
export const WAITING_SUBS: WaitingSub[] = ['arrival', 'held', 'contents'];

export interface QueueFilters {
  q?: string;
  sourceIds?: number[];
  /** `arrival` | `held` | `contents` select waiting rows carrying that sub-kind. */
  kinds?: Array<QueueKind | WaitingSub>;
  /** The subtree of that region, or the rows in no region at all. */
  regionId?: number | 'none';
  runId?: number;
  showAside?: boolean;
  sort: 'date' | 'question';
  cursor?: string;
  limit: number;
}

export interface QueueKey {
  kind: QueueKind;
  id: number;
  askedAt: string | null;
  runId: number | null;
  sourceId: number;
  subs: WaitingSub[];
}

export interface QueueFacets {
  kind: Array<{ kind: QueueKind | WaitingSub; count: number }>;
  source: Array<{ id: number; name: string; count: number }>;
  /**
   * `id` null is the unplaced bucket: keys with no region row at all.
   *
   * `worldView` is the world view this root is a root of — null on the unplaced
   * row, which is in none. A name does not identify a root on its own: two of
   * them are called Europe (world views 2 and 5), so the control needs
   * something to tell them apart with.
   */
  region: Array<{ id: number | null; name: string; worldView: string | null; count: number }>;
  /**
   * The runs with open questions, counted **before** the set-aside exclusion
   * and each saying whether this curator set it aside: a batch that is hidden
   * is exactly the one the chip has to name, with its number, or there is no
   * way back to it. The search still narrows this list, like every other
   * facet. `completedAt` is null for a run still in flight.
   */
  run: Array<{
    id: number; sourceId: number; completedAt: string | null; count: number; setAside: boolean;
  }>;
  /** How many runs this curator has set aside — the unit the chip names. */
  setAside: { batches: number };
}

interface Cursor { askedAt: string | null; rank: number; id: number }

/** The curator whose scope and set-aside rows the statement reads: always `$1`. */
const USER_ID = '$1';

export function encodeCursor(k: Cursor): string {
  return Buffer.from(JSON.stringify(k)).toString('base64url');
}

/**
 * The cursor as it was written, or null for anything else.
 *
 * A cursor is a query parameter, so it arrives from wherever the reader's
 * address bar has been. An unreadable one opens the first page rather than an
 * error (`docs/tech/addresses.md`: a parameter that does not parse degrades
 * silently), and this returns the null that says so.
 */
export function decodeCursor(s: string): Cursor | null {
  try {
    const raw: unknown = JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
    if (typeof raw !== 'object' || raw === null) return null;
    const { askedAt, rank, id } = raw as Record<string, unknown>;
    if (!Number.isInteger(rank) || !Number.isInteger(id)) return null;
    // A date the database will refuse is refused here instead: the value is
    // bound as `$n::timestamptz`, so `{"askedAt":"garbage"}` in someone's
    // address bar would be a 500 rather than the first page.
    if (askedAt !== null && (typeof askedAt !== 'string' || Number.isNaN(Date.parse(askedAt)))) {
      return null;
    }
    return { askedAt: askedAt as string | null, rank: rank as number, id: id as number };
  } catch {
    return null;
  }
}

/**
 * A conflict: the newest changeset row still arguing with a claim the curator
 * holds. `reviewQueueController.ts` § conflicts is the authority — the
 * `DISTINCT ON`, the landed-changeset clause that stops a silent agreement
 * from looking like a standing disagreement, and the by-value refusal test.
 *
 * The claim test sits **outside** the `DISTINCT ON`, where the card asks it as
 * `WHERE q.proposed IS NOT NULL`: the newest changeset row is chosen first, and
 * only then asked whether anything on it is still open. Asked in the inner
 * `WHERE` it would be a different question — an older row whose field is
 * unanswered would win the pick and raise a card the queue does not have.
 * Aksum is that shape today: its newest proposal was refused by value on
 * 2026-08-14, so it is the one candidate row and it raises no card.
 */
function conflictKeysSql(scopeFilter: string, claimKey: (field: string) => string): string {
  return `
    SELECT 'conflict'::text AS kind, ${KIND_RANK.conflict} AS rank, q.id, q.name,
           q.category_id AS source_id, q.sync_log_id AS run_id, q.completed_at AS asked_at,
           ARRAY[]::text[] AS subs
    FROM (
      SELECT DISTINCT ON (e.id) e.id, e.name, e.category_id, e.curated_fields,
             ch.changed_fields, ch.sync_log_id, l.completed_at
      FROM experience_sync_changes ch
      JOIN experiences e ON e.id = ch.experience_id
      JOIN experience_sync_logs l ON l.id = ch.sync_log_id
      WHERE ${conflictChangeOpenSql('e', 'ch', 'l')}
        AND ${scopeFilter}
      ORDER BY e.id, ch.id DESC
    ) q
    WHERE EXISTS (
      SELECT 1 FROM jsonb_array_elements(q.changed_fields) f
      WHERE (f->>'curatedConflict')::boolean
        AND q.curated_fields ? ${claimKey("f->>'field'")}
        AND NOT EXISTS (SELECT 1 FROM experience_conflict_decisions d
                        WHERE d.experience_id = q.id AND d.field = f->>'field'
                          AND d.declined = COALESCE(f->'new', 'null'::jsonb)))`;
}

/** An arrival: a membership from a gated source nobody has passed (ADR-0025). */
function arrivalKeysSql(scopeFilter: string): string {
  return `
        SELECT e.id, e.name, e.category_id, e.first_seen_sync_log_id AS run_id,
               l.completed_at AS asked_at, 'arrival'::text AS sub
        FROM experiences e
        JOIN ${MEMBERSHIPS} m ON m.experience_id = e.id AND m.source_id = e.category_id
        LEFT JOIN experience_sync_logs l ON l.id = e.first_seen_sync_log_id
        WHERE ${arrivalOpenSql('e', 'm')}
          AND ${scopeFilter}`;
}

/**
 * A held proposal: a visible row whose newest content proposal the gate kept
 * out. The join to the log is what the card's `pending_change_sync_log_id IS
 * NOT NULL` says, and it is also where the question's date comes from.
 */
function heldKeysSql(scopeFilter: string): string {
  return `
        SELECT e.id, e.name, e.category_id, m.pending_change_sync_log_id,
               l.completed_at, 'held'
        FROM experiences e
        JOIN ${MEMBERSHIPS} m ON m.experience_id = e.id AND m.source_id = e.category_id
        JOIN experience_sync_logs l ON l.id = m.pending_change_sync_log_id
        JOIN experience_sync_changes ch ON ch.experience_id = e.id
                                       AND ch.sync_log_id = m.pending_change_sync_log_id
        WHERE ${heldOpenSql('e', 'm', 'ch')}
          AND ${scopeFilter}`;
}

/**
 * Unread contents: a visible row holding pending points or pending works
 * (`reviewQueueContents.ts` § queryContents). No run pointer exists for it, so
 * the date is the newest such part's own — the row a run wrote when it brought
 * it. `GREATEST` skips a NULL, so a card holding only works is dated by the
 * works.
 */
function contentsKeysSql(scopeFilter: string): string {
  return `
        SELECT e.id, e.name, e.category_id, NULL, GREATEST(
                 (SELECT max(el.created_at) FROM experience_locations el
                   WHERE el.experience_id = e.id AND el.curation_state = 'pending'
                     AND ${offeredLocationSql('el')}),
                 (SELECT max(et.created_at) FROM experience_treasures et
                    JOIN treasures t ON t.id = et.treasure_id
                   WHERE et.experience_id = e.id AND ${offeredLinkSql('et')}
                     AND (et.curation_state = 'pending' OR t.curation_state = 'pending'))
               ), 'contents'
        FROM experiences e
        WHERE ${contentsOpenSql('e')}
          AND ${scopeFilter}`;
}

/**
 * The three gated kinds as one row per object, dated by the newest of them
 * (ADR-0051 decision 2): an object holding an unread arrival *and* unread works
 * is one question in either order, and its key stays `waiting:<id>` across a
 * refetch. `subs` says which of the three it holds, which is what the sub-kind
 * chips filter on and what the card's headings are drawn from.
 */
function waitingKeysSql(scopeFilter: string): string {
  return `
    SELECT 'waiting', ${KIND_RANK.waiting}, g.id, g.name, g.category_id,
           g.run_id, g.asked_at, g.subs
    FROM (
      -- The newest sub-kind's run, preferring one that names a run at all:
      -- unread contents have no run pointer, so a place holding contents and a
      -- held proposal would otherwise be dated by the contents and filed under
      -- no run, dropping it out of the run chip that its held half belongs to.
      -- DISTINCT because two changeset rows under one run would otherwise put
      -- 'held' in the list twice, and the sub-kinds are a set.
      SELECT id, name, category_id,
             (array_agg(run_id ORDER BY (run_id IS NULL), asked_at DESC NULLS LAST))[1] AS run_id,
             max(asked_at) AS asked_at,
             array_agg(DISTINCT sub) AS subs
      FROM (
        ${arrivalKeysSql(scopeFilter)}
        UNION ALL
        ${heldKeysSql(scopeFilter)}
        UNION ALL
        ${contentsKeysSql(scopeFilter)}
      ) gated
      GROUP BY id, name, category_id
    ) g`;
}

/**
 * The points a run stopped offering, one row per container
 * (`reviewQueueContents.ts` § queryWithdrawn). What counts as open for a
 * point is `withdrawnPointOpenSql`'s reasoning (`reviewQueuePredicates.ts`).
 */
function withdrawnKeysSql(scopeFilter: string): string {
  return `
    SELECT 'withdrawn', ${KIND_RANK.withdrawn}, e.id, e.name, e.category_id, NULL,
           max(el.missing_since), ARRAY[]::text[]
    FROM experience_locations el
    JOIN experiences e ON e.id = el.experience_id
    WHERE ${withdrawnPointOpenSql('el')}
      AND ${withdrawnContainerOpenSql('e')}
      AND ${scopeFilter}
    GROUP BY e.id, e.name, e.category_id`;
}

/**
 * A rule's refusal nobody has answered, and the object a run stopped finding.
 * Both draw the same predicates the controller's cards do (`refusedOpenSql`,
 * `missingOpenSql`); the refusal's date is the one loose one in the list, and
 * ADR-0051 names it rather than leaving the kind out of the order.
 */
function refusedKeysSql(scopeFilter: string): string {
  return `
    SELECT 'refused', ${KIND_RANK.refused}, e.id, e.name, e.category_id,
           e.first_seen_sync_log_id, COALESCE(l.completed_at, m.updated_at), ARRAY[]::text[]
    FROM experiences e
    JOIN ${MEMBERSHIPS} m ON m.experience_id = e.id AND m.source_id = e.category_id
    LEFT JOIN experience_sync_logs l ON l.id = e.first_seen_sync_log_id
    WHERE ${refusedOpenSql('m')}
      AND ${scopeFilter}`;
}

function missingKeysSql(scopeFilter: string): string {
  return `
    SELECT 'missing', ${KIND_RANK.missing}, e.id, e.name, e.category_id, NULL,
           e.missing_since, ARRAY[]::text[]
    FROM experiences e
    WHERE ${missingOpenSql('e')}
      AND ${scopeFilter}`;
}

/** The order, over the union's own columns. `prefix` qualifies them for `json_agg`. */
function orderSql(sort: 'date' | 'question', prefix = ''): string {
  const date = `COALESCE(${prefix}asked_at, '-infinity') DESC`;
  return sort === 'date'
    ? `${date}, ${prefix}rank, ${prefix}id`
    : `${prefix}rank, ${date}, ${prefix}id`;
}

/**
 * The keyset predicate: everything the order places after the cursor's row.
 *
 * Written as its three cases rather than as a row comparison, because the two
 * orders mix directions — the date descends while the rank and the id ascend —
 * and `(a, b, c) < (x, y, z)` can only compare them all the same way. `NULL`
 * asked_at is `-infinity` on both sides, so a question with no date sorts last
 * in the date order and pages like any other.
 */
function cursorSql(sort: 'date' | 'question', at: string, rank: string, id: string): string {
  const stored = `COALESCE(asked_at, '-infinity')`;
  const given = `COALESCE(${at}::timestamptz, '-infinity')`;
  return sort === 'date'
    ? `(${stored} < ${given}
        OR (${stored} = ${given} AND rank > ${rank})
        OR (${stored} = ${given} AND rank = ${rank} AND id > ${id}))`
    : `(rank > ${rank}
        OR (rank = ${rank} AND ${stored} < ${given})
        OR (rank = ${rank} AND ${stored} = ${given} AND id > ${id}))`;
}

/**
 * A search reaches the database as one parameter, its wildcards escaped.
 *
 * A curator typing `100%` is looking for a name with a per-cent sign in it, not
 * for every name; the backslash is escaped too, or escaping the other two would
 * be undone by a name that ends in one.
 *
 * Exported because the search reaches three statements and not one: the union
 * here, and the two answered lists that are outside it
 * (`reviewQueueController.ts` § keptOut, `reviewQueueContents.ts` §
 * queryAnsweredWithdrawals). A second spelling of the escaping is how they
 * would come to disagree about what `100%` means.
 */
export function likeParam(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => '\\'.concat(c))}%`;
}

interface Bound {
  source: string;
  kind: string;
  region: string;
  run: string;
  search: string;
  aside: string;
  cursor: string;
  regionCte: string;
  limit: string;
}

/** Every filter as a predicate over `scoped k`, with its values bound. */
function boundFilters(filters: QueueFilters, bind: (value: unknown) => string): Bound {
  const kinds = filters.kinds ?? [];
  const top = kinds.filter(k => (QUEUE_KINDS as string[]).includes(k));
  const subs = kinds.filter(k => (WAITING_SUBS as string[]).includes(k));
  const cursor = filters.cursor === undefined ? null : decodeCursor(filters.cursor);
  const region = regionFilter(filters.regionId, bind);
  return {
    source: filters.sourceIds?.length
      ? `k.source_id = ANY(${bind(filters.sourceIds)}::int[])` : 'TRUE',
    // Both arrays, always, when a kind chip is set: the five top kinds are
    // matched by name and the three sub-kinds against a waiting row's `subs`,
    // and either list may be empty without the other losing its meaning.
    kind: kinds.length
      ? `(k.kind = ANY(${bind(top)}::text[])
          OR (k.kind = 'waiting' AND k.subs && ${bind(subs)}::text[]))` : 'TRUE',
    region: region.predicate,
    regionCte: region.cte,
    run: filters.runId === undefined ? 'TRUE' : `k.run_id = ${bind(filters.runId)}`,
    search: filters.q === undefined ? 'TRUE' : `k.name ILIKE ${bind(likeParam(filters.q))} ESCAPE '\\'`,
    aside: filters.showAside
      ? 'TRUE'
      : `NOT EXISTS (SELECT 1 FROM curator_queue_set_aside sa
                      WHERE sa.user_id = ${USER_ID} AND sa.sync_log_id = k.run_id)`,
    cursor: cursor === null
      ? 'TRUE'
      : cursorSql(filters.sort, bind(cursor.askedAt), bind(cursor.rank), bind(cursor.id)),
    limit: bind(filters.limit + 1),
  };
}

/**
 * The region filter, and the walk it needs.
 *
 * A region chip means the region and everything under it — a curator picking
 * Europe means the sites in France — so the subtree is walked rather than
 * matched. "Unplaced" is the absence of any assignment at all, which is 28
 * objects on the development catalogue today: a control that could not name
 * them would hide them from every curator who touched the region chip.
 */
function regionFilter(
  regionId: number | 'none' | undefined,
  bind: (value: unknown) => string,
): { predicate: string; cte: string } {
  if (regionId === 'none') {
    return {
      predicate: 'NOT EXISTS (SELECT 1 FROM experience_regions er WHERE er.experience_id = k.id)',
      cte: '',
    };
  }
  if (regionId === undefined) return { predicate: 'TRUE', cte: '' };
  return {
    predicate: `EXISTS (SELECT 1 FROM experience_regions er
                         JOIN region_subtree rs ON rs.id = er.region_id
                        WHERE er.experience_id = k.id)`,
    cte: `
, region_subtree AS (
    SELECT r.id FROM regions r WHERE r.id = ${bind(regionId)}
    UNION
    SELECT r.id FROM regions r JOIN region_subtree p ON r.parent_region_id = p.id
  )`,
  };
}

/**
 * The regions a facet may name: the roots of the public world views plus
 * whatever region this curator is assigned — an assignment is what a
 * region-scoped curator's whole queue is about, so it is offered as a chip
 * even where it is not a root of anything public.
 *
 * Each root carries the world view it is a root *of*, because the name alone
 * does not identify it: the development catalogue offers two roots called
 * Europe, one in the Administrative world view and one in Wikivoyage Regions,
 * and a chip listing the bare name would ask a curator to pick between two
 * identical rows. The control shows the world view only where a name repeats
 * (Task 10), so this is a fact the chip needs, not a label it must print.
 */
const REGION_ROOTS_CTE = `
, region_roots AS (
    SELECT r.id, r.name, w.name AS world_view FROM regions r
    JOIN world_views w ON w.id = r.world_view_id
    WHERE r.parent_region_id IS NULL AND w.is_public
    UNION
    SELECT r.id, r.name, w.name AS world_view FROM curator_assignments ca
    JOIN regions r ON r.id = ca.region_id
    JOIN world_views w ON w.id = r.world_view_id
    WHERE ca.user_id = ${USER_ID} AND ca.scope_type = 'region'
  )`;

/** The five facet aggregates, each under every filter but its own. */
function facetsSql(f: Bound): string {
  return `
, facet_kind AS (
    SELECT v.value, count(*)::int AS count
    FROM scoped k
    CROSS JOIN LATERAL unnest(CASE WHEN k.kind = 'waiting' THEN k.subs ELSE ARRAY[k.kind] END) AS v(value)
    WHERE ${f.source} AND ${f.region} AND ${f.run}
    GROUP BY v.value
  )
, facet_source AS (
    -- Every source, counted or not, which is facet_region's shape below and
    -- for the same reason: a chip states what picking it would leave, and a
    -- source whose count under the other chips is zero would otherwise drop out
    -- of the menu that a curator picked it in — leaving a filter they can see
    -- the effect of and cannot untick. Dimmed at 0 instead.
    SELECT cat.id, cat.name, COALESCE(counted.n, 0) AS count
    FROM experience_categories cat
    LEFT JOIN (
      SELECT k.source_id, count(*)::int AS n
      FROM scoped k
      WHERE ${f.kind} AND ${f.region} AND ${f.run}
      GROUP BY k.source_id
    ) counted ON counted.source_id = cat.id
  )
, facet_region AS (
    -- Counted through the root's own assignment row rather than by walking the
    -- tree: placement propagates a location's region to every ancestor
    -- (assignAncestors, step 3 of regionAssignmentService.ts, denormalised
    -- into experience_regions by step 4), so a placed object carries a row for
    -- its root and the count is a join. That is a dependency on the placement
    -- writer, and it is confined to this count: the region *filter* walks
    -- region_subtree itself, so what a curator filters by does not rest on
    -- the propagation having run. Walking here instead cost 330 ms and tipped
    -- the statement past the server's JIT threshold — see the note at the top.
    SELECT rr.id, rr.name, rr.world_view, COALESCE(counted.n, 0) AS count
    FROM region_roots rr
    LEFT JOIN (
      SELECT er.region_id AS root_id, count(*)::int AS n
      FROM scoped k
      JOIN experience_regions er ON er.experience_id = k.id
      JOIN region_roots roots ON roots.id = er.region_id
      WHERE ${f.source} AND ${f.kind} AND ${f.run}
      GROUP BY er.region_id
    ) counted ON counted.root_id = rr.id
    UNION ALL
    SELECT NULL, 'Unplaced', NULL, count(*)::int
    FROM scoped k
    WHERE ${f.source} AND ${f.kind} AND ${f.run}
      AND NOT EXISTS (SELECT 1 FROM experience_regions er WHERE er.experience_id = k.id)
  )
, facet_run AS (
    -- Over searched rather than scoped: a run this curator set aside is the
    -- one chip that must still be listed, with its count, or the batch has no
    -- way back. The flag is read from the table for the same reason — scoped
    -- has already dropped those rows, so anything computed from it would say
    -- false about every run in the default view.
    SELECT k.run_id AS id, l.category_id AS source_id, l.completed_at,
           count(*)::int AS count,
           EXISTS (SELECT 1 FROM curator_queue_set_aside sa
                    WHERE sa.user_id = ${USER_ID} AND sa.sync_log_id = k.run_id) AS set_aside
    FROM searched k
    JOIN experience_sync_logs l ON l.id = k.run_id
    WHERE ${f.source} AND ${f.kind} AND ${f.region}
    GROUP BY k.run_id, l.category_id, l.completed_at
  )
, aside_counts AS (
    -- Batches, and only batches: the unit a curator set aside is the run
    -- (ADR-0051 decision 4), and it is what the chip names. A count of the rows
    -- behind them was returned beside it and read by nobody.
    SELECT count(DISTINCT k.run_id)::int AS batches
    FROM keys k
    WHERE EXISTS (SELECT 1 FROM curator_queue_set_aside sa
                   WHERE sa.user_id = ${USER_ID} AND sa.sync_log_id = k.run_id)
  )`;
}

/** The page, the total under the filter, and the facets, as one row of JSON. */
function resultSql(f: Bound, sort: 'date' | 'question'): string {
  return `
SELECT (SELECT json_agg(p ORDER BY ${orderSql(sort, 'p.')}) FROM page_rows p) AS page,
       (SELECT count(*)::int FROM scoped k
         WHERE ${f.source} AND ${f.kind} AND ${f.region} AND ${f.run}) AS total,
       json_build_object(
         'kind', (SELECT COALESCE(json_agg(json_build_object('kind', x.value, 'count', x.count)
                                           ORDER BY x.count DESC, x.value), '[]'::json) FROM facet_kind x),
         'source', (SELECT COALESCE(json_agg(json_build_object('id', x.id, 'name', x.name, 'count', x.count)
                                             ORDER BY x.count DESC, x.name), '[]'::json) FROM facet_source x),
         'region', (SELECT COALESCE(json_agg(json_build_object('id', x.id, 'name', x.name,
                                                              'worldView', x.world_view, 'count', x.count)
                                             ORDER BY x.count DESC, x.name), '[]'::json) FROM facet_region x),
         'run', (SELECT COALESCE(json_agg(json_build_object('id', x.id, 'sourceId', x.source_id,
                                                            'completedAt', x.completed_at,
                                                            'count', x.count, 'setAside', x.set_aside)
                                          ORDER BY x.completed_at DESC NULLS LAST), '[]'::json) FROM facet_run x),
         'setAside', (SELECT json_build_object('batches', x.batches) FROM aside_counts x)
       ) AS facets`;
}

/** A timestamp as the driver hands it over: `json_agg`'s text, or a `Date`. */
type StoredDate = string | Date | null;

interface KeyRow {
  kind: QueueKind;
  rank: number;
  id: number;
  asked_at: StoredDate;
  run_id: number | null;
  source_id: number;
  subs: WaitingSub[] | null;
}

/**
 * One ISO string for a date, for the caller.
 *
 * The page arrives as `json_agg`, so a timestamp is already a string —
 * `2026-09-05T19:01:19.748023+00:00`, not the `Date` a plain column read would
 * give. Both are normalised here so a day heading is drawn from the same text
 * whichever way the row was read.
 */
function isoOrNull(value: StoredDate): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * The date a cursor carries: the row's own text, at the precision the database
 * stores it.
 *
 * Not `isoOrNull`, and this is the whole of the difference: `toISOString`
 * truncates to milliseconds, so a cursor built from
 * `19:01:19.748023+00:00` says `19:01:19.748Z`, which is *smaller* than the
 * row it came from. The next page asks for rows strictly older than that, and
 * every key sharing the truncated instant is skipped — 1 255 of them share
 * run 98's `completed_at` today, so the page boundary would fall inside that
 * group and silently drop its tail. A `Date` (a plain column read) has only
 * milliseconds to give and is handed on as it is.
 */
function cursorDate(value: StoredDate): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function toKey(row: KeyRow): QueueKey {
  return {
    kind: row.kind,
    id: row.id,
    askedAt: isoOrNull(row.asked_at),
    runId: row.run_id,
    sourceId: row.source_id,
    subs: row.subs ?? [],
  };
}

const EMPTY_FACETS: QueueFacets = {
  kind: [], source: [], region: [], run: [], setAside: { batches: 0 },
};

/**
 * The keys of every open question this curator may be asked, filtered, ordered
 * and paged, with the count each chip would leave.
 */
export async function queryQueueKeys(
  { userId, isAdmin, filters }: { userId: number; isAdmin: boolean; filters: QueueFilters },
): Promise<{ keys: QueueKey[]; nextCursor: string | null; total: number; facets: QueueFacets }> {
  const params: unknown[] = [userId];
  const bind = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };

  // The same scope the seven statements carry, correlated on each row's own
  // category rather than on a request filter: the union spans sources.
  const scopeFilter = isAdmin
    ? 'TRUE'
    : `(${curatorUnrestrictedScopeExists('e.category_id')} OR EXISTS (
         SELECT 1 FROM experience_regions er
         JOIN curator_scoped_regions s ON s.id = er.region_id
         WHERE er.experience_id = e.id
       ))`;
  const keyMap = bind(JSON.stringify(CURATED_KEY_BY_FIELD));
  const family = bind(JSON.stringify(CLAIM_KEY_BY_FAMILY));
  const claimKey = (field: string) => claimKeySql(field, keyMap, family);
  const f = boundFilters(filters, bind);

  const sql = `${CURATOR_SCOPED_REGIONS_CTE}
, keys AS (${conflictKeysSql(scopeFilter, claimKey)}
    UNION ALL${waitingKeysSql(scopeFilter)}
    UNION ALL${withdrawnKeysSql(scopeFilter)}
    UNION ALL${refusedKeysSql(scopeFilter)}
    UNION ALL${missingKeysSql(scopeFilter)}
  )
, searched AS (
    SELECT k.kind, k.rank, k.id, k.name, k.source_id, k.run_id, k.asked_at, k.subs
    FROM keys k
    WHERE ${f.search}
  )
, scoped AS (
    SELECT k.* FROM searched k WHERE ${f.aside}
  )${f.regionCte}${REGION_ROOTS_CTE}
, page_rows AS (
    SELECT k.kind, k.rank, k.id, k.source_id, k.run_id, k.asked_at, k.subs
    FROM scoped k
    WHERE ${f.source} AND ${f.kind} AND ${f.region} AND ${f.run} AND ${f.cursor}
    ORDER BY ${orderSql(filters.sort)}
    LIMIT ${f.limit}
  )${facetsSql(f)}${resultSql(f, filters.sort)}`;

  const { rows } = await pool.query(sql, params);
  const row = (rows[0] ?? {}) as { page?: KeyRow[] | null; total?: number; facets?: Partial<QueueFacets> | null };
  const page = row.page ?? [];
  // One row more than the page was asked for, so "is there another page" is
  // answered by the rows rather than by a second count.
  const hasMore = page.length > filters.limit;
  const pageRows = page.slice(0, filters.limit);
  const keys = pageRows.map(toKey);
  // Built from the row rather than from the key: the cursor keeps the stored
  // text of the timestamp, which `askedAt` has already rounded to milliseconds.
  const last = pageRows[pageRows.length - 1];
  const facets = row.facets ?? {};
  return {
    keys,
    nextCursor: hasMore && last
      ? encodeCursor({
        askedAt: cursorDate(last.asked_at), rank: last.rank ?? KIND_RANK[last.kind], id: last.id,
      })
      : null,
    total: Number(row.total ?? 0),
    facets: { ...EMPTY_FACETS, ...facets },
  };
}
