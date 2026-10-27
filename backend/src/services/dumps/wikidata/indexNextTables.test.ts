import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Indexing the `_next` copies several statements at a time (#1520), against a
 * pool stood in for: each client records what it runs, and an index statement
 * takes a few milliseconds, so statements that overlap are seen to.
 */

interface Ran { pid: number; sql: string; start: number; end: number }

const ran: Ran[] = [];
let running = 0;
let mostAtOnce = 0;
let failOn: string | null = null;
let nextPid = 100;
let clock = 0;
/** Statements that take longer than the usual 5 ms, by a pattern of their text. */
let slow: [RegExp, number][] = [];

/** The live tables' indexes, as `indexesOf` reads them. */
const LIVE: Record<string, { name: string; constraint: 'p' | null; index_def: string; constraint_def: string | null }[]> = {
  wikidata_entities: [
    { name: 'wikidata_entities_pkey', constraint: 'p', index_def: '', constraint_def: 'PRIMARY KEY (id)' },
  ],
  wikidata_claims: [
    { name: 'idx_wikidata_claims_subject', constraint: null, index_def: 'CREATE INDEX idx_wikidata_claims_subject ON workbench.wikidata_claims USING btree (subject, property)', constraint_def: null },
    { name: 'idx_wikidata_claims_value_item', constraint: null, index_def: 'CREATE INDEX idx_wikidata_claims_value_item ON workbench.wikidata_claims USING btree (property, value_item)', constraint_def: null },
  ],
  wikidata_labels: [
    { name: 'wikidata_labels_pkey', constraint: 'p', index_def: '', constraint_def: 'PRIMARY KEY (id, language)' },
  ],
  wikidata_sitelinks: [
    { name: 'wikidata_sitelinks_pkey', constraint: 'p', index_def: '', constraint_def: 'PRIMARY KEY (id, site)' },
    { name: 'idx_wikidata_sitelinks_title', constraint: null, index_def: 'CREATE INDEX idx_wikidata_sitelinks_title ON workbench.wikidata_sitelinks USING btree (site, title)', constraint_def: null },
  ],
};

function fakeClient() {
  const pid = nextPid++;
  return {
    processID: pid,
    release: vi.fn(),
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM pg_index')) return { rows: LIVE[String(params?.[0])] ?? [] };
      if (sql.includes('set_config')) {
        ran.push({ pid, sql: `${sql} ${JSON.stringify(params)}`, start: clock, end: clock });
        return { rows: [] };
      }
      const start = ++clock;
      running += 1;
      mostAtOnce = Math.max(mostAtOnce, running);
      await new Promise(resolve => setTimeout(resolve, slow.find(([pattern]) => pattern.test(sql))?.[1] ?? 5));
      running -= 1;
      ran.push({ pid, sql, start, end: ++clock });
      if (failOn && sql.includes(failOn)) throw new Error(`could not create unique index "${failOn}"`);
      return { rows: [] };
    }),
  };
}

vi.mock('../../../db/index.js', () => ({
  pool: {
    connect: vi.fn(async () => fakeClient()),
    query: vi.fn(async () => ({ rows: [] })),
  },
}));

const { pool } = await import('../../../db/index.js');
const { CLASS_WALK_SESSION, deriveClassClosure, indexNextTables, INDEX_LANES, INDEX_SESSION } = await import('./subsetTables.js');

const TABLES = ['wikidata_entities', 'wikidata_claims', 'wikidata_labels', 'wikidata_sitelinks'] as const;
const indexing = () => ran.filter(r => /CREATE INDEX|ADD CONSTRAINT/.test(r.sql));
const of = (name: string) => indexing().find(r => r.sql.includes(`${name}_next`))!;

beforeEach(() => {
  ran.length = 0;
  running = 0;
  mostAtOnce = 0;
  failOn = null;
  clock = 0;
  slow = [];
});

