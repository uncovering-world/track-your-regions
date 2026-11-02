/**
 * ADR-0171's cut over a candidate's surroundings, with ADR-0175's tests and
 * stay: the three references off the best places within the radius, the group
 * floors, the languages and readers a place needs, the types that need a
 * guide, the stay of a held place, and the note a curator reads. The real
 * places' signals are the review's extract (#2177: the subset of 2026-10-19,
 * the readership year to 2026-09).
 */

import { describe, it, expect } from 'vitest';
import { medianOf, needsAGuide, regionalVerdict, REGIONAL_CUT, type Surroundings } from './regionalCut.js';

// Ten best within 50 km of a Kyoto temple: editions 60, 55, 50, 44, 40, 36, 33, 30, 28, 26 (median 38);
// guide use 6, 5, 5, 4, 4, 3, 3, 2, 2, 1 (median 3.5, half of it 1.75); readers median 300,000.
const kyoto: Surroundings = {
  groupSize: 195,
  topEditions: [60, 55, 50, 44, 40, 36, 33, 30, 28, 26],
  topGuideEditions: [6, 5, 5, 4, 4, 3, 3, 2, 2, 1],
  topReaders: [2_000_000, 1_500_000, 900_000, 600_000, 400_000, 200_000, 150_000, 120_000, 100_000, 90_000],
};
const read = 5_000;

describe('medianOf', () => {
  it('reads the middle of an odd list and the mean of the two middles of an even one, in any order', () => {
    expect(medianOf([3, 1, 2])).toBe(2);
    expect(medianOf([60, 26, 40, 30])).toBe(35);
    expect(medianOf([])).toBeNull();
  });
});

describe('regionalVerdict', () => {
  it('admits a place two guides use where the best are used by a few, whatever its editions', () => {
    const v = regionalVerdict({ editions: 7, guideEditions: 2, readers: read }, kyoto);
    expect(v.in).toBe(true);
    if (v.in) {
      expect(v.reference).toEqual({ editions: 38, guide: 3.5, readers: 300_000 });
      expect(v.note).toBe('In the regional tier by the guides: within 50 km, 195 places: the 10 best are read in 38 '
        + 'Wikipedia editions at the median, this place in 7; the best have 300,000 readers a year at the median, this place 5,000; '
        + 'the best are used by 3.5 Wikivoyage editions at the median, this place by 2 (ADR-0171, ADR-0175)');
    }
    // One guide is under half the reference (ADR-0175 decision 3; ADR-0171 read a quarter).
    expect(regionalVerdict({ editions: 7, guideEditions: 1, readers: read }, kyoto).in).toBe(false);
  });

  it('admits a place no guide uses when its editions reach the median of the best', () => {
    const v = regionalVerdict({ editions: 38, guideEditions: 0, readers: read }, kyoto);
    expect(v.in).toBe(true);
    if (v.in) expect(v.note).toMatch(/^In the regional tier by its editions: /);
  });

  it('names both doors when both open', () => {
    const v = regionalVerdict({ editions: 40, guideEditions: 2, readers: read }, kyoto);
    expect(v.in && v.note.startsWith('In the regional tier by its editions and by the guides:')).toBe(true);
  });

  it('refuses a place under both references, with the numbers', () => {
    const v = regionalVerdict({ editions: 9, guideEditions: 0, readers: read }, kyoto);
    expect(v).toEqual({ in: false, reason: 'below the regional tier\'s cut: within 50 km, 195 places: the 10 best are read in 38 '
      + 'Wikipedia editions at the median, this place in 9; the best have 300,000 readers a year at the median, this place 5,000; '
      + 'the best are used by 3.5 Wikivoyage editions at the median, this place by 0' });
  });

  it('refuses a place with one Wikipedia edition whatever its surroundings', () => {
    expect(regionalVerdict({ editions: 1, guideEditions: 4, readers: read }, kyoto)).toEqual({
      in: false, reason: '1 Wikipedia editions, under the 2 the regional tier asks for',
    });
  });

  it('reads the guide test among five places and the editions test among twenty-five', () => {
    // Dakar: eight places within 50 km. The guide test reads (floor 5): the Grande Mosquée, used by three
    // editions where the best are used by three, enters; the editions test does not read (floor 25).
    const dakar: Surroundings = { groupSize: 8, topEditions: [30, 12, 10, 9, 7, 5, 4, 3], topGuideEditions: [5, 4, 3, 3, 1], topReaders: [40_000, 9_000, 4_000] };
    const v = regionalVerdict({ editions: 10, guideEditions: 3, readers: read }, dakar);
    expect(v.in && v.note.startsWith('In the regional tier by the guides:')).toBe(true);
    // The same place with no guide: its 10 editions would reach the median of the best (9), but the group is under 25.
    const w = regionalVerdict({ editions: 10, guideEditions: 0, readers: read }, dakar);
    expect(w.in).toBe(false);
  });

  it('refuses where fewer places than the smaller floor lie within the radius', () => {
    const island: Surroundings = { groupSize: 4, topEditions: [30, 12, 10, 9], topGuideEditions: [5, 4], topReaders: [20_000] };
    expect(regionalVerdict({ editions: 10, guideEditions: 3, readers: read }, island)).toEqual({
      in: false, reason: '4 places within 50 km, under the floor of 5: too few to measure against',
    });
  });

  it('reads the guide reference over the places a guide uses at all, so a sparse guide is a small reference', () => {
    // Twenty-five places, three used by a guide: the reference is the median of those three.
    const sparse: Surroundings = { groupSize: 25, topEditions: [20, 18, 15, 12, 11, 10, 9, 8, 7, 6], topGuideEditions: [2, 1, 1], topReaders: [90_000, 50_000] };
    const v = regionalVerdict({ editions: 4, guideEditions: 1, readers: read }, sparse);
    expect(v.in).toBe(true);
    if (v.in) expect(v.reference).toEqual({ editions: 10.5, guide: 1, readers: 70_000 });
  });

  it('says so when no place around is used by any guide, and the editions test alone decides', () => {
    const unguided: Surroundings = { ...kyoto, topGuideEditions: [] };
    const v = regionalVerdict({ editions: 10, guideEditions: 0, readers: read }, unguided);
    expect(v.in).toBe(false);
    if (!v.in) expect(v.reason).toMatch(/no Wikivoyage edition uses any place here$/);
  });

  it('sets no editions reference where no place around is read in any edition, and says so', () => {
    const unread: Surroundings = { groupSize: 30, topEditions: [], topGuideEditions: [2, 1], topReaders: [] };
    const v = regionalVerdict({ editions: 3, guideEditions: 0, readers: read }, unread);
    expect(v.in).toBe(false);
    if (!v.in) expect(v.reason).toMatch(/no place is read in any Wikipedia edition/);
  });

  it('takes its numbers from the register, and is on (ADR-0175 decision 3)', () => {
    expect(REGIONAL_CUT).toEqual({
      enabled: true, neighbours: 'all', radiusKm: 50, best: 10,
      guideShare: 0.5, editionsShare: 1, readersShare: 1, guideGroupFloor: 5, editionsGroupFloor: 25, readersGroupFloor: 25,
      minLanguages: 2, minReaders: 3_000, guideForTypes: ['tunnel', 'dam', 'lock'], stayReadersShare: 0.8,
    });
  });
});

