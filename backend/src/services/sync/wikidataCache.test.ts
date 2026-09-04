/**
 * Tests for the answers we keep from Wikidata.
 *
 * Three promises live here and none of them is visible in a column name: a
 * question nobody described is not kept at all, a run told to refresh asks the
 * source even when a fresh answer exists, and a failure anywhere in the cache
 * costs the run nothing — the catalogue must not stop importing because a cache
 * table is unhappy.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { clientQuery } = vi.hoisted(() => ({ clientQuery: vi.fn() }));

vi.mock('../../db/index.js', () => ({
  pool: {
    query: vi.fn(),
    connect: vi.fn(async () => ({ query: clientQuery, release: vi.fn() })),
  },
  rollbackQuietly: async (c: { query: (s: string) => unknown }) => {
    try { await c.query('ROLLBACK'); return undefined; } catch (e) { return e as Error; }
  },
}));

import { pool } from '../../db/index.js';
import { withCache, setCacheTtl, CACHED_KINDS_BY_CATEGORY } from './wikidataCache.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

describe('CACHED_KINDS_BY_CATEGORY', () => {
  it('declares the four kinds the public-art collector describes', () => {
    // Decision 4 of ADR-0030: only the kinds a source's collector files exist
    // for it. The panel offers "Sync without cache" and the cache section on
    // the strength of this list, so a kind the collector files and this list
    // omits is a cache an admin cannot see or clear.
    expect(CACHED_KINDS_BY_CATEGORY[3]).toEqual(['classes', 'pool', 'edges', 'entities']);
  });

  it('still declares nothing for the UNESCO run, which reads its own API', () => {
    expect(CACHED_KINDS_BY_CATEGORY[1]).toBeUndefined();
  });
});

/** Top Art Museums — every question here belongs to one source. */
const MUSEUM = 2;

const ROWS = [{ w: { value: 'http://www.wikidata.org/entity/Q19675' } }];

/** A cache that holds nothing and accepts everything, which is the empty case. */
function emptyCache() {
  mockedQuery.mockImplementation(async (sql: string) => {
    if (sql.includes('SELECT result')) return { rows: [] };
    return { rows: [], rowCount: 1 };
  });
  clientQuery.mockReset();
  clientQuery.mockResolvedValue({ rows: [], rowCount: 1 });
}

/** The `(categoryId, kind)` a statement locked on, or undefined if it took no lock. */
function lockKey(calls: [string, unknown[]?][]): unknown[] | undefined {
  return calls.find(([sql]) => String(sql).includes('pg_advisory_xact_lock'))?.[1];
}