describe('indexNextTables', () => {
  it('builds every index of every copy under its _next name, several at a time but never more than its lanes', async () => {
    await indexNextTables(new AbortController().signal, TABLES);

    expect(indexing().map(r => r.sql.match(/(?:CONSTRAINT|INDEX) (\w+_next)/)![1]).sort()).toEqual([
      'idx_wikidata_claims_subject_next', 'idx_wikidata_claims_value_item_next', 'idx_wikidata_sitelinks_title_next',
      'wikidata_entities_pkey_next', 'wikidata_labels_pkey_next', 'wikidata_sitelinks_pkey_next',
    ]);
    expect(of('idx_wikidata_claims_subject').sql).toContain('ON workbench.wikidata_claims_next ');
    expect(mostAtOnce).toBeGreaterThan(1);
    expect(mostAtOnce).toBeLessThanOrEqual(INDEX_LANES);
  });

  it("builds a table's key before its other indexes, since adding a constraint locks the table", async () => {
    await indexNextTables(new AbortController().signal, TABLES);

    expect(of('idx_wikidata_sitelinks_title').start).toBeGreaterThan(of('wikidata_sitelinks_pkey').end);
  });

  it('runs each index under its session settings and puts them back before the client is pooled again', async () => {
    await indexNextTables(new AbortController().signal, ['wikidata_claims']);

    const pid = of('idx_wikidata_claims_subject').pid;
    const onClient = ran.filter(r => r.pid === pid).map(r => r.sql);
    for (const [name, value] of INDEX_SESSION) {
      expect(onClient.indexOf(`SELECT set_config($1, $2, false) ${JSON.stringify([name, value])}`)).toBeGreaterThanOrEqual(0);
      expect(onClient.some(sql => sql.includes('reset_val') && sql.includes(JSON.stringify([name])))).toBe(true);
    }
    const index = onClient.findIndex(sql => sql.includes('CREATE INDEX'));
    expect(onClient.findIndex(sql => sql.includes('reset_val'))).toBeGreaterThan(index);
  });

  it('analyzes every copy once all its indexes stand, so nothing that reads it plans without statistics', async () => {
    await indexNextTables(new AbortController().signal, TABLES);

    const analyzed = ran.filter(r => r.sql.startsWith('ANALYZE'));
    expect(analyzed.map(r => r.sql).sort()).toEqual(TABLES.map(table => `ANALYZE workbench.${table}_next`).sort());
    const lastIndex = Math.max(...indexing().map(r => r.end));
    for (const analyze of analyzed) expect(analyze.start).toBeGreaterThan(lastIndex);
  });

  it('fails with the first index that fails, and starts nothing after it', async () => {
    failOn = 'wikidata_entities_pkey_next';

    await expect(indexNextTables(new AbortController().signal, TABLES)).rejects.toThrow('wikidata_entities_pkey_next');

    const failedAt = of('wikidata_entities_pkey').end;
    expect(indexing().filter(r => r.start > failedAt)).toEqual([]);
    expect(ran.filter(r => r.sql.startsWith('ANALYZE'))).toEqual([]);
  });

  it('cancels the other copies\' analyze when one fails, as a failed index cancels the other indexes', async () => {
    failOn = 'ANALYZE workbench.wikidata_entities_next';
    slow = [[/^ANALYZE (?!workbench\.wikidata_entities_next)/, 50]];

    await expect(indexNextTables(new AbortController().signal, TABLES)).rejects.toThrow('wikidata_entities_next');

    const cancelled = vi.mocked(pool.query).mock.calls.filter(([sql]) => String(sql).includes('pg_cancel_backend'));
    const analyzing = ran.filter(r => r.sql.startsWith('ANALYZE') && !r.sql.includes('wikidata_entities')).map(r => r.pid);
    expect(analyzing).toHaveLength(3);
    for (const pid of analyzing) expect(cancelled.some(([, params]) => (params as unknown[])[0] === pid)).toBe(true);
  });

  it('starts nothing once cancelled', async () => {
    const stop = new AbortController();
    stop.abort();

    await expect(indexNextTables(stop.signal, TABLES)).rejects.toThrow();
    expect(indexing()).toEqual([]);
  });
});

describe('deriveClassClosure', () => {
  it('walks the class tree under its session settings, so the edges hash once, and puts them back after', async () => {
    await deriveClassClosure(new AbortController().signal);

    const walk = ran.find(r => r.sql.includes('INSERT INTO workbench.wikidata_class_closure_next'))!;
    const onClient = ran.filter(r => r.pid === walk.pid).map(r => r.sql);
    for (const [name, value] of CLASS_WALK_SESSION) {
      expect(onClient.indexOf(`SELECT set_config($1, $2, false) ${JSON.stringify([name, value])}`)).toBeGreaterThanOrEqual(0);
      expect(onClient.findIndex(sql => sql.includes('reset_val') && sql.includes(JSON.stringify([name])))).toBeGreaterThan(onClient.indexOf(walk.sql));
    }
  });
});