// Real places, as the review's extract read them: the ten best within 50 km of each.
// Wat Maha That Wora Wihan in Ratchaburi (Q13020799), a hundred kilometres west of Bangkok:
// two Wikipedia editions, no guide, 7,724 readers a year.
const ratchaburi: Surroundings = {
  groupSize: 418,
  topEditions: [14, 10, 5, 5, 3, 3, 3, 3, 2, 2],
  topGuideEditions: [2, 2, 2, 2, 1, 1, 1, 1, 1, 1],
  topReaders: [68_602, 18_927, 12_422, 11_336, 7_724, 5_760, 4_923, 4_498, 4_024, 3_509],
};
// Wat Suwannaram in Bangkok Noi (Q1416391): four editions, three guides, 7,617 readers; Bangkok's best set the references.
const bangkokNoi: Surroundings = {
  groupSize: 1_681,
  topEditions: [47, 44, 42, 27, 27, 26, 25, 24, 20, 19],
  topGuideEditions: [7, 7, 6, 6, 4, 4, 4, 4, 4, 3],
  topReaders: [322_973, 276_939, 228_947, 190_354, 137_417, 99_545, 88_611, 84_244, 82_269, 68_602],
};
// Ottawa's Peace Tower (Q3533602): six editions, no guide, 23,645 readers a year.
const ottawa: Surroundings = {
  groupSize: 320,
  topEditions: [33, 30, 22, 18, 16, 14, 12, 11, 10, 10],
  topGuideEditions: [4, 4, 3, 3, 3, 2, 2, 2, 2, 2],
  topReaders: [104_751, 43_499, 34_633, 30_913, 27_594, 23_645, 21_535, 18_199, 17_685, 17_334],
};
// The Skopje Clock Tower (Q1131501): ten editions, two guides, 2,862 readers a year.
const skopje: Surroundings = {
  groupSize: 1_600,
  topEditions: [32, 27, 27, 23, 21, 21, 21, 20, 19, 19],
  topGuideEditions: [5, 5, 4, 4, 4, 4, 3, 3, 3, 3],
  topReaders: [36_756, 34_656, 32_247, 30_476, 26_027, 21_010, 18_565, 18_005, 16_283, 16_050],
};

