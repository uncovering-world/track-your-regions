/**
 * The keys union: what the one statement says, held to the promises ADR-0051
 * makes about it.
 *
 * The pool is a mock here, so these read the SQL rather than its answer — the
 * shape of the order, which filter each facet ignores, that the search reaches
 * the database as a parameter and never as text. What a mock cannot see (a
 * mistyped column, a join that returns the wrong rows) is the live probe's job,
 * and the module's own doc comment records what it measured.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/index.js', () => ({ pool: { query: vi.fn() } }));

import { pool } from '../../db/index.js';
import {
  queryQueueKeys, encodeCursor, decodeCursor, KIND_RANK,
} from './reviewQueueKeys.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;
const base = { userId: 7, isAdmin: false, filters: { sort: 'date' as const, limit: 25 } };

/** An empty page, in the shape the statement returns it. */
function empty() {
  return { rows: [{ page: null, total: 0, facets: null }] };
}

function lastCall(): [string, unknown[]] {
  const call = mockedQuery.mock.calls[0];
  if (!call) throw new Error('the statement was never sent');
  return [String(call[0]), call[1] as unknown[]];
}

/** The text of one CTE, from its own name to the next one's. */
function between(sql: string, from: string, to: string): string {
  const start = sql.indexOf(from);
  const end = sql.indexOf(to);
  expect(start, `no ${from} in the statement`).toBeGreaterThan(-1);
  expect(end, `no ${to} in the statement`).toBeGreaterThan(start);
  return sql.slice(start, end);
}