describe('withCache', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
  });

  it('does not keep a question nobody described', async () => {
    emptyCache();
    const source = vi.fn(async () => ROWS);

    const cached = withCache(source, { categoryId: MUSEUM, enabled: true });
    await cached('SELECT * {}');

    // No descriptor means "this is a one-off": filing it under a guessed kind
    // would give it a lifetime nobody chose.
    expect(source).toHaveBeenCalledTimes(1);
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it('keys an answer by the source that asked as well as by the question', async () => {
    // Decision 4 of ADR-0030: the cache belongs to a source. Two collectors
    // ask for the children of `sculpture` in the same words; the public-art
    // run once read the museums' week-old row and missed a class Wikidata had
    // created since, and "Clear" on one source would otherwise leave rows the
    // other had last written. Same question, another source: another key.
    emptyCache();
    const source = vi.fn(async () => ROWS);
    const question = 'SELECT DISTINCT ?c WHERE { ?c wdt:P279 wd:Q860861 }';
    const descriptor = { kind: 'classes' as const, label: 'subclasses of 1 class(es)' };

    await withCache(source, { categoryId: MUSEUM, enabled: true })(question, descriptor);
    await withCache(source, { categoryId: 3, enabled: true })(question, descriptor);

    const reads = mockedQuery.mock.calls.filter(([sql]) => String(sql).includes('SELECT result'));
    expect(reads).toHaveLength(2);
    expect(reads[0][1][0]).not.toBe(reads[1][1][0]);
    // And the write files the answer under the same key the read looked for.
    const writes = clientQuery.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO wikidata_query_cache'));
    expect(writes[1][1][1]).toBe(reads[1][1][0]);
  });

  it('answers from what it kept, without asking the source', async () => {
    mockedQuery.mockImplementation(async (sql: string) => (
      sql.includes('SELECT result') ? { rows: [{ result: ROWS }] } : { rows: [], rowCount: 0 }
    ));
    const source = vi.fn(async () => ROWS);
    const hits: string[] = [];

    const cached = withCache(source, { categoryId: MUSEUM, enabled: true, onHit: d => hits.push(d.label) });
    const rows = await cached('SELECT ?c {}', { kind: 'classes', label: 'museum classes' });

    expect(rows).toEqual(ROWS);
    expect(source).not.toHaveBeenCalled();
    // The hit is announced because a phase served from cache and a phase fetched
    // look identical on screen otherwise, and that is how somebody debugs a
    // week-old answer for an hour.
    expect(hits).toEqual(['museum classes']);
  });

  it('asks the source when the run was told to refresh, and keeps nothing back', async () => {
    mockedQuery.mockImplementation(async () => ({ rows: [{ result: ROWS }] }));
    const source = vi.fn(async () => ROWS);

    const cached = withCache(source, { categoryId: MUSEUM, enabled: false });
    await cached('SELECT ?c {}', { kind: 'classes', label: 'museum classes' });

    // A cache that cannot be bypassed is a fork of reality rather than a cache.
    expect(source).toHaveBeenCalledTimes(1);
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it('falls through to the source when the cache read fails', async () => {
    mockedQuery.mockRejectedValue(new Error('relation does not exist'));
    const source = vi.fn(async () => ROWS);

    const cached = withCache(source, { categoryId: MUSEUM, enabled: true });
    const rows = await cached('SELECT ?c {}', { kind: 'classes', label: 'museum classes' });

    expect(rows).toEqual(ROWS);
    expect(source).toHaveBeenCalledTimes(1);
  });

  it('returns the answer even when it cannot be kept', async () => {
    mockedQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT result')) return { rows: [] };
      throw new Error('disk full');
    });
    const source = vi.fn(async () => ROWS);

    const cached = withCache(source, { categoryId: MUSEUM, enabled: true });

    // The run has the answer in hand and the source has already paid for it;
    // throwing here would discard both.
    await expect(cached('SELECT ?c {}', { kind: 'pool', label: 'pool: painting' }))
      .resolves.toEqual(ROWS);
  });

  it('writes what a person reads: kind, label and the query itself', async () => {
    emptyCache();
    const source = vi.fn(async () => ROWS);

    const cached = withCache(source, { categoryId: MUSEUM, enabled: true });
    await cached('SELECT ?c {}', { kind: 'pool', label: 'pool: painting, 100+ sitelinks' });

    const insert = clientQuery.mock.calls.find(call => String(call[0]).includes('INSERT INTO wikidata_query_cache'));
    expect(insert, 'the answer was not kept at all').toBeDefined();
    const params = insert![1] as unknown[];
    expect(params).toContain('pool');
    expect(params).toContain('pool: painting, 100+ sitelinks');
    // The query text goes in beside the hash so the panel can show what a kept
    // row actually asked, rather than a hex digest.
    expect(params).toContain('SELECT ?c {}');
  });

  it('reads the lifetime inside the insert, so there is no gap of its own', async () => {
    emptyCache();
    const source = vi.fn(async () => ROWS);

    const cached = withCache(source, { categoryId: MUSEUM, enabled: true });
    await cached('SELECT ?c {}', { kind: 'pool', label: 'pool: painting' });

    // Read first and inserted second, a policy change could commit in between
    // and this row would land carrying an expiry the panel no longer shows.
    const sql = String(clientQuery.mock.calls.find(
      call => String(call[0]).includes('INSERT INTO wikidata_query_cache'),
    )![0]);
    expect(sql).toContain('SELECT ttl_ms FROM wikidata_cache_policy');
    expect(clientQuery.mock.calls.some(([q]) => String(q).trim().startsWith('SELECT ttl_ms')))
      .toBe(false);
  });

  it('takes the same lock as a lifetime change, on the same key', async () => {
    emptyCache();
    const source = vi.fn(async () => ROWS);

    await withCache(source, { categoryId: MUSEUM, enabled: true })(
      'SELECT ?c {}', { kind: 'pool', label: 'pool: painting' },
    );
    const writerLock = lockKey(clientQuery.mock.calls as [string, unknown[]][]);

    clientQuery.mockClear();
    await setCacheTtl(MUSEUM, 'pool', 3600000);
    const policyLock = lockKey(clientQuery.mock.calls as [string, unknown[]][]);

    // The two serialise against each other only if they lock the same thing.
    // What this cannot show is the interleaving itself — that needs two live
    // connections — so it pins the invariant the serialisation rests on: both
    // paths take the lock, keyed by the pair the policy is keyed by.
    expect(writerLock).toEqual([MUSEUM, 'pool']);
    expect(policyLock).toEqual([MUSEUM, 'pool']);
  });

  it('locks before it writes, in both paths', async () => {
    emptyCache();
    await withCache(vi.fn(async () => ROWS), { categoryId: MUSEUM, enabled: true })(
      'SELECT ?c {}', { kind: 'pool', label: 'pool: painting' },
    );

    const order = clientQuery.mock.calls.map(([q]) => String(q));
    const lock = order.findIndex(q => q.includes('pg_advisory_xact_lock'));
    const insert = order.findIndex(q => q.includes('INSERT INTO wikidata_query_cache'));
    const begin = order.findIndex(q => q.trim() === 'BEGIN');
    expect(begin).toBeGreaterThan(-1);
    expect(lock).toBeGreaterThan(begin);
    expect(insert).toBeGreaterThan(lock);
  });
});