describe('the regional tier on real places (ADR-0175 decision 3)', () => {
  it('admits a temple by its readers where the area\'s best are read little, and says so', () => {
    const v = regionalVerdict({ editions: 2, guideEditions: 0, readers: 7_724 }, ratchaburi);
    expect(v.in).toBe(true);
    if (v.in) {
      expect(v.reference).toEqual({ editions: 3, guide: 1, readers: 6_742 });
      expect(v.note).toMatch(/^In the regional tier by its readers: within 50 km, 418 places: .*the best have 6,742 readers a year at the median, this place 7,724;/);
    }
  });

  it('measures a Bangkok temple against Bangkok\'s best: its readers are far under them, and the guides let it in', () => {
    const v = regionalVerdict({ editions: 4, guideEditions: 3, readers: 7_617 }, bangkokNoi);
    expect(v.in).toBe(true);
    if (v.in) {
      expect(v.reference).toEqual({ editions: 26.5, guide: 4, readers: 118_481 });
      expect(v.note).toMatch(/^In the regional tier by the guides:/);
    }
    // With no guide, the same temple stays out: 7,617 readers against a neighbourhood the Grand Palace leads.
    expect(regionalVerdict({ editions: 4, guideEditions: 0, readers: 7_617 }, bangkokNoi).in).toBe(false);
  });

  it('asks 3,000 readers a year of a new place whatever its tests, and 2,400 of a place it holds', () => {
    // The Skopje Clock Tower passes the guide test (two guides, half of a median of four) and is read 2,862 times.
    const tower = { editions: 10, guideEditions: 2, readers: 2_862 };
    expect(regionalVerdict(tower, skopje)).toEqual({ in: false, reason: '2,862 readers a year, under the 3,000 the regional tier asks for' });
    const held = regionalVerdict(tower, skopje, REGIONAL_CUT, true);
    expect(held.in && held.note.startsWith('Stays in the regional tier by the guides')).toBe(true);
    expect(regionalVerdict({ ...tower, readers: 2_300 }, skopje, REGIONAL_CUT, true)).toEqual({
      in: false, reason: '2,300 readers a year, under the 2,400 the regional tier asks for of a place it holds',
    });
  });

  it('keeps a place it holds while its readers reach 0.8 of the reference, and lets no new one in there', () => {
    // The Peace Tower is read 23,645 times, 0.92 of Ottawa's median of 25,619.5.
    const peace = { editions: 6, guideEditions: 0, readers: 23_645 };
    expect(regionalVerdict(peace, ottawa).in).toBe(false);
    const held = regionalVerdict(peace, ottawa, REGIONAL_CUT, true);
    expect(held.in).toBe(true);
    if (held.in) expect(held.note).toMatch(/^Stays in the regional tier by its readers, read at 0\.8 of the readers' reference for a place it holds: /);
    // Under 0.8 of the reference (20,495.6) it falls.
    expect(regionalVerdict({ ...peace, readers: 20_000 }, ottawa, REGIONAL_CUT, true).in).toBe(false);
  });

  it('reads the editions and Wikivoyage tests whole for a place it holds', () => {
    // Bangkok Noi's temple with one guide, under half the median of four, is not kept by the stay.
    expect(regionalVerdict({ editions: 4, guideEditions: 1, readers: 7_617 }, bangkokNoi, REGIONAL_CUT, true).in).toBe(false);
  });
});

describe('the types that need a guide', () => {
  it('refuses a tunnel, a dam or a lock no Wikivoyage edition uses, and lets one a guide uses through', () => {
    // Rostock's Warnow Tunnel: nine editions, 12,698 readers, no guide.
    expect(needsAGuide('tunnel', 0)).toMatch(/^a tunnel enters the regional tier only while a Wikivoyage edition uses it, and none does/);
    // The Kurobe Dam, used by the Bengali, English and Japanese Wikivoyages; the Finse Tunnel by the English one.
    expect(needsAGuide('dam', 3)).toBeNull();
    expect(needsAGuide('tunnel', 1)).toBeNull();
    expect(needsAGuide('lock', 0)).not.toBeNull();
    // A bridge needs none.
    expect(needsAGuide('bridge', 0)).toBeNull();
  });
});
