import { describe, expect, it, vi } from 'vitest';
import { classifyPlacesByFame } from './places.js';
import { buildWorshipTrees, TYPE_ROOTS } from './classes.js';
import type { KindShare } from '../places/gather.js';
import type { WorshipTrees, WorshipType } from './classes.js';
import type { PoolEntity } from '../publicArt/queries.js';
import type { SparqlFn } from '../wikidataQueries.js';
import { belowWorldBars, keptNote, type WorldBars, type WorldRead } from '../places/worldBars.js';

const MONASTERY = 'Q44613';

const trees = buildWorshipTrees({
  worship: [MONASTERY],
  sacred: [],
  typeTrees: Object.fromEntries(TYPE_ROOTS.map(({ type }) => [type, []])) as unknown as Record<WorshipType, string[]>,
});

const row = (qid: string, label: string, sitelinks: number) => ({ qid, label, sitelinks });
// 51 places the rule passes: the 97th and 98th percentiles are the second highest value, the 90th the sixth.
const COLOGNE = row('Q4176', 'Cologne Cathedral', 84);
const SECOND = row('Q9000030', 'An abbey in 30 editions read 200,000 times a year', 30);
const MONT_SAINT_MICHEL = row('Q651388', 'Mont-Saint-Michel Abbey', 19);
const HELD = row('Q9000025', 'An abbey the last run admitted, in 25 editions', 25);
const FALLEN = row('Q9000012', 'An abbey the last run admitted, in 12 editions', 12);
const WELL_READ = Array.from({ length: 4 }, (_, i) => row(`Q90001${i}`, 'A chapel read 10,000 times a year in 6 editions', 6));
const TAIL = Array.from({ length: 42 }, (_, i) => row(`Q9100${100 + i}`, "A village church in the pool's tail", 3));
const ROWS = [COLOGNE, SECOND, MONT_SAINT_MICHEL, HELD, FALLEN, ...WELL_READ, ...TAIL];

const READERS = new Map<string, number>([
  ['Q4176', 2_149_701], ['Q9000030', 200_000], ['Q651388', 181_451], ['Q9000025', 2_000], ['Q9000012', 2_000],
  ...WELL_READ.map((r): [string, number] => [r.qid, 10_000]),
  ...TAIL.map((r): [string, number] => [r.qid, 400]),
]);
// The second highest editions (30) and readers (200,000), the sixth highest readers (10,000).
const BARS: WorldBars = { editions: 30, readers: 200_000, guidedReaders: 10_000, pool: 51 };

function share(admissionPool = true): KindShare<WorshipTrees> {
  const pool = new Map(ROWS.map((r) => [r.qid, { ...r, onEarth: true, lat: 50.94, lon: 6.96 } as PoolEntity]));
  const facts = new Map(ROWS.map((r) => [r.qid, { classes: [MONASTERY] }]));
  return {
    trees, pool, facts, byId: new Set(), enteredOnly: new Set(), admissionPool: admissionPool ? new Set(pool.keys()) : null,
  } as unknown as KindShare<WorshipTrees>;
}
const sparql: SparqlFn = () => Promise.reject(new Error('no question reaches Wikidata here'));
const read = (readers: ReadonlyMap<string, number> | null = READERS): WorldRead => ({
  readers, guided: new Set(WELL_READ.slice(0, 1).map((r) => r.qid)), atlas: new Set(),
});

describe('classifyPlacesByFame, the world bars (ADR-0175)', () => {
  it('admits a place by its editions, by its readers, or by a guide\'s mark, at the bars its own pool sets', async () => {
    const { places } = await classifyPlacesByFame(share(), new Set(), sparql, { read: read() });
    // Mont-Saint-Michel Abbey is under the editions bar and over none of the readers' — 181,451 against 200,000.
    expect([...places.keys()]).toEqual([COLOGNE.qid, SECOND.qid, WELL_READ[0].qid]);
    expect(places.get(WELL_READ[0].qid)?.note).toMatch(/^In the world tier by a guide's mark/);
    expect(places.get(COLOGNE.qid)?.note).toBeUndefined();
  });

  it('keeps a held place at 0.8 of a bar, and refuses one under every stay bar by name', async () => {
    const { places, filtered } = await classifyPlacesByFame(share(), new Set([HELD.qid, FALLEN.qid, MONT_SAINT_MICHEL.qid]), sparql, { read: read() });
    // 25 editions is over 0.8 of 30, and 181,451 readers over 0.8 of 200,000.
    expect(places.has(HELD.qid)).toBe(true);
    expect(places.has(MONT_SAINT_MICHEL.qid)).toBe(true);
    expect(filtered).toEqual([
      { externalId: FALLEN.qid, name: FALLEN.label, reason: belowWorldBars({ qid: FALLEN.qid, editions: 12 }, read(), BARS) },
    ]);
  });

  it('decides on editions alone when no year of readers can be read, and keeps the held it cannot read', async () => {
    const { places } = await classifyPlacesByFame(share(), new Set([FALLEN.qid]), sparql, { read: read(null) });
    expect([...places.keys()]).toEqual([COLOGNE.qid, SECOND.qid, FALLEN.qid]);
    expect(places.get(FALLEN.qid)?.note).toBe(keptNote({ qid: FALLEN.qid, editions: 12 }, 'no year of readers is read'));
  });

  it('decides by the readers\' bars and the readers it last read when no year can be read (ADR-0175 decision 6)', async () => {
    const keep = vi.fn(async () => undefined);
    const history = {
      memory: { bars: { readers: 200_000, guidedReaders: 10_000, year: '2025-10 to 2026-09', logId: 812 }, readers: READERS, guided: new Map() },
      keep,
    };
    const { places, filtered } = await classifyPlacesByFame(
      share(), new Set([MONT_SAINT_MICHEL.qid, FALLEN.qid]), sparql, { read: read(null), history },
    );
    // Cologne Cathedral is in by its editions; Mont-Saint-Michel Abbey stays on its 181,451 readers as last read,
    // with no note, as it would with the year, and the chapel a guide uses enters on its 10,000; the abbey in
    // 12 editions read 2,000 times falls by them, said so.
    expect([...places.keys()]).toEqual([COLOGNE.qid, SECOND.qid, MONT_SAINT_MICHEL.qid, WELL_READ[0].qid]);
    expect(places.get(MONT_SAINT_MICHEL.qid)?.note).toBeUndefined();
    expect(filtered.map((f) => [f.externalId, f.reason])).toEqual([
      [FALLEN.qid, expect.stringContaining('12 Wikipedia editions and 2,000 readers a year as last read')],
    ]);
  });

  it('lets nothing new in when the kind\'s pool was not read', async () => {
    const { places } = await classifyPlacesByFame(share(false), new Set([HELD.qid]), sparql, { read: read() });
    expect([...places.keys()]).toEqual([HELD.qid]);
  });
});
