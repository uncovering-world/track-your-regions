/**
 * ADR-0175's world bars: three quantiles of a kind's own pool, entered at any
 * one, stayed at 0.8 of any, and what a run that cannot read a bar does.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../publicArt/streetArtQueries.js', () => ({ fetchStreetArtMarks: vi.fn(async () => new Map()) }));

import {
  barsLine, barsToAdmitBy, belowWorldBars, quantile, reachesABar, readAtlas, worldBars, worldStanding,
  type WorldBars, type WorldMemory, type WorldRead,
} from './worldBars.js';
import { MEASURED_BARS, WORLD_FRAME, WORLD_REGISTER } from './admissionRegister.js';
import { fetchStreetArtMarks } from '../publicArt/streetArtQueries.js';
import type { SparqlFn } from '../wikidataQueries.js';

// Places of worship's bars as the review read them on 2026-11-02.
const WORSHIP: WorldBars = { ...MEASURED_BARS.value['places-of-worship'], pool: 56_962 };

const read = (readers: Record<string, number> | null, guided: string[] | null = [], atlas: string[] = []): WorldRead => ({
  readers: readers && new Map(Object.entries(readers)),
  guided: guided && new Set(guided),
  atlas: new Set(atlas),
});

const COLOGNE = { qid: 'Q4176', editions: 89 };
// A village church, read a few hundred times a year.
const VILLAGE = { qid: 'Q100', editions: 4 };

describe('quantile', () => {
  it('reads the value at round(q × (n − 1)) of the sorted values, as the review did', () => {
    const values = [5, 1, 4, 2, 3, 9, 7, 8, 6, 10];
    expect(quantile(values, 0.97)).toBe(10);
    expect(quantile(values, 0.9)).toBe(9);
    expect(quantile(values, 0.5)).toBe(6);
    expect(quantile([7], 0.98)).toBe(7);
  });

  it('refuses an empty pool rather than inventing a bar', () => {
    expect(() => quantile([], 0.97)).toThrow();
  });
});

describe('worldBars', () => {
  it('reads each bar off the pool at its register level, and the readers of an item nobody reads as none', () => {
    const pool = Array.from({ length: 101 }, (_, i) => ({ qid: `Q${i + 1}`, editions: i }));
    const readers = new Map(pool.map((c) => [c.qid, c.editions * 1_000]));
    readers.delete('Q1');
    expect(worldBars(pool, readers)).toEqual({ editions: 97, readers: 98_000, guidedReaders: 90_000, pool: 101 });
  });

  it('reads the editions bar alone when no year of readers is read, and none over an empty pool', () => {
    const pool = Array.from({ length: 101 }, (_, i) => ({ qid: `Q${i + 1}`, editions: i }));
    expect(worldBars(pool, null)).toEqual({ editions: 97, readers: null, guidedReaders: null, pool: 101 });
    expect(worldBars([], new Map())).toBeNull();
  });

  it('never sets a bar of nothing, which would admit the whole pool', () => {
    const pool = Array.from({ length: 50 }, (_, i) => ({ qid: `Q${i + 1}`, editions: 0 }));
    expect(worldBars(pool, new Map())).toEqual({ editions: 1, readers: 1, guidedReaders: 1, pool: 50 });
  });

  it('holds the levels the maintainer\'s rule chose, each with its derivation, evidence and date', () => {
    expect([WORLD_FRAME.editionsQuantile, WORLD_FRAME.readersQuantile, WORLD_FRAME.guidedQuantile, WORLD_FRAME.stayShare])
      .toEqual([0.97, 0.98, 0.9, 0.8]);
    for (const parameter of Object.values(WORLD_REGISTER)) {
      expect(parameter.derivation.length).toBeGreaterThan(20);
      expect(parameter.evidence).toMatch(/^docs\/research\/2026-11-02-one-admission-frame-for-the-place-kinds\.md § /);
      expect(parameter.date).toBe('2026-11-02');
    }
  });
});

describe('worldStanding', () => {
  it('lets a place in at any one of the three bars', () => {
    // Cologne Cathedral is in by its editions whatever it is read.
    expect(worldStanding(COLOGNE, read({}), WORSHIP, false)).toEqual({ by: 'editions' });
    // A church in 9 editions read 60,000 times a year is in by its readers.
    expect(worldStanding({ qid: 'Q2', editions: 9 }, read({ Q2: 60_000 }), WORSHIP, false)).toEqual({ by: 'readers' });
    // A guided church read 12,000 times is in by the third bar; unguided, it is out.
    expect(worldStanding({ qid: 'Q3', editions: 9 }, read({ Q3: 12_000 }, ['Q3']), WORSHIP, false)).toEqual({ by: 'guided' });
    expect(worldStanding({ qid: 'Q3', editions: 9 }, read({ Q3: 12_000 }), WORSHIP, false)).toBe('out');
    // An Atlas Obscura listing marks it as a guide does.
    expect(worldStanding({ qid: 'Q3', editions: 9 }, read({ Q3: 12_000 }, [], ['Q3']), WORSHIP, false)).toEqual({ by: 'guided' });
  });

  it('keeps a place the last run admitted at 0.8 of any bar, and names the bars when it falls under all', () => {
    // 13 editions is 0.8 of 16: a held church stays on it, a new one does not enter.
    expect(worldStanding({ qid: 'Q4', editions: 13 }, read({ Q4: 1_000 }), WORSHIP, true)).toEqual({ by: 'editions' });
    expect(worldStanding({ qid: 'Q4', editions: 13 }, read({ Q4: 1_000 }), WORSHIP, false)).toBe('out');
    // 40,000 readers is over 0.8 of 49,634.
    expect(worldStanding({ qid: 'Q5', editions: 5 }, read({ Q5: 40_000 }), WORSHIP, true)).toEqual({ by: 'readers' });
    expect(worldStanding(VILLAGE, read({ Q100: 400 }), WORSHIP, true)).toEqual({ fell: belowWorldBars(VILLAGE, read({ Q100: 400 }), WORSHIP) });
  });

  it('never drops a held place for what the run could not read', () => {
    // No pool read: nothing enters, the held stay.
    expect(worldStanding(COLOGNE, read({}), null, false)).toBe('out');
    expect(worldStanding(VILLAGE, read({}), null, true)).toEqual({ kept: 'no pool was read to set the bars this run' });
    // No year of readers: the editions bar still admits, and a held place under it keeps its place.
    const noYear = { ...WORSHIP, readers: null, guidedReaders: null };
    expect(worldStanding(COLOGNE, read(null), noYear, false)).toEqual({ by: 'editions' });
    expect(worldStanding(VILLAGE, read(null), noYear, true)).toEqual({ kept: 'no year of readers is read' });
    // No usage build: a held place read over the third bar's stay is kept, one read under it falls.
    expect(worldStanding({ qid: 'Q6', editions: 5 }, read({ Q6: 9_000 }, null), WORSHIP, true))
      .toEqual({ kept: 'no Wikivoyage usage is built to read whether a guide uses it' });
    expect('fell' in (worldStanding({ qid: 'Q6', editions: 5 }, read({ Q6: 2_000 }, null), WORSHIP, true) as object)).toBe(true);
  });
});

describe('reachesABar', () => {
  it('says whether a candidate would enter, so a rule\'s refusal of it is news', () => {
    expect(reachesABar(COLOGNE, read({}), WORSHIP)).toBe(true);
    expect(reachesABar(VILLAGE, read({ Q100: 400 }), WORSHIP)).toBe(false);
    expect(reachesABar(COLOGNE, read({}), null)).toBe(false);
  });
});

describe('the words', () => {
  it('names the signals and every bar in a fallen place\'s reason', () => {
    expect(belowWorldBars(VILLAGE, read({ Q100: 400 }), WORSHIP)).toBe(
      "4 Wikipedia editions and 400 readers a year, no guide uses it and Atlas Obscura does not list it: under the world tier's bars "
      + '(16 Wikipedia editions, 49,634 readers a year, or 10,577 where a guide uses it or Atlas Obscura lists it; a place held stays at 0.8 of any)',
    );
  });

  it('names the three bars as numbers in the run\'s line', () => {
    expect(barsLine('[Worship Sync]', WORSHIP)).toBe(
      '[Worship Sync] World bars over a pool of 56,962 (quantiles 0.97, 0.98, 0.9): 16 Wikipedia editions, 49,634 readers a year, '
      + 'or 10,577 where a guide uses it or Atlas Obscura lists it; a held place stays at 0.8 of any',
    );
    expect(barsLine('[Towers]', null)).toBe('[Towers] World bars: no pool read this run, so nothing new enters and the held keep their place');
  });
});

describe('what a run cannot read (ADR-0175 decision 6)', () => {
  // Public art's bars as the review read them, kept by run 812 over its year.
  const ART = MEASURED_BARS.value['public-art'];
  const YEAR = '2025-10 to 2026-09';
  const KEPT: WorldMemory['bars'] = { readers: ART.readers, guidedReaders: ART.guidedReaders, year: YEAR, logId: 812 };
  // Munich's Glockenspiel: 7 editions, 65,572 readers a year, listed by Atlas Obscura; the village church read 400 times.
  const GLOCKENSPIEL = { qid: 'Q7295591', editions: 7 };
  const memory = (over: Partial<WorldMemory> = {}): WorldMemory => ({
    bars: KEPT,
    readers: new Map([['Q7295591', 65_572], ['Q100', 400]]),
    guided: new Map([['Q7295591', false], ['Q100', false]]),
    ...over,
  });
  const noYear = (over: Partial<WorldRead> = {}): WorldRead => ({ readers: null, guided: new Set(), atlas: new Set(), memory: memory(), ...over });
  const pool = Array.from({ length: 101 }, (_, i) => ({ qid: `Q${i + 1}`, editions: i }));

  it('admits by the readers\' bars the last run that read a year computed, and by this run\'s editions bar', () => {
    expect(barsToAdmitBy(worldBars(pool, null), noYear()))
      .toEqual({ editions: 97, readers: ART.readers, guidedReaders: ART.guidedReaders, pool: 101, year: YEAR, keptFrom: 812 });
    // With no run before it that read a year, the editions bar alone, as before.
    expect(barsToAdmitBy(worldBars(pool, null), noYear({ memory: memory({ bars: null }) })))
      .toEqual({ editions: 97, readers: null, guidedReaders: null, pool: 101 });
  });

  it('admits by its own numbers when it reads a year, whatever an earlier run kept', () => {
    // A run that reads a year sets every bar off its own pool and names its year.
    const readers = new Map(pool.map((c) => [c.qid, c.editions * 1_000]));
    const fresh: WorldRead = { readers, guided: new Set(), atlas: new Set(), year: YEAR, memory: memory() };
    expect(barsToAdmitBy(worldBars(pool, readers), fresh))
      .toEqual({ editions: 97, readers: 98_000, guidedReaders: 90_000, pool: 101, year: YEAR });
    // Cologne Cathedral is in by its editions; and a place this run's year does not name reads as nobody's,
    // not as last read: the Glockenspiel, unread this year and unlisted, falls.
    expect(worldStanding(COLOGNE, { ...fresh, readers: new Map([['Q4176', 2_147_381]]) }, WORSHIP, false)).toEqual({ by: 'editions' });
    expect(worldStanding(GLOCKENSPIEL, { ...fresh, readers: new Map() }, { ...ART, pool: 3_614 }, true))
      .toEqual({ fell: expect.stringContaining('7 Wikipedia editions and 0 readers a year, no guide') });
  });

  it('keeps a held place on its readers as last read, and lets one fall by them where they are under every bar', () => {
    const bars = { ...ART, pool: 3_614, year: YEAR, keptFrom: 812 };
    // The Glockenspiel stays on the third bar: 65,572 readers as last read, and Atlas Obscura lists it.
    expect(worldStanding(GLOCKENSPIEL, noYear({ atlas: new Set(['Q7295591']) }), bars, true)).toEqual({ by: 'guided' });
    // The village church, 400 readers a year as last read and 4 editions, is under every bar: it falls, and the reason says so.
    expect(worldStanding(VILLAGE, noYear(), bars, true))
      .toEqual({ fell: expect.stringContaining('4 Wikipedia editions and 400 readers a year as last read') });
    // A held place no year was ever read for is kept: unknown is not zero.
    expect(worldStanding({ qid: 'Q9', editions: 4 }, noYear(), bars, true)).toEqual({ kept: 'no year of readers is read' });
    expect(worldStanding({ qid: 'Q9', editions: 4 }, noYear(), bars, false)).toBe('out');
  });

  it('reads a guide\'s mark as last read where no usage build is in place, and a place no build was read for as unknown', () => {
    // Erfurt's Krämerbrücke: 16 editions and 54,022 readers, a guide's, under Bridges' editions and readers bars.
    const BRIDGES: WorldBars = { ...MEASURED_BARS.value['bridges-and-engineering'], pool: 41_000 };
    const KRAMER = { qid: 'Q896890', editions: 16 };
    const noBuild = (guided: ReadonlyMap<string, boolean>): WorldRead =>
      ({ readers: new Map([['Q896890', 54_022]]), guided: null, atlas: new Set(), memory: memory({ guided }) });
    expect(worldStanding(KRAMER, noBuild(new Map([['Q896890', true]])), BRIDGES, false)).toEqual({ by: 'guided' });
    expect(worldStanding(KRAMER, noBuild(new Map([['Q896890', false]])), BRIDGES, false)).toBe('out');
    // Unread, as before: nothing new enters by it, and a held place it would decide keeps its place.
    expect(worldStanding(KRAMER, noBuild(new Map()), BRIDGES, false)).toBe('out');
    const read20k: WorldRead = { readers: new Map([['Q9', 20_000]]), guided: null, atlas: new Set(), memory: memory({ guided: new Map() }) };
    expect(worldStanding({ qid: 'Q9', editions: 5 }, read20k, BRIDGES, true))
      .toEqual({ kept: 'no Wikivoyage usage is built to read whether a guide uses it' });
  });

  it('asks Atlas Obscura of the places whose readers as last read could clear the third bar', async () => {
    const sparql: SparqlFn = async () => [];
    vi.mocked(fetchStreetArtMarks).mockResolvedValueOnce(new Map([['Q7295591', { atlasObscura: true, ended: false }]]));
    const atlas = await readAtlas(sparql, ['Q7295591', 'Q100', 'Q9'], noYear(), { ...ART, pool: 3_614, keptFrom: 812, year: YEAR });
    expect([...atlas]).toEqual(['Q7295591']);
    // The village church is read too little, and Q9 was never read: neither is asked.
    expect(fetchStreetArtMarks).toHaveBeenCalledWith(sparql, ['Q7295591']);
  });

  it('says in the run\'s line which bars it kept, and that the guides are as last read', () => {
    expect(barsLine('[Landmark Sync] public art:', { ...ART, pool: 3_614, year: YEAR, keptFrom: 812 }, noYear({ guided: null }))).toBe(
      '[Landmark Sync] public art: World bars over a pool of 3,614 (quantiles 0.97, 0.98, 0.9, readers over 2025-10 to 2026-09): '
      + '17 Wikipedia editions, 93,029 readers a year, or 20,871 where a guide uses it or Atlas Obscura lists it; a held place stays at 0.8 of any'
      + "; no year of readers is read, so the readers' bars are run 812's and each place's readers are as last read"
      + '; no Wikivoyage usage is built, so whether a guide uses a place is as last read',
    );
  });
});
