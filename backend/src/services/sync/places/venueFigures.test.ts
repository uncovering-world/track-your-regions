import { describe, expect, it } from 'vitest';
import type { SurroundingsPool, SurroundingsPoolRow } from './surroundingsPool.js';
import { venueFigures } from './venueFigures.js';

// Ids made up for the test: no figure here is a claim about a real item.
const SQUARE_CLASS = 'square-class';
const CHURCH_CLASS = 'church-class';
const row = (qid: string, classes: string[]): SurroundingsPoolRow => ({ qid, editions: 4, guideEditions: 0, readers: 7216, classes, lat: -22.93, lon: -43.18 });

const read = (venues: SurroundingsPool['venues']): SurroundingsPool => ({
  rows: new Map([
    ['Q-largo', row('Q-largo', [SQUARE_CLASS])],
    ['Q-street', row('Q-street', [SQUARE_CLASS])],
    ['Q-church', row('Q-church', [CHURCH_CLASS])],
  ]),
  around: new Map(),
  seconds: 1,
  venues,
});

const SQUARES = { sourceId: 9, classes: new Set([SQUARE_CLASS]) };
const CUT = { venueRadiusM: 200 };

describe('the venues a place pass keeps (#2454)', () => {
  it('keeps a square counted around its point and a street counted along its line, for the source whose places they are', () => {
    const figures = venueFigures(read({
      counts: new Map([['Q-largo', 36], ['Q-street', 4.2], ['Q-church', 12]]),
      along: new Map([['Q-street', { metres: 850.4, venues: 36, artery: false }]]),
      around: new Map(),
      arteries: new Set(),
    }), [SQUARES], CUT);
    expect(figures).toEqual([
      { sourceId: 9, qid: 'Q-largo', venues: 36, radiusM: 200, alongM: null },
      { sourceId: 9, qid: 'Q-street', venues: 4.2, radiusM: null, alongM: 850 },
    ]);
  });

  it('keeps nothing where the layer kept no venue, so the last kept figures stand', () => {
    expect(venueFigures(read({ unread: 'No venue layer is built' }), [SQUARES], CUT)).toBeNull();
    expect(venueFigures(read(undefined), [SQUARES], CUT)).toBeNull();
  });

  it('keeps nothing where no source of the pass reads venues', () => {
    expect(venueFigures(read({ counts: new Map([['Q-largo', 36]]), along: new Map(), around: new Map(), arteries: new Set() }), [], CUT)).toBeNull();
  });
});
