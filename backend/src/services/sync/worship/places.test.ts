import { describe, expect, it } from 'vitest';
import { classifyPlacesByFame, WORSHIP_READERS_LINE } from './places.js';
import { buildWorshipTrees, TYPE_ROOTS } from './classes.js';
import type { KindShare } from '../places/gather.js';
import type { WorshipTrees, WorshipType } from './classes.js';
import type { PoolEntity } from '../publicArt/queries.js';
import type { SourceLine } from '../sourceLine.js';

const MONASTERY = 'Q44613';
const LINE: SourceLine = { enterSitelinks: 22, staySitelinks: 18 };

const trees = buildWorshipTrees({
  worship: [MONASTERY],
  sacred: [],
  typeTrees: Object.fromEntries(TYPE_ROOTS.map(({ type }) => [type, []])) as unknown as Record<WorshipType, string[]>,
});

function shareOf(rows: Array<{ qid: string; label: string; sitelinks: number }>): KindShare<WorshipTrees> {
  const pool = new Map(rows.map((row) => [row.qid, { ...row, onEarth: true, lat: 48.6, lon: -1.5 } as PoolEntity]));
  const facts = new Map(rows.map((row) => [row.qid, { classes: [MONASTERY] }]));
  return { trees, pool, facts } as unknown as KindShare<WorshipTrees>;
}

describe('classifyPlacesByFame, the readers door', () => {
  // Mont-Saint-Michel Abbey (Q651388) reads 181,451 a year at 19 editions; the
  // other two rows are the door's edges.
  const share = shareOf([
    { qid: 'Q651388', label: 'Mont-Saint-Michel Abbey', sitelinks: 19 },
    { qid: 'Q1', label: 'Read under the bar', sitelinks: 19 },
    { qid: 'Q2', label: 'Held, read at the stay bar', sitelinks: 17 },
  ]);
  const readers = new Map([
    ['Q651388', 181_451],
    ['Q1', WORSHIP_READERS_LINE.enter - 1],
    ['Q2', WORSHIP_READERS_LINE.stay],
  ]);

  it('admits a place under the editions line that its readers carry, with the note a curator reads', () => {
    const { places } = classifyPlacesByFame(share, new Set(), LINE, readers);
    expect(places.get('Q651388')?.readersNote)
      .toBe('19 Wikipedia editions, under the line, and 181,451 readers a year: in by its readers (25,000 to enter)');
    expect(places.has('Q1')).toBe(false);
  });

  it('keeps a held place while it reads at the stay bar, and refuses it by name below it', () => {
    expect(classifyPlacesByFame(share, new Set(['Q2']), LINE, readers).places.has('Q2')).toBe(true);
    const fallen = classifyPlacesByFame(share, new Set(['Q2']), LINE, new Map([['Q2', WORSHIP_READERS_LINE.stay - 1]]));
    expect(fallen.places.has('Q2')).toBe(false);
    expect(fallen.filtered.find((row) => row.externalId === 'Q2')?.reason)
      .toBe('17 Wikipedia editions: below the world tier\'s line (22 to enter, 18 to stay), and 17,999 readers a year (18,000 to stay)');
  });

  it('decides on editions alone when no year of readers can be read', () => {
    const { places } = classifyPlacesByFame(share, new Set(), LINE, null);
    expect(places.size).toBe(0);
  });
});
