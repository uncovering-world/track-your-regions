/**
 * Towers' world tier (ADR-0175): the rule, then the three bars read off the
 * kind's own pool, on the towers the frame was measured on.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../dumps/readership/workReadership.js', () => ({ readershipYear: vi.fn(), readWorks: vi.fn() }));

import type { PoolEntity } from '../publicArt/queries.js';
import type { KindShare } from '../places/gather.js';
import type { SparqlFn } from '../wikidataQueries.js';
import { emptyContainment } from '../places/containment.js';
import { belowWorldBars, guidedBarNote, keptNote, type WorldBars, type WorldRead } from '../places/worldBars.js';
import { classifyTowers, type TowerTrees } from './kind.js';

const TOWER = 'Q12518';
const SKYSCRAPER = 'Q11303';
const none = new Set<string>();
const trees: TowerTrees = {
  place: new Set([TOWER]),
  types: {
    pagoda: none, minaret: none, 'clock-tower': none, 'bell-tower': none, mast: none,
    'observation-tower': none, 'fortified-tower': none,
  },
  others: {
    lighthouse: none, bridge: none, gate: none, gateTower: none, sculpture: none,
    skyscraper: new Set([SKYSCRAPER]), officeBuilding: none, towerBlock: none,
  },
  kills: { destroyed: none, proposed: none, ruins: none },
  noClass: {}, shared: {},
  named: { publicClock: none, buildingComplex: none, plainTower: none, worship: none, archaeologicalSite: none, worshipParts: none, seaFort: none },
};
const entity = (qid: string, label: string, sitelinks: number): PoolEntity => ({
  qid, label, description: null, lat: 44.49, lon: 11.35, onEarth: true, imageUrl: null, itemPictures: [],
  sitelinks, countryLabel: null, articleUrl: null, website: null, year: null,
});

// A pool of 51 towers the rule passes, so the bars are easy to read off it:
// the 97th and 98th percentiles are the second highest value, the 90th the sixth.
const GALATA = entity('Q91274', 'Galata Tower', 56);
const FORTY = entity('Q9000040', 'A tower in 40 editions', 40);
const HOANG_PHUC = entity('Q20025373', 'Hoằng Phúc pagoda', 37);
const ASINELLI = entity('Q16511590', 'Asinelli tower', 9);
const TORRAZZO = entity('Q2368198', 'Torrazzo of Cremona', 14);
const KEPT = entity('Q9000001', 'A tower the last run admitted, in 32 editions', 32);
const FALLEN = entity('Q9000002', 'A tower the last run admitted, in 20 editions', 20);
const WELL_READ = Array.from({ length: 4 }, (_, i) => entity(`Q90001${i}`, 'A tower read 20,000 times a year in 5 editions', 5));
const TAIL = Array.from({ length: 40 }, (_, i) => entity(`Q9100${100 + i}`, "A tower in the pool's tail", 3));
const BURJ = entity('Q12495', 'Burj Khalifa', 160);
const OFFICE = entity('Q9200000', 'An office block in 3 editions', 3);

const TOWERS = [GALATA, FORTY, HOANG_PHUC, ASINELLI, TORRAZZO, KEPT, FALLEN, ...WELL_READ, ...TAIL];
const READERS: Record<string, number> = {
  Q91274: 509_000, Q9000040: 3_000, Q20025373: 2_766, Q16511590: 51_000, Q2368198: 39_000, Q9000001: 3_000, Q9000002: 3_000,
  ...Object.fromEntries(WELL_READ.map((e) => [e.qid, 20_000])),
  ...Object.fromEntries(TAIL.map((e) => [e.qid, 1_000])),
};
// The second highest editions (40) and readers (51,000), the sixth highest readers (20,000).
const BARS: WorldBars = { editions: 40, readers: 51_000, guidedReaders: 20_000, pool: 51 };

const share = (admissionPool = true): KindShare<TowerTrees> => {
  const rows: [PoolEntity, string[]][] = [
    ...TOWERS.map((e): [PoolEntity, string[]] => [e, [TOWER]]), [BURJ, [SKYSCRAPER]], [OFFICE, [SKYSCRAPER]],
  ];
  return {
    trees,
    pool: new Map(rows.map(([e]) => [e.qid, e])),
    byId: new Set(),
    facts: new Map(rows.map(([e, classes]) => [e.qid, { classes }])) as never,
    containers: emptyContainment(),
    subjects: new Map(),
    entered: new Set(),
    enteredOnly: new Set(),
    // Every row a class question named: the pool the bars are read over.
    admissionPool: admissionPool ? new Set(rows.map(([e]) => e.qid)) : null,
  };
};
const sparql: SparqlFn = () => Promise.reject(new Error('no question is asked when the signals are handed in'));
const signals = (readers: Record<string, number> | null = READERS): WorldRead => ({
  readers: readers && new Map(Object.entries(readers)),
  guided: new Set([ASINELLI.qid, TORRAZZO.qid]),
  atlas: new Set([WELL_READ[0].qid]),
});
const held = new Set([KEPT.qid, FALLEN.qid]);
const ids = (items: { qid: string }[]) => items.map((item) => item.qid);

describe('classifyTowers', () => {
  it('admits at any one of the bars its own pool sets', async () => {
    const { items } = await classifyTowers(share(), held, sparql, signals());
    // Galata and the tower in 40 editions by their editions; the Asinelli tower by its readers;
    // the Torrazzo and the tower Atlas Obscura lists by a guide's mark; the held tower in 32
    // editions by 0.8 of the editions bar. Hoằng Phúc's 37 editions and 2,766 readers reach none.
    expect(ids(items)).toEqual([GALATA.qid, FORTY.qid, KEPT.qid, TORRAZZO.qid, ASINELLI.qid, WELL_READ[0].qid]);
  });

  it('asks the curator about a tower a guide\'s mark alone let in', async () => {
    const { items } = await classifyTowers(share(), held, sparql, signals());
    const note = (qid: string) => items.find((item) => item.qid === qid)?.readershipNote;
    expect(note(TORRAZZO.qid)).toBe(guidedBarNote({ qid: TORRAZZO.qid, editions: 14 }, signals(), BARS));
    expect(note(ASINELLI.qid)).toBeUndefined();
    expect(note(GALATA.qid)).toBeUndefined();
  });

  it('names a held tower under every stay bar with its signals, and the rule\'s refusals worth naming', async () => {
    const { filtered } = await classifyTowers(share(), held, sparql, signals());
    expect(filtered).toEqual([
      { externalId: BURJ.qid, name: 'Burj Khalifa', reason: 'a skyscraper, not a tower' },
      { externalId: FALLEN.qid, name: FALLEN.label, reason: belowWorldBars({ qid: FALLEN.qid, editions: 20 }, signals(), BARS), type: 'tower' },
    ]);
  });

  it('with no year of readers, admits by editions alone and keeps the held it cannot read', async () => {
    const { items } = await classifyTowers(share(), held, sparql, signals(null));
    expect(items.map((item) => [item.qid, item.readershipNote])).toEqual([
      [GALATA.qid, undefined],
      [FORTY.qid, undefined],
      [KEPT.qid, undefined],
      [FALLEN.qid, keptNote({ qid: FALLEN.qid, editions: 20 }, 'no year of readers is read')],
    ]);
  });

  it('with no pool read, lets nothing new in and keeps the held towers with a note saying why', async () => {
    const { items, filtered } = await classifyTowers(share(false), held, sparql, signals());
    const because = 'no pool was read to set the bars this run';
    expect(items.map((item) => [item.qid, item.readershipNote])).toEqual([
      [KEPT.qid, keptNote({ qid: KEPT.qid, editions: 32 }, because)],
      [FALLEN.qid, keptNote({ qid: FALLEN.qid, editions: 20 }, because)],
    ]);
    // The rule's refusal of a candidate the shared pool named is still named.
    expect(ids(filtered.map((f) => ({ qid: f.externalId })))).toEqual([BURJ.qid]);
  });
});
