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
import {
  withCache, setCacheTtl, forgetCached, cacheSummary, cachedKindsFor,
  CACHED_KINDS_BY_SOURCE, DEFAULT_TTL_MS, EXPIRED_GRACE_MS,
} from './wikidataCache.js';
import { subsetDoor } from './subset/reader.js';

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

describe('CACHED_KINDS_BY_SOURCE', () => {
  it('declares the kinds the public-art collector describes, and what its visit witnesses read', () => {
    // Decision 4 of ADR-0030: only the kinds a source's collector files exist
    // for it. The panel offers "Sync without cache" and the cache section on
    // the strength of this list, so a kind the collector files and this list
    // omits is a cache an admin cannot see or clear.
    expect(CACHED_KINDS_BY_SOURCE[3]).toEqual(['classes', 'pool', 'statements', 'edges', 'entities', 'osm', 'photos']);
  });

  it('still declares nothing for the UNESCO run, which reads its own API', () => {
    expect(CACHED_KINDS_BY_SOURCE[1]).toBeUndefined();
  });
});

/** Art Museums — every question here belongs to one source. */
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

/** The `(sourceId, kind)` a statement locked on, or undefined if it took no lock. */
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

    const cached = withCache(source, { sourceId: MUSEUM, enabled: true });
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

    await withCache(source, { sourceId: MUSEUM, enabled: true })(question, descriptor);
    await withCache(source, { sourceId: 3, enabled: true })(question, descriptor);

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

    const cached = withCache(source, { sourceId: MUSEUM, enabled: true, onHit: d => hits.push(d.label) });
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

    const cached = withCache(source, { sourceId: MUSEUM, enabled: false });
    await cached('SELECT ?c {}', { kind: 'classes', label: 'museum classes' });

    // A cache that cannot be bypassed is a fork of reality rather than a cache.
    expect(source).toHaveBeenCalledTimes(1);
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it('falls through to the source when the cache read fails', async () => {
    mockedQuery.mockRejectedValue(new Error('relation does not exist'));
    const source = vi.fn(async () => ROWS);

    const cached = withCache(source, { sourceId: MUSEUM, enabled: true });
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

    const cached = withCache(source, { sourceId: MUSEUM, enabled: true });

    // The run has the answer in hand and the source has already paid for it;
    // throwing here would discard both.
    await expect(cached('SELECT ?c {}', { kind: 'pool', label: 'pool: painting' }))
      .resolves.toEqual(ROWS);
  });

  it('writes what a person reads: kind, label and the query itself', async () => {
    emptyCache();
    const source = vi.fn(async () => ROWS);

    const cached = withCache(source, { sourceId: MUSEUM, enabled: true });
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

    const cached = withCache(source, { sourceId: MUSEUM, enabled: true });
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

    await withCache(source, { sourceId: MUSEUM, enabled: true })(
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
    await withCache(vi.fn(async () => ROWS), { sourceId: MUSEUM, enabled: true })(
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

describe('the OSM answers of the Archaeology run', () => {
  it('is a kind of its own, kept for a day', () => {
    // A day, so a dry run repeated the same day reads the cache — which is the
    // whole shape of working on the site rule — and a run tomorrow asks again.
    expect(DEFAULT_TTL_MS.osm).toBe(24 * 60 * 60 * 1000);
  });

  it('is offered on every source whose runs ask the visit witnesses (#1770), and not on World Heritage', () => {
    for (const sourceId of [2, 3, 4, 5]) expect(CACHED_KINDS_BY_SOURCE[sourceId]).toContain('osm');
    expect(CACHED_KINDS_BY_SOURCE[1]).toBeUndefined();
  });
});

describe('a source that reads the local subset (ADR-0119)', () => {
  beforeEach(() => { mockedQuery.mockReset(); });

  it('never puts the cache in front of the subset\'s door', () => {
    // A wrapper carries no mark, so the fetchers behind it would send SPARQL
    // and the cache would answer from the live service's Wikidata, of another
    // date than the subset's.
    const door = subsetDoor(vi.fn(async () => ROWS));
    expect(() => withCache(door, { sourceId: MUSEUM, enabled: true })).toThrow(/local subset/);
  });

  it('keeps only what it still asks live: OpenStreetMap and Commons', () => {
    for (const sourceId of [2, 3, 4, 5]) expect(cachedKindsFor(sourceId, 'subset')).toEqual(['osm', 'photos']);
    for (const sourceId of [2, 3, 4, 5]) expect(cachedKindsFor(sourceId, 'live')).toEqual(CACHED_KINDS_BY_SOURCE[sourceId]);
  });

  it('lists what its live runs left as answered by the subset, and keeps OpenStreetMap a cache', async () => {
    // Archaeology on the subset, with class trees its last live run kept and
    // the mirror's answers about its site candidates.
    mockedQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('wikidata_cache_policy')) return { rows: [] };
      return {
        rows: [
          { kind: 'classes', entries: 17, rows: 400, expired: 17, oldest_fetched_at: '2026-10-14T08:00:00Z', next_expires_at: null, bytes: 9000, labels: ['subclasses of archaeological site'] },
          { kind: 'osm', entries: 57, rows: 1200, expired: 0, oldest_fetched_at: '2026-10-16T08:00:00Z', next_expires_at: '2026-10-17T08:00:00Z', bytes: 40000, labels: ['digs at 50 candidates'] },
        ],
      };
    });

    const kinds = await cacheSummary(5, 'subset');

    expect(kinds.map(({ kind, answeredBy }) => [kind, answeredBy])).toEqual([
      ['classes', 'subset'],
      ['osm', 'cache'],
      ['photos', 'cache'],
    ]);
  });

  it('answers every kind from the cache for a source on the live service', async () => {
    mockedQuery.mockResolvedValue({ rows: [] });

    const kinds = await cacheSummary(5, 'live');

    expect(kinds.map(({ kind }) => kind)).toEqual([...CACHED_KINDS_BY_SOURCE[5]].sort());
    expect(new Set(kinds.map(({ answeredBy }) => answeredBy))).toEqual(new Set(['cache']));
  });
});

describe('forgetCached', () => {
  beforeEach(() => { mockedQuery.mockReset(); });

  it('drops exactly the named questions of one source, keyed as a read is', async () => {
    mockedQuery.mockResolvedValue({ rowCount: 2 });
    const dropped = await forgetCached(5, ['q1', 'q2', 'q1']);

    expect(dropped).toBe(2);
    const [sql, params] = mockedQuery.mock.calls[0] as [string, [number, string[]]];
    expect(sql).toContain('source_id = $1 AND query_hash = ANY($2::text[])');
    expect(params[0]).toBe(5);
    // One hash per question, asked once, and the source is part of the key
    // (ADR-0047): the same words under another source hash differently.
    expect(params[1]).toHaveLength(2);
    await forgetCached(4, ['q1']);
    const other = (mockedQuery.mock.calls[1] as [string, [number, string[]]])[1][1][0];
    expect(params[1]).not.toContain(other);
  });

  it('sends nothing when there is nothing to forget', async () => {
    expect(await forgetCached(5, [])).toBe(0);
    expect(mockedQuery).not.toHaveBeenCalled();
  });
});

describe('pruning answers long past their expiry (#627)', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedQuery.mockImplementation(async (sql: string) => (
      sql.includes('SELECT result') ? { rows: [{ result: ROWS }] } : { rows: [], rowCount: 0 }
    ));
  });

  const prunes = () => mockedQuery.mock.calls.filter(([sql]) => String(sql).includes('DELETE FROM wikidata_query_cache'));

  it("drops the source's answers a week past expiry, once per cached door, on the first question it answers", async () => {
    const cached = withCache(vi.fn(async () => ROWS), { sourceId: MUSEUM, enabled: true });
    await cached('SELECT ?a {}', { kind: 'classes', label: 'one' });
    await cached('SELECT ?b {}', { kind: 'classes', label: 'two' });

    expect(prunes()).toHaveLength(1);
    const [sql, params] = prunes()[0];
    expect(sql).toContain('source_id = $1');
    expect(sql).toContain('expires_at < NOW()');
    expect(params).toEqual([MUSEUM, EXPIRED_GRACE_MS]);
    expect(EXPIRED_GRACE_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('prunes nothing for a run that does not use the cache', async () => {
    await withCache(vi.fn(async () => ROWS), { sourceId: MUSEUM, enabled: false })('SELECT ?a {}', { kind: 'classes', label: 'one' });
    await withCache(vi.fn(async () => ROWS), { sourceId: MUSEUM, enabled: true })('SELECT ?a {}');

    expect(prunes()).toHaveLength(0);
  });

  it('answers the run when the prune fails', async () => {
    mockedQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('DELETE FROM wikidata_query_cache')) throw new Error('db hiccup');
      return sql.includes('SELECT result') ? { rows: [{ result: ROWS }] } : { rows: [], rowCount: 0 };
    });

    const rows = await withCache(vi.fn(async () => ROWS), { sourceId: MUSEUM, enabled: true })('SELECT ?a {}', { kind: 'classes', label: 'one' });

    expect(rows).toEqual(ROWS);
  });
});
