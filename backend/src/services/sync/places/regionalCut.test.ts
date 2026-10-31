/**
 * ADR-0171's cut over a candidate's surroundings: the two references off the
 * best places within the radius, the group floor, the languages a place needs,
 * and the note a curator reads.
 */

import { describe, it, expect } from 'vitest';
import { medianOf, regionalVerdict, REGIONAL_CUT, type Surroundings } from './regionalCut.js';

// Ten best within 50 km of a Kyoto temple: editions 60, 55, 50, 44, 40, 36, 33, 30, 28, 26 (median 38);
// guide use 6, 5, 5, 4, 4, 3, 3, 2, 2, 1 (median 3.5, a quarter of it 0.875).
const kyoto: Surroundings = {
  groupSize: 195,
  topEditions: [60, 55, 50, 44, 40, 36, 33, 30, 28, 26],
  topGuideEditions: [6, 5, 5, 4, 4, 3, 3, 2, 2, 1],
};

describe('medianOf', () => {
  it('reads the middle of an odd list and the mean of the two middles of an even one, in any order', () => {
    expect(medianOf([3, 1, 2])).toBe(2);
    expect(medianOf([60, 26, 40, 30])).toBe(35);
    expect(medianOf([])).toBeNull();
  });
});

describe('regionalVerdict', () => {
  it('admits a place a guide uses once where the best are used by a few, whatever its editions', () => {
    const v = regionalVerdict({ editions: 7, guideEditions: 1 }, kyoto);
    expect(v.in).toBe(true);
    if (v.in) {
      expect(v.reference).toEqual({ editions: 38, guide: 3.5 });
      expect(v.note).toBe('In the regional tier by the guides: within 50 km, 195 places: the 10 best are read in 38 '
        + 'Wikipedia editions at the median, this place in 7; the best are used by 3.5 Wikivoyage editions at the median, '
        + 'this place by 1 (ADR-0171)');
    }
  });

  it('admits a place no guide uses when its editions reach the median of the best', () => {
    const v = regionalVerdict({ editions: 38, guideEditions: 0 }, kyoto);
    expect(v.in).toBe(true);
    if (v.in) expect(v.note).toMatch(/^In the regional tier by its editions: /);
  });

  it('names both doors when both open', () => {
    const v = regionalVerdict({ editions: 40, guideEditions: 2 }, kyoto);
    expect(v.in && v.note.startsWith('In the regional tier by its editions and by the guides:')).toBe(true);
  });

  it('refuses a place under both references, with the numbers', () => {
    const v = regionalVerdict({ editions: 9, guideEditions: 0 }, kyoto);
    expect(v).toEqual({ in: false, reason: 'below the regional tier\'s cut: within 50 km, 195 places: the 10 best are read in 38 '
      + 'Wikipedia editions at the median, this place in 9; the best are used by 3.5 Wikivoyage editions at the median, this place by 0' });
  });

  it('refuses a place with one Wikipedia edition whatever its surroundings', () => {
    expect(regionalVerdict({ editions: 1, guideEditions: 4 }, kyoto)).toEqual({
      in: false, reason: '1 Wikipedia editions, under the 2 the regional tier asks for',
    });
  });

  it('reads the guide test among five places and the editions test among twenty-five', () => {
    // Dakar: eight places within 50 km. The guide test reads (floor 5): the Grande Mosquée, used by three
    // editions where the best are used by three, enters; the editions test does not read (floor 25).
    const dakar: Surroundings = { groupSize: 8, topEditions: [30, 12, 10, 9, 7, 5, 4, 3], topGuideEditions: [5, 4, 3, 3, 1] };
    const v = regionalVerdict({ editions: 10, guideEditions: 3 }, dakar);
    expect(v.in && v.note.startsWith('In the regional tier by the guides:')).toBe(true);
    // The same place with no guide: its 10 editions would reach the median of the best (9), but the group is under 25.
    const w = regionalVerdict({ editions: 10, guideEditions: 0 }, dakar);
    expect(w.in).toBe(false);
  });

  it('refuses where fewer places than the smaller floor lie within the radius', () => {
    const island: Surroundings = { groupSize: 4, topEditions: [30, 12, 10, 9], topGuideEditions: [5, 4] };
    expect(regionalVerdict({ editions: 10, guideEditions: 3 }, island)).toEqual({
      in: false, reason: '4 places within 50 km, under the floor of 5: too few to measure against',
    });
  });

  it('reads the guide reference over the places a guide uses at all, so a sparse guide is a small reference', () => {
    // Twenty-five places, three used by a guide: the reference is the median of those three.
    const sparse: Surroundings = { groupSize: 25, topEditions: [20, 18, 15, 12, 11, 10, 9, 8, 7, 6], topGuideEditions: [2, 1, 1] };
    const v = regionalVerdict({ editions: 4, guideEditions: 1 }, sparse);
    expect(v.in).toBe(true);
    if (v.in) expect(v.reference).toEqual({ editions: 10.5, guide: 1 });
  });

  it('says so when no place around is used by any guide, and the editions test alone decides', () => {
    const unguided: Surroundings = { ...kyoto, topGuideEditions: [] };
    const v = regionalVerdict({ editions: 10, guideEditions: 0 }, unguided);
    expect(v.in).toBe(false);
    if (!v.in) expect(v.reason).toMatch(/no Wikivoyage edition uses any place here$/);
  });

  it('sets no editions reference where no place around is read in any edition, and says so', () => {
    const unread: Surroundings = { groupSize: 30, topEditions: [], topGuideEditions: [2, 1] };
    const v = regionalVerdict({ editions: 3, guideEditions: 0 }, unread);
    expect(v.in).toBe(false);
    if (!v.in) expect(v.reason).toMatch(/no place is read in any Wikipedia edition/);
  });

  it('takes its numbers from the one named set', () => {
    expect(REGIONAL_CUT).toEqual({
      enabled: false, neighbours: 'all',
      radiusKm: 50, best: 10, guideShare: 0.25, editionsShare: 1, guideGroupFloor: 5, editionsGroupFloor: 25, minLanguages: 2,
    });
  });
});
