/**
 * The marks door through the public-art pipeline (ADR-0169): a marked work the
 * year reads over the bar enters whatever its editions, a held work is kept or
 * dropped by its marks, the door shut and not opened, and the door beside the
 * clock line (#2140). The world and the door are `pipelineFixture.ts`.
 */

import { describe, it, expect, vi } from 'vitest';

// The street-art entrance's reads of the database (#2035): no copy of English
// Wikipedia's categories, and no held street-art place.
vi.mock('../../dumps/wikipedia/structureTables.js', () => ({ latestStructure: vi.fn(async () => null) }));
vi.mock('../wikipediaStructure.js', () => ({ structureItemsInCategories: vi.fn(async () => []) }));
vi.mock('../admission.js', () => ({ admittedExternalIds: vi.fn(async () => new Set()) }));

import { classifyPublicArt, ENTER_SITELINKS, STAY_SITELINKS } from './pipeline.js';
import { belowLineUnmarkedReason, keptMarksNote, marksDoorNote } from './marksDoor.js';
import { emptyFacts, type PoolEntity } from './queries.js';
import { CLOCK_LINE } from './clockLine.js';
import { belowGuidedLine } from '../places/guidedLine.js';
import { PUBLIC_ART_RULE } from './kindRules.js';
import { doorTo, gatherPublicArt, SCULPTURE, type World } from './pipelineFixture.js';

describe('the marks door (ADR-0169)', () => {
  const LINE = { enterSitelinks: ENTER_SITELINKS, staySitelinks: STAY_SITELINKS };
  const world: World = {
    entities: [
      // A sculpture of 16 editions Atlas Obscura lists, read by 9,000: never in, nothing said.
      { qid: 'Q2', label: 'Little read', under: SCULPTURE, sitelinks: 16, classes: [SCULPTURE] },
      // A sculpture of 20 editions no mark names, read by 50,000: never in, nothing said.
      { qid: 'Q3', label: 'Unmarked', under: SCULPTURE, sitelinks: 20, classes: [SCULPTURE] },
      // Two held sculptures under the stay line: one a guide uses over the exit, one unmarked.
      { qid: 'Q4', label: 'Kept', under: SCULPTURE, sitelinks: STAY_SITELINKS - 1, classes: [SCULPTURE] },
      { qid: 'Q5', label: 'Fell', under: SCULPTURE, sitelinks: STAY_SITELINKS - 1, classes: [SCULPTURE] },
    ],
  };
  const held = new Set(['Q4', 'Q5']);
  const marks = {
    guided: new Set(['Q254602', 'Q4']),
    atlas: new Set(['Q254602', 'Q2']),
    readers: new Map([['Q254602', 61_000], ['Q2', 9_000], ['Q3', 50_000], ['Q4', 17_000], ['Q5', 30_000]]),
  };

  it('admits a marked work the year reads over the bar, whatever its editions, and keeps or drops a held work by its marks', async () => {
    // Cadillac Ranch: 10 editions, a guide and Atlas Obscura, 61,000 readers a year — under the
    // pool's floor, joined to the share the way the under-floor read joins it (`shareWithMarksDoor`).
    const ranch: PoolEntity = {
      qid: 'Q254602', label: 'Cadillac Ranch', description: null, lat: 35.19, lon: -101.99, onEarth: true, imageUrl: null,
      itemPictures: [], sitelinks: 10, countryLabel: null, articleUrl: null, website: null, year: null,
    };
    const share = await gatherPublicArt(doorTo(world), held);
    const gathered = {
      ...share,
      pool: new Map([...share.pool, [ranch.qid, ranch]]),
      facts: new Map([...share.facts, [ranch.qid, { ...emptyFacts(), classes: [SCULPTURE] }]]),
    };
    const { items, filtered } = classifyPublicArt(gathered, PUBLIC_ART_RULE, held, undefined, null, null, undefined, undefined, marks);
    expect(items.map((i) => [i.qid, i.type, i.readershipNote])).toEqual([
      ['Q4', 'sculpture', marksDoorNote(STAY_SITELINKS - 1, 17_000, ['a Wikivoyage guide uses it'], LINE)],
      ['Q254602', 'sculpture', marksDoorNote(10, 61_000, ['a Wikivoyage guide uses it', 'Atlas Obscura lists it'], LINE)],
    ]);
    expect(filtered).toEqual([{
      externalId: 'Q5', name: 'Fell', reason: belowLineUnmarkedReason(STAY_SITELINKS - 1, 30_000, [], LINE), type: 'sculpture',
    }]);
  });

  it('shut, lets nothing in and keeps the held works with a note saying why', async () => {
    const gathered = await gatherPublicArt(doorTo(world), held);
    const { items, filtered } = classifyPublicArt(gathered, PUBLIC_ART_RULE, held, undefined, null, null, undefined, undefined, null);
    expect(items.map((i) => [i.qid, i.readershipNote])).toEqual([
      ['Q4', keptMarksNote(STAY_SITELINKS - 1, null, LINE)],
      ['Q5', keptMarksNote(STAY_SITELINKS - 1, null, LINE)],
    ]);
    expect(filtered).toEqual([]);
  });

  it('is no door of a kind that does not open it: the line alone decides', async () => {
    const gathered = await gatherPublicArt(doorTo(world), held);
    const { items, filtered } = classifyPublicArt(gathered, PUBLIC_ART_RULE, held);
    expect(items).toEqual([]);
    expect(filtered.map((f) => f.externalId)).toEqual(['Q4', 'Q5']);
  });
});

