import { describe, expect, it } from 'vitest';
import {
  holdingsNounFor, isShownFor, kindChips, kindsChosenOnArrival, worksShown, type WorkKind,
} from './worksByKind';

const ART: WorkKind = { kind_id: 2, kind_name: 'Art Museums', type: null };
const ARCHAEOLOGY: WorkKind = { kind_id: 5, kind_name: 'Archaeology', type: 'museum' };

/**
 * The Capitoline Museums once merged: the Wolf and the Dying Gaul held by both
 * kinds, a painting held by Art Museums alone, and a work no offered membership
 * places.
 */
const WOLF = { name: 'Capitoline Wolf', kind_ids: [2, 5] };
const GAUL = { name: 'Dying Gaul', kind_ids: [2, 5] };
const FORTUNE_TELLER = { name: 'The Fortune Teller', kind_ids: [2] };
const PLACE_OWN = { name: 'A work of the place', kind_ids: [] as number[] };
const WORKS = [WOLF, GAUL, FORTUNE_TELLER, PLACE_OWN];

describe('a place\'s works as one list (#1263)', () => {
  it('lists each work once, under any chosen kind that holds it', () => {
    expect(worksShown(WORKS, new Set([5])).map(work => work.name))
      .toEqual(['Capitoline Wolf', 'Dying Gaul', 'A work of the place']);
    expect(worksShown(WORKS, new Set([2, 5]))).toHaveLength(4);
  });

  it('shows a work no kind holds whichever kind is chosen', () => {
    expect(isShownFor(PLACE_OWN, new Set([5]))).toBe(true);
    expect(isShownFor(PLACE_OWN, new Set([2]))).toBe(true);
  });

  it('counts what each chosen kind holds, and what another would add', () => {
    expect(kindChips(WORKS, [ART, ARCHAEOLOGY], new Set([5]))).toEqual([
      { kind: ART, count: 3, adds: 1, selected: false },
      { kind: ARCHAEOLOGY, count: 2, adds: 0, selected: true },
    ]);
    // From Art Museums, Archaeology adds nothing: every find is a work of art too.
    expect(kindChips(WORKS, [ART, ARCHAEOLOGY], new Set([2]))[1]).toMatchObject({ count: 2, adds: 0 });
  });
});

describe('the kinds chosen when the card opens', () => {
  it('chooses the kind of the list it was opened from', () => {
    expect(kindsChosenOnArrival([ART, ARCHAEOLOGY], 5)).toEqual(new Set([5]));
  });

  it('chooses every kind from the pin, or from a kind the place is not in', () => {
    expect(kindsChosenOnArrival([ART, ARCHAEOLOGY], null)).toEqual(new Set([2, 5]));
    expect(kindsChosenOnArrival([ART, ARCHAEOLOGY], 4)).toEqual(new Set([2, 5]));
  });
});

describe('what the list calls what it holds', () => {
  it('says finds only where every chosen kind holds finds', () => {
    expect(holdingsNounFor(new Set([5]))).toBe('finds');
    expect(holdingsNounFor(new Set([2, 5]))).toBe('works');
    expect(holdingsNounFor(new Set([2]))).toBe('works');
  });
});
