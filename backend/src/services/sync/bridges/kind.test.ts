/**
 * Bridges & engineering marvels' world tier (ADR-0175): the rule, then the
 * three bars read off the kind's own pool — a dam a traveller crosses Japan
 * for in, a water-supply dam out, whatever a guide says of it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readershipYear, readWorks } from '../../dumps/readership/workReadership.js';
import { latestUsage, usedByAGuide } from '../../dumps/wikivoyage/usageTables.js';

vi.mock('../../dumps/readership/workReadership.js', () => ({ readershipYear: vi.fn(), readWorks: vi.fn() }));
vi.mock('../../dumps/wikivoyage/usageTables.js', () => ({ latestUsage: vi.fn(), usedByAGuide: vi.fn() }));
vi.mock('../publicArt/streetArtQueries.js', () => ({ fetchStreetArtMarks: vi.fn(async () => new Map()) }));

import type { PoolEntity } from '../publicArt/queries.js';
import type { KindShare } from '../places/gather.js';
import type { SparqlFn } from '../wikidataQueries.js';
import { emptyContainment } from '../places/containment.js';
import { guidedBarNote, keptNote, type WorldBars, type WorldMemory, type WorldRead } from '../places/worldBars.js';
import type { BridgeTrees } from './classes.js';
import { classifyBridges } from './kind.js';

const BRIDGE = 'Q12280';
const DAM = 'Q12323';
const LOCK = 'Q105731';
const DESTROYED = 'Q19860854';
const none = new Set<string>();
const trees: BridgeTrees = {
  work: new Set([BRIDGE, DAM, LOCK]),
  types: {
    aqueduct: none, bridge: new Set([BRIDGE]), dam: new Set([DAM]), 'inclined-plane': none, 'boat-lift': none,
    'lock-flight': none, lock: new Set([LOCK]), tunnel: none,
  },
  kills: { destroyed: new Set([DESTROYED]), proposed: none, proposedTunnel: none, underConstruction: none, ruins: none },
  others: { river: none, railwayLine: none },
  archaeologicalSite: none,
  canal: none,
  powerStation: none,
};
const entity = (qid: string, label: string, sitelinks: number): PoolEntity => ({
  qid, label, description: null, lat: 36.57, lon: 137.66, onEarth: true, imageUrl: null, itemPictures: [],
  sitelinks, countryLabel: null, articleUrl: null, website: null, year: null,
});

// A pool of 51 works the rule passes: the 97th and 98th percentiles are the
// second highest value, the 90th the sixth.
const CHARLES = entity('Q204871', 'Charles Bridge', 61);
const FORTY = entity('Q9000040', 'A bridge read 200,000 times a year in 40 editions', 40);
const HELD = entity('Q9000033', 'A bridge the last run admitted, in 33 editions', 33);
const KHAJU = entity('Q1740490', 'Khaju Bridge', 25);
const KUROBE = entity('Q1208749', 'Kurobe Dam', 15);
const WIVENHOE = entity('Q1801107', 'Wivenhoe Dam', 5);
const CAEN_HILL = entity('Q3577623', 'Caen Hill Locks', 3);
const WELL_READ = Array.from({ length: 4 }, (_, i) => entity(`Q90001${i}`, 'A viaduct read 15,000 times a year in 5 editions', 5));
const TAIL = Array.from({ length: 40 }, (_, i) => entity(`Q9100${100 + i}`, "A bridge in the pool's tail", 3));
const POLCEVERA = entity('Q3907993', 'Polcevera Viaduct', 37);

const CLASSES: Record<string, string[]> = {
  [KUROBE.qid]: [DAM], [WIVENHOE.qid]: [DAM], [CAEN_HILL.qid]: [LOCK], [POLCEVERA.qid]: [BRIDGE, DESTROYED],
};
const WORKS = [CHARLES, FORTY, HELD, KHAJU, KUROBE, WIVENHOE, CAEN_HILL, ...WELL_READ, ...TAIL, POLCEVERA];
const READERS: Record<string, number> = {
  Q204871: 518_395, Q9000040: 200_000, Q9000033: 3_000, Q1740490: 43_351, Q1208749: 146_576, Q1801107: 9_015, Q3577623: 20_544,
  ...Object.fromEntries(WELL_READ.map((e) => [e.qid, 15_000])),
  ...Object.fromEntries(TAIL.map((e) => [e.qid, 1_000])),
};
const GUIDED = [CHARLES.qid, KHAJU.qid, KUROBE.qid, WIVENHOE.qid];
// The second highest editions (40) and readers (200,000), the sixth highest readers (15,000).
const BARS: WorldBars = { editions: 40, readers: 200_000, guidedReaders: 15_000, pool: 51 };

const share = (): KindShare<BridgeTrees> => ({
  trees,
  pool: new Map(WORKS.map((e) => [e.qid, e])),
  byId: new Set(),
  facts: new Map(WORKS.map((e) => [e.qid, { classes: CLASSES[e.qid] ?? [BRIDGE] }])) as never,
  containers: emptyContainment(),
  subjects: new Map(),
  entered: new Set(),
  enteredOnly: new Set(),
  admissionPool: new Set(WORKS.map((e) => e.qid)),
});
const sparql: SparqlFn = () => Promise.reject(new Error('no question reaches Wikidata here'));
const signals: WorldRead = { readers: new Map(Object.entries(READERS)), guided: new Set(GUIDED), atlas: new Set() };

beforeEach(() => vi.clearAllMocks());

describe('classifyBridges', () => {
  it('admits at any one of the bars its own pool sets, and refuses what the rule refuses by name', async () => {
    const result = await classifyBridges(share(), new Set([HELD.qid]), sparql, signals);
    // The Kurobe Dam is in on a guide's mark and 146,576 readers; the Wivenhoe Dam, a guide's too,
    // is read 9,015 times, under the 15,000 the pool sets for a marked work. Caen Hill's flight, in 3
    // editions and no guide, reaches no bar: the canal works' own line is gone with the picked lines.
    expect(result.items.map((item) => [item.qid, item.type])).toEqual([
      [CHARLES.qid, 'bridge'], [FORTY.qid, 'bridge'], [HELD.qid, 'bridge'], [KHAJU.qid, 'bridge'], [KUROBE.qid, 'dam'],
    ]);
    expect(result.items.find((item) => item.qid === KUROBE.qid)?.readershipNote)
      .toBe(guidedBarNote({ qid: KUROBE.qid, editions: 15 }, signals, BARS));
    expect(result.fetched).toBe(52);
    expect(result.filtered).toEqual([{ externalId: POLCEVERA.qid, name: 'Polcevera Viaduct', reason: 'destroyed or demolished' }]);
  });

  it('reads the year and the guides itself, and keeps a held work a guide would decide while no usage build is in place', async () => {
    vi.mocked(readershipYear).mockResolvedValue({ months: ['2026-09-01'], editions: ['enwiki'] } as never);
    vi.mocked(readWorks).mockImplementation(async (_year, qids) =>
      ({ views: new Map(qids.filter((q) => READERS[q]).map((q) => [q, READERS[q]])) }) as never);
    vi.mocked(latestUsage).mockResolvedValue(null);
    const result = await classifyBridges(share(), new Set([HELD.qid, KHAJU.qid]), sparql);
    expect(result.items.map((item) => [item.qid, item.readershipNote])).toEqual([
      [CHARLES.qid, undefined], [FORTY.qid, undefined], [HELD.qid, undefined],
      [KHAJU.qid, keptNote({ qid: KHAJU.qid, editions: 25 }, 'no Wikivoyage usage is built to read whether a guide uses it')],
    ]);
    expect(usedByAGuide).not.toHaveBeenCalled();
  });
});

describe('classifyBridges when a run cannot read a signal (ADR-0175 decision 6)', () => {
  const YEAR = { months: ['2025-10-01', '2026-09-01'], editions: ['enwiki'] };
  // What the source's last runs read: the bars run 812 computed over its year, and each membership's signals.
  const members = [CHARLES, HELD, KHAJU, KUROBE, WIVENHOE];
  const history = (bars: WorldMemory['bars'] = { readers: 200_000, guidedReaders: 15_000, year: '2025-10 to 2026-09', logId: 812 }) => ({
    memory: {
      bars,
      readers: new Map(members.map((e) => [e.qid, READERS[e.qid]])),
      guided: new Map(members.map((e) => [e.qid, GUIDED.includes(e.qid)])),
    },
    keep: vi.fn(async () => undefined),
  });
  const readWith = (year: typeof YEAR | null) => {
    vi.mocked(readershipYear).mockResolvedValue(year as never);
    vi.mocked(readWorks).mockImplementation(async (_year, qids) =>
      ({ views: new Map(qids.filter((q) => READERS[q]).map((q) => [q, READERS[q]])) }) as never);
  };

  it('admits by the bars and the readers it last read when no year is read, and keeps the bars it admitted by', async () => {
    readWith(null);
    vi.mocked(latestUsage).mockResolvedValue({ dumpDate: '2026-10-01' } as never);
    vi.mocked(usedByAGuide).mockResolvedValue(new Set(GUIDED));
    const kept = history();
    const result = await classifyBridges(share(), new Set([HELD.qid]), sparql, undefined, kept);
    // The Kurobe Dam is in again on its guide's mark and its 146,576 readers as last read: the year's absence
    // is not its readers' absence. A viaduct the last run never read stays out, as nothing vouches for it.
    expect(result.items.map((item) => item.qid)).toEqual([CHARLES.qid, FORTY.qid, HELD.qid, KHAJU.qid, KUROBE.qid]);
    expect(kept.keep).toHaveBeenCalledWith({ editions: 40, readers: 200_000, guidedReaders: 15_000, pool: 51, year: '2025-10 to 2026-09', keptFrom: 812 });
  });

  it('reads the year it has whatever an earlier run kept, and keeps its own bars', async () => {
    readWith(YEAR);
    vi.mocked(latestUsage).mockResolvedValue({ dumpDate: '2026-10-01' } as never);
    vi.mocked(usedByAGuide).mockResolvedValue(new Set(GUIDED));
    // Bars kept from an earlier run that no viaduct reaches: a run that reads a year sets its own.
    const kept = history({ readers: 10_000_000, guidedReaders: 10_000_000, year: '2024-10 to 2025-09', logId: 700 });
    const result = await classifyBridges(share(), new Set([HELD.qid]), sparql, undefined, kept);
    expect(result.items.map((item) => item.qid)).toEqual([CHARLES.qid, FORTY.qid, HELD.qid, KHAJU.qid, KUROBE.qid]);
    expect(kept.keep).toHaveBeenCalledWith({ ...BARS, year: '2025-10 to 2026-09' });
  });

  it('reads a guide\'s mark as last read when no usage build is in place', async () => {
    readWith(YEAR);
    vi.mocked(latestUsage).mockResolvedValue(null);
    const result = await classifyBridges(share(), new Set([HELD.qid]), sparql, undefined, history());
    // The Kurobe Dam is in on the guide's mark as last read; without the source's history it would not be.
    expect(result.items.map((item) => item.qid)).toContain(KUROBE.qid);
    const unread = await classifyBridges(share(), new Set([HELD.qid]), sparql);
    expect(unread.items.map((item) => item.qid)).not.toContain(KUROBE.qid);
    expect(usedByAGuide).not.toHaveBeenCalled();
  });

  it('admits by editions alone, as before, where no run of the source has read a year', async () => {
    readWith(null);
    vi.mocked(latestUsage).mockResolvedValue({ dumpDate: '2026-10-01' } as never);
    vi.mocked(usedByAGuide).mockResolvedValue(new Set(GUIDED));
    const result = await classifyBridges(share(), new Set([HELD.qid, KUROBE.qid]), sparql, undefined, history(null));
    // The held dam has no readers' bar to stay on and is kept, with the note why; nothing enters on readers.
    expect(result.items.map((item) => [item.qid, item.readershipNote])).toEqual([
      [CHARLES.qid, undefined], [FORTY.qid, undefined], [HELD.qid, undefined],
      [KUROBE.qid, keptNote({ qid: KUROBE.qid, editions: 15 }, 'no year of readers is read')],
    ]);
  });
});