describe('queryQueueKeys', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedQuery.mockResolvedValue(empty());
  });

  it('dates every kind by the run that asked it', async () => {
    await queryQueueKeys(base);
    const [sql] = lastCall();
    expect(sql).toContain("'waiting'");          // the three gated kinds collapse to one row per object

    // Each kind's own date expression, so a branch that stopped reading its
    // run — and started reading the neighbouring branch's column, or nothing —
    // fails here rather than reordering the queue quietly.
    const conflict = between(sql, "SELECT 'conflict'::text", "SELECT 'waiting'");
    expect(conflict).toContain('q.completed_at AS asked_at');   // off the changeset row's own run
    expect(conflict).toContain('JOIN experience_sync_logs l ON l.id = ch.sync_log_id');
    const waiting = between(sql, "SELECT 'waiting'", "SELECT 'withdrawn'");
    expect(waiting).toContain("l.completed_at AS asked_at, 'arrival'::text AS sub");
    expect(waiting).toContain("l.completed_at, 'held'");
    expect(waiting).toContain('JOIN experience_sync_logs l ON l.id = m.pending_change_sync_log_id');
    const contents = between(sql, 'GREATEST(', "), 'contents'");
    expect(contents).toContain('max(el.created_at)');
    expect(contents).toContain('max(et.created_at)');
    const withdrawn = between(sql, "SELECT 'withdrawn'", "SELECT 'refused'");
    expect(withdrawn).toContain('max(el.missing_since)');
    const refused = between(sql, "SELECT 'refused'", "SELECT 'missing'");
    expect(refused).toContain('COALESCE(l.completed_at, m.updated_at)');
    const missing = between(sql, "SELECT 'missing'", ', searched AS (');
    expect(missing).toContain('e.missing_since, ARRAY[]::text[]');
  });

  it('takes a waiting row\'s run from the newest sub-kind that names one', async () => {
    await queryQueueKeys(base);
    const [sql] = lastCall();
    // Unread contents carry no run pointer, so the newest-first pick alone
    // would file a place holding contents *and* a held proposal under no run
    // at all, and the run chip its held half belongs to would not list it.
    expect(sql).toContain('array_agg(run_id ORDER BY (run_id IS NULL), asked_at DESC NULLS LAST)');
    // A set, not a bag: two changeset rows under one run must not say 'held' twice.
    expect(sql).toContain('array_agg(DISTINCT sub) AS subs');
  });

  it('carries the scope filter into every branch of the union', async () => {
    await queryQueueKeys(base);
    // Seven: conflict, arrival, held, contents, withdrawn, refused, missing.
    // The scope CTE's own join reads `r.parent_region_id = s.id`, so it is not
    // counted here, and dropping the predicate from one branch fails this.
    expect(lastCall()[0].match(/JOIN curator_scoped_regions s ON s\.id = er\.region_id/g))
      .toHaveLength(7);
  });

  it('asks whether a conflict is still open of the newest changeset row, not of any row', async () => {
    await queryQueueKeys(base);
    const [sql] = lastCall();
    const conflict = sql.slice(sql.indexOf("SELECT 'conflict'::text"), sql.indexOf('UNION ALL'));
    // The card picks the newest row and then asks whether anything on it is
    // unanswered. Asked inside the DISTINCT ON, an older row with an
    // unanswered field would win the pick and raise a card the queue has not.
    expect(conflict.indexOf('experience_conflict_decisions'))
      .toBeGreaterThan(conflict.indexOf('ORDER BY e.id, ch.id DESC'));
  });

  it('scopes a curator and not an admin', async () => {
    await queryQueueKeys(base);
    expect(lastCall()[0]).toContain('JOIN curator_scoped_regions s ON s.id = er.region_id');

    mockedQuery.mockClear();
    await queryQueueKeys({ ...base, isAdmin: true });
    // The scope CTE itself stays — it opens the WITH RECURSIVE list and binds
    // $1, which the region facet and the set-aside rows read either way. What
    // an admin does not get is the predicate that reads it.
    expect(lastCall()[0]).toContain('curator_scoped_regions');
    expect(lastCall()[0]).not.toContain('JOIN curator_scoped_regions s ON s.id = er.region_id');
  });

  it('searches by name with a parameter, never by concatenation', async () => {
    await queryQueueKeys({ ...base, filters: { ...base.filters, q: "O'Keeffe" } });
    const [sql, params] = lastCall();
    expect(sql).toContain('k.name ILIKE');
    expect(params).toContain("%O'Keeffe%");
    expect(sql).not.toContain("O'Keeffe");
  });

  it('escapes the wildcards of a search rather than letting them match', async () => {
    await queryQueueKeys({ ...base, filters: { ...base.filters, q: '100% _' } });
    const [sql, params] = lastCall();
    expect(params).toContain('%100\\% \\_%');
    expect(sql).toContain("ESCAPE '\\'");
  });

  it('hides a batch the curator set aside unless asked to show it', async () => {
    await queryQueueKeys(base);
    expect(lastCall()[0]).toContain('curator_queue_set_aside');
    expect(lastCall()[0]).toMatch(/NOT EXISTS \(\s*SELECT 1 FROM curator_queue_set_aside/);

    mockedQuery.mockClear();
    await queryQueueKeys({ ...base, filters: { ...base.filters, showAside: true } });
    expect(lastCall()[0]).not.toMatch(/NOT EXISTS \(\s*SELECT 1 FROM curator_queue_set_aside/);
  });

  it('orders newest first, then by question rank, then by id — and the reverse order by question first', async () => {
    await queryQueueKeys(base);
    expect(lastCall()[0]).toContain("ORDER BY COALESCE(asked_at, '-infinity') DESC, rank, id");

    mockedQuery.mockClear();
    await queryQueueKeys({ ...base, filters: { ...base.filters, sort: 'question' } });
    expect(lastCall()[0]).toContain("ORDER BY rank, COALESCE(asked_at, '-infinity') DESC, id");
  });

  it('pages by keyset from the cursor, asking one row more than the page', async () => {
    const cursor = encodeCursor({ askedAt: '2026-09-05T19:01:19.748Z', rank: KIND_RANK.waiting, id: 600 });
    await queryQueueKeys({ ...base, filters: { ...base.filters, cursor } });
    const [sql, params] = lastCall();
    expect(sql).toContain('LIMIT $');
    expect(params).toContain(26);
    expect(params).toContain('2026-09-05T19:01:19.748Z');
    expect(params).toContain(600);
  });

  it('expands the keyset comparison in the sense of the order it pages', async () => {
    const cursor = encodeCursor({ askedAt: null, rank: 2, id: 600 });
    await queryQueueKeys({ ...base, filters: { ...base.filters, cursor } });
    // date order: older first, then a later question of the same instant, then a higher id
    expect(lastCall()[0]).toMatch(/COALESCE\(asked_at, '-infinity'\) < COALESCE\(\$\d+::timestamptz, '-infinity'\)/);

    mockedQuery.mockClear();
    await queryQueueKeys({ ...base, filters: { ...base.filters, sort: 'question', cursor } });
    // question order: the rank leads, and only then the date
    expect(lastCall()[0]).toMatch(/\(\s*rank > \$\d+/);
  });

  it('names the next page from the last row of this one, and only when there is one', async () => {
    const row = (id: number) => ({
      kind: 'waiting', rank: KIND_RANK.waiting, id, source_id: 1, run_id: 98,
      asked_at: '2026-09-05T19:01:19.748023+00:00', subs: ['held'],
    });
    mockedQuery.mockResolvedValue({ rows: [{ page: [row(1), row(2), row(3)], total: 3, facets: null }] });
    const short = await queryQueueKeys({ ...base, filters: { ...base.filters, limit: 3 } });
    expect(short.keys).toHaveLength(3);
    expect(short.nextCursor).toBeNull();

    mockedQuery.mockClear();
    const full = await queryQueueKeys({ ...base, filters: { ...base.filters, limit: 2 } });
    expect(full.keys).toHaveLength(2);
    expect(decodeCursor(full.nextCursor!)).toEqual({
      askedAt: '2026-09-05T19:01:19.748023+00:00', rank: KIND_RANK.waiting, id: 2,
    });
    // What the caller reads is still one ISO string, rounded like any date.
    expect(full.keys[1].askedAt).toBe('2026-09-05T19:01:19.748Z');
  });

  it('pages by the stored timestamp, not by the millisecond it rounds to', async () => {
    // 1 255 held keys share run 98's completed_at to the microsecond. A cursor
    // rounded down to .748Z asks for rows strictly older than that instant, so
    // the boundary would fall inside the group and drop its tail.
    const row = (id: number) => ({
      kind: 'waiting', rank: KIND_RANK.waiting, id, source_id: 1, run_id: 98,
      asked_at: '2026-09-05T19:01:19.748023+00:00', subs: ['held'],
    });
    mockedQuery.mockResolvedValue({ rows: [{ page: [row(1), row(2)], total: 2, facets: null }] });
    const first = await queryQueueKeys({ ...base, filters: { ...base.filters, limit: 1 } });

    mockedQuery.mockClear();
    mockedQuery.mockResolvedValue(empty());
    await queryQueueKeys({ ...base, filters: { ...base.filters, limit: 1, cursor: first.nextCursor! } });
    expect(lastCall()[1]).toContain('2026-09-05T19:01:19.748023+00:00');
    expect(lastCall()[1]).not.toContain('2026-09-05T19:01:19.748Z');
  });

  it('round-trips a cursor and refuses garbage', () => {
    const c = { askedAt: null, rank: 4, id: 12 };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
    expect(decodeCursor(encodeCursor({ askedAt: '2026-09-05T19:01:19.748023+00:00', rank: 2, id: 6 })))
      .toEqual({ askedAt: '2026-09-05T19:01:19.748023+00:00', rank: 2, id: 6 });
    expect(decodeCursor('not-a-cursor')).toBeNull();
    expect(decodeCursor(Buffer.from('{"id":"x"}').toString('base64url'))).toBeNull();
    // A date the database would refuse is refused here: it reaches the
    // statement as `$n::timestamptz`, and a 500 is not what a mangled address
    // bar deserves.
    expect(decodeCursor(Buffer.from('{"askedAt":"garbage","rank":1,"id":1}').toString('base64url')))
      .toBeNull();
  });

  it('ignores a cursor it cannot read rather than answering an error', async () => {
    await queryQueueKeys({ ...base, filters: { ...base.filters, cursor: 'not-a-cursor' } });
    expect(lastCall()[0]).not.toContain('::timestamptz');
  });

  it('filters a region by its subtree and "none" by the absence of any region row', async () => {
    await queryQueueKeys({ ...base, filters: { ...base.filters, regionId: 6737 } });
    expect(lastCall()[0]).toContain('region_subtree');

    mockedQuery.mockClear();
    await queryQueueKeys({ ...base, filters: { ...base.filters, regionId: 'none' } });
    expect(lastCall()[0]).toMatch(/NOT EXISTS \(\s*SELECT 1 FROM experience_regions/);
  });

  it('counts each facet under every filter but its own', async () => {
    await queryQueueKeys({
      ...base,
      filters: { ...base.filters, sourceIds: [3], kinds: ['arrival'], runId: 98, regionId: 6737 },
    });
    const [sql] = lastCall();
    // Each facet drops its own chip's filter and keeps the other three, so a
    // chip states what picking it would leave rather than what is on screen.
    const source = between(sql, ', facet_source AS (', ', facet_region AS (');
    expect(source).not.toContain('k.source_id = ANY');
    expect(source).toContain('k.subs &&');
    expect(source).toContain('k.run_id =');
    expect(source).toContain('region_subtree');

    const kind = between(sql, ', facet_kind AS (', ', facet_source AS (');
    expect(kind).toContain('k.source_id = ANY');
    expect(kind).not.toContain('k.subs &&');

    const region = between(sql, ', facet_region AS (', ', facet_run AS (');
    expect(region).toContain('k.source_id = ANY');
    expect(region).not.toContain('JOIN region_subtree rs ON');

    const run = between(sql, ', facet_run AS (', ', aside_counts AS (');
    expect(run).toContain('JOIN region_subtree rs ON');
    expect(run).not.toContain('k.run_id = $');
  });

  it('offers every source, including one the other chips leave at zero', async () => {
    await queryQueueKeys({ ...base, filters: { ...base.filters, sourceIds: [1], kinds: ['withdrawn'] } });
    const [sql] = lastCall();
    const source = between(sql, ', facet_source AS (', ', facet_region AS (');
    // Driven from the source table, like facet_region from region_roots: a
    // source whose count under the other chips is zero is a dimmed row rather
    // than a missing one, or the chip that picked it could not untick it.
    expect(source).toContain('FROM experience_categories cat');
    expect(source).toContain('COALESCE(counted.n, 0) AS count');
    expect(source).toContain('LEFT JOIN');
  });

  it('counts a region through the root row placement already wrote', async () => {
    await queryQueueKeys(base);
    const [sql] = lastCall();
    const region = between(sql, ', facet_region AS (', ', facet_run AS (');
    expect(region).toContain('JOIN experience_regions er ON er.experience_id = k.id');
    expect(region).toContain('JOIN region_roots roots ON roots.id = er.region_id');
    // No walk: placement propagates every ancestor (assignAncestors), so the
    // root's own row is there to be counted. The region *filter* keeps its
    // subtree walk, which is what a curator's chip is answered by.
    expect(sql).not.toContain('root_of');
  });

  it('lists a run the curator set aside, and says so, so the batch has a way back', async () => {
    await queryQueueKeys(base);
    const [sql] = lastCall();
    const run = between(sql, ', facet_run AS (', ', aside_counts AS (');
    // Counted before the exclusion, and the flag read from the table: over
    // `scoped` the batch would be missing from its own chip and every run
    // would say setAside false.
    expect(run).toContain('FROM searched k');
    expect(run).not.toContain('FROM scoped k');
    expect(run).toMatch(/EXISTS \(SELECT 1 FROM curator_queue_set_aside sa\s+WHERE sa\.user_id = \$1 AND sa\.sync_log_id = k\.run_id\) AS set_aside/);
    expect(run).not.toContain('is_aside');
  });

  it('counts the batches set aside before the exclusion drops them', async () => {
    const [sql] = await queryQueueKeys(base).then(() => lastCall());
    // over `keys`, not over `scoped`: the batches the chip names are exactly
    // the ones the exclusion took out, which `scoped` no longer holds.
    const aside = between(sql, ', aside_counts AS (', 'SELECT (SELECT json_agg');
    expect(aside).toContain('FROM keys k');
    // The batch is the unit (ADR-0051 decision 4) and the only number returned:
    // a count of the rows behind them was read by nobody.
    expect(aside).toContain('count(DISTINCT k.run_id)::int AS batches');
    expect(sql).toContain("'setAside', (SELECT json_build_object('batches', x.batches)");
  });

  it('binds no parameter the SQL does not reference, and references none it did not bind', async () => {
    await queryQueueKeys({
      ...base,
      filters: {
        ...base.filters, q: 'x', sourceIds: [1], kinds: ['arrival', 'refused'], runId: 98, regionId: 6737,
      },
    });
    const [sql, params] = lastCall();
    for (let i = 1; i <= params.length; i += 1) expect(sql).toContain(`$${i}`);
    const referenced = [...sql.matchAll(/\$(\d+)/g)].map(m => Number(m[1]));
    expect(Math.max(...referenced)).toBe(params.length);
  });
});
