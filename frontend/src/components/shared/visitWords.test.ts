/**
 * Where a card offers "Visited, not sure which part" (#2120), and how a
 * whole's count reads (ADR-0206).
 */

import { describe, expect, it } from 'vitest';
import { cardVisitCount, offersWholeTick, wholeCountLabel } from './visitWords';

const NOT_BEEN = { ticked: false, progress: undefined };
const STRUVE = { has_parts: true };
const SHOWS_ONLY_PARTS = { has_own_point: false };

describe('the whole tick on a card', () => {
  it('is offered on a whole that shows only its parts: the Struve Arc', () => {
    expect(offersWholeTick({ has_parts: true }, { has_own_point: false }, NOT_BEEN)).toBe(true);
  });

  it("is not offered on a whole with a point of its own, whose tick is that point's: the City of Graz", () => {
    expect(offersWholeTick({ has_parts: true }, { has_own_point: true }, NOT_BEEN)).toBe(false);
  });

  it('is not offered on a place of no parts, nor while the card is still reading', () => {
    expect(offersWholeTick({ has_parts: false }, { has_own_point: false }, NOT_BEEN)).toBe(false);
    expect(offersWholeTick({ has_parts: true }, undefined, NOT_BEEN)).toBe(false);
  });

  it('stays offered while the whole reads "? of 34", ticked as a whole', () => {
    const ticked = { ticked: true, progress: { visited: null, total: 34 } };
    expect(offersWholeTick(STRUVE, SHOWS_ONLY_PARTS, ticked)).toBe(true);
  });

  it('is not offered once a station is named, "1 of 34", unless the whole\'s own tick stands to be taken back', () => {
    const named = { visited: 1, total: 34 };
    expect(offersWholeTick(STRUVE, SHOWS_ONLY_PARTS, { ticked: false, progress: named })).toBe(false);
    expect(offersWholeTick(STRUVE, SHOWS_ONLY_PARTS, { ticked: true, progress: named })).toBe(true);
  });
});

describe("a whole's count", () => {
  it('reads k of N after a visit: the Struve Arc after one station', () => {
    expect(wholeCountLabel(34, { visited: 1, total: 34 }, true))
      .toEqual({ text: '1 of 34', name: '1 of 34 places visited', share: 1 / 34 });
  });

  it('reads "?" when the whole is visited and no place of it is named', () => {
    expect(wholeCountLabel(34, { visited: null, total: 34 }, true))
      .toMatchObject({ text: '? of 34', name: 'Visited, places not named, of 34 places', share: 0 });
  });

  it('reads 0 of N to a traveller who has not been there, and N places to a visitor signed out', () => {
    expect(wholeCountLabel(34, undefined, true)?.text).toBe('0 of 34');
    expect(wholeCountLabel(34, undefined, false)?.text).toBe('34 places');
    expect(wholeCountLabel(34, { visited: 1, total: 34 }, false)?.text).toBe('34 places');
  });

  it('writes its numbers in the reader\'s locale: Rock Art of the Mediterranean Basin', () => {
    expect(wholeCountLabel(1050, undefined, false)?.text).toBe(`${(1050).toLocaleString()} places`);
  });

  it('is not shown for a whole of one offered place, as Prague, nor of none, as Wudang', () => {
    expect(wholeCountLabel(1, { visited: 1, total: 1 }, true)).toBeNull();
    expect(wholeCountLabel(null, undefined, true)).toBeNull();
  });
});

describe("the count on a place's open card", () => {
  const arc = { has_parts: true, leaf_count: 34, cast_points: false };
  const maman = { has_parts: false, leaf_count: null, cast_points: true };
  const altamira = { has_parts: false, leaf_count: null, cast_points: false };

  it("reads a whole's leaves, never its points", () => {
    expect(cardVisitCount(arc, { visited: 1, total: 34 }, { visited: 3, total: 40 })?.text).toBe('1 of 34');
  });

  it('shows none on an edition, seen at any one cast', () => {
    expect(cardVisitCount(maman, undefined, { visited: 1, total: 4 })).toBeNull();
  });

  it('shows none on an edition that also has parts, which is still one work', () => {
    const castsWithParts = { has_parts: true, leaf_count: 4, cast_points: true };
    expect(cardVisitCount(castsWithParts, { visited: 1, total: 4 }, { visited: 1, total: 4 })).toBeNull();
  });

  it('counts any other place shown at more than one point over its points', () => {
    expect(cardVisitCount(altamira, undefined, { visited: 1, total: 2 })?.text).toBe('1 of 2');
    expect(cardVisitCount(altamira, undefined, { visited: 0, total: 2 })?.text).toBe('0 of 2');
  });
});