describe('the marks door beside the clock line (#2140, ADR-0169)', () => {
  const GLOCKENSPIEL = 'Q20826189';
  const world: World = {
    entities: [
      // A held Glockenspiel of 6 editions read 12,000 times a year: the clock line keeps it (4 and 10,000 to stay).
      { qid: 'Q1', label: 'Held Glockenspiel', under: GLOCKENSPIEL, sitelinks: 6, classes: [GLOCKENSPIEL] },
      // A Glockenspiel never in, of 6 editions, that Atlas Obscura lists and 25,000 read: the marks door admits it.
      { qid: 'Q2', label: 'Listed Glockenspiel', under: GLOCKENSPIEL, sitelinks: 6, classes: [GLOCKENSPIEL] },
    ],
  };
  const held = new Set(['Q1']);
  const clockReaders = new Map([['Q1', 12_000], ['Q2', 12_000]]);

  it('leaves a held public clock under the stay line to its own line, open door or shut', async () => {
    const gathered = await gatherPublicArt(doorTo(world), held);
    const marks = { guided: new Set<string>(), atlas: new Set(['Q2']), readers: new Map([['Q1', 12_000], ['Q2', 25_000]]) };
    const open = classifyPublicArt(gathered, PUBLIC_ART_RULE, held, undefined, null, null, clockReaders, undefined, marks);
    expect(open.items.map((i) => [i.qid, i.type, i.readershipNote])).toEqual([
      ['Q1', 'clock', undefined],
      ['Q2', 'clock', marksDoorNote(6, 25_000, ['Atlas Obscura lists it'], { enterSitelinks: ENTER_SITELINKS, staySitelinks: STAY_SITELINKS })],
    ]);
    expect(open.filtered).toEqual([]);
    const shut = classifyPublicArt(gathered, PUBLIC_ART_RULE, held, undefined, null, null, clockReaders, undefined, null);
    expect(shut.items.map((i) => [i.qid, i.readershipNote])).toEqual([['Q1', undefined]]);
    expect(shut.filtered).toEqual([]);
  });
});

describe('a held public clock the marks door admitted (ADR-0169, #2140)', () => {
  const GLOCKENSPIEL = 'Q20826189';
  const LINE = { enterSitelinks: ENTER_SITELINKS, staySitelinks: STAY_SITELINKS };
  const world: World = {
    entities: [
      // A held Glockenspiel of 3 editions Atlas Obscura lists, read 25,000 times: under the clock
      // line's four editions, kept by the door that admitted it rather than dropped and re-admitted.
      { qid: 'Q1', label: 'Listed, held', under: GLOCKENSPIEL, sitelinks: 3, classes: [GLOCKENSPIEL] },
      // A held Glockenspiel of 3 editions no mark names: the clock line's reason.
      { qid: 'Q2', label: 'Unmarked, held', under: GLOCKENSPIEL, sitelinks: 3, classes: [GLOCKENSPIEL] },
    ],
  };
  const held = new Set(['Q1', 'Q2']);
  const clockReaders = new Map([['Q1', 25_000], ['Q2', 25_000]]);

  it('keeps the clock the open door keeps, and refuses the other with the clock line\'s reason', async () => {
    const gathered = await gatherPublicArt(doorTo(world), held);
    const marks = { guided: new Set<string>(), atlas: new Set(['Q1']), readers: new Map([['Q1', 25_000], ['Q2', 25_000]]) };
    const { items, filtered } = classifyPublicArt(gathered, PUBLIC_ART_RULE, held, undefined, null, null, clockReaders, undefined, marks);
    expect(items.map((i) => [i.qid, i.readershipNote])).toEqual([['Q1', marksDoorNote(3, 25_000, ['Atlas Obscura lists it'], LINE)]]);
    expect(filtered.map((f) => [f.externalId, f.reason])).toEqual([['Q2', belowGuidedLine(CLOCK_LINE, 3, 25_000, false)]]);
  });

  it('with the door shut, a held clock the clock line drops keeps its place like any held work', async () => {
    const gathered = await gatherPublicArt(doorTo(world), held);
    const { items, filtered } = classifyPublicArt(gathered, PUBLIC_ART_RULE, held, undefined, null, null, clockReaders, undefined, null);
    expect(items.map((i) => [i.qid, i.readershipNote])).toEqual([
      ['Q1', keptMarksNote(3, 25_000, LINE)],
      ['Q2', keptMarksNote(3, 25_000, LINE)],
    ]);
    expect(filtered).toEqual([]);
  });
});
