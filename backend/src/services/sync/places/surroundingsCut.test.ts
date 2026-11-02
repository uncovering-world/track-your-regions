/**
 * ADR-0171's cut over a candidate's surroundings, with ADR-0175's tests and
 * stay and ADR-0181's neighbourhood and shares: the three references off the
 * best of a place's neighbours, the group floors, the languages and readers a
 * place needs, the types that need a guide, the stay of a held place, and the
 * note a curator reads. The real places' neighbourhoods are the review's
 * (#2297: the places of their own density within 150 km, over the subset of
 * 2026-10-19 and the readership year to 2026-09).
 */

import { describe, it, expect } from 'vitest';
import { medianOf, needsAGuide, surroundingsVerdict, SURROUNDINGS_CUT, type Surroundings } from './surroundingsCut.js';

// A schematic of a Kyoto temple's neighbours: editions 60, 55, 50, 44, 40, 36, 33, 30, 28, 26 (median 38);
// guide use 8, 7, 6, 6, 5, 5, 4, 4, 3, 3 (median 5, a quarter of it 1.25); readers median 300,000.
const kyoto: Surroundings = {
  groupSize: 195,
  topEditions: [60, 55, 50, 44, 40, 36, 33, 30, 28, 26],
  topGuideEditions: [8, 7, 6, 6, 5, 5, 4, 4, 3, 3],
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

describe('surroundingsVerdict', () => {
  it('admits a place two guides use where the best are used by five, whatever its editions', () => {
    const v = surroundingsVerdict({ editions: 7, guideEditions: 2, readers: read }, kyoto);
    expect(v.in).toBe(true);
    if (v.in) {
      expect(v.reference).toEqual({ editions: 38, guide: 5, readers: 300_000 });
      expect(v.note).toBe('In the surroundings tier by the guides: within 150 km, 195 places of its density: the 10 best are read in 38 '
        + 'Wikipedia editions at the median, this place in 7; the best have 300,000 readers a year at the median, this place 5,000; '
        + 'the best are used by 5 Wikivoyage editions at the median, this place by 2 (ADR-0171, ADR-0175, ADR-0181)');
    }
    // One guide is under a quarter of the reference (ADR-0181; ADR-0175 read half).
    expect(surroundingsVerdict({ editions: 7, guideEditions: 1, readers: read }, kyoto).in).toBe(false);
  });

  it('admits a place no guide uses when its editions reach the median of the best', () => {
    const v = surroundingsVerdict({ editions: 38, guideEditions: 0, readers: read }, kyoto);
    expect(v.in).toBe(true);
    if (v.in) expect(v.note).toMatch(/^In the surroundings tier by its editions: /);
  });

  it('names both doors when both open', () => {
    const v = surroundingsVerdict({ editions: 40, guideEditions: 2, readers: read }, kyoto);
    expect(v.in && v.note.startsWith('In the surroundings tier by its editions and by the guides:')).toBe(true);
  });

  it('admits by its readers at one and a half times the median of the best, and not at the median itself', () => {
    expect(surroundingsVerdict({ editions: 3, guideEditions: 0, readers: 450_000 }, kyoto).in).toBe(true);
    expect(surroundingsVerdict({ editions: 3, guideEditions: 0, readers: 449_999 }, kyoto).in).toBe(false);
  });

  it('refuses a place under every reference, with the numbers', () => {
    const v = surroundingsVerdict({ editions: 9, guideEditions: 0, readers: read }, kyoto);
    expect(v).toEqual({ in: false, reason: 'below the surroundings tier\'s cut: within 150 km, 195 places of its density: the 10 best are read in 38 '
      + 'Wikipedia editions at the median, this place in 9; the best have 300,000 readers a year at the median, this place 5,000; '
      + 'the best are used by 5 Wikivoyage editions at the median, this place by 0' });
  });

  it('refuses a place with one Wikipedia edition whatever its surroundings', () => {
    expect(surroundingsVerdict({ editions: 1, guideEditions: 4, readers: read }, kyoto)).toEqual({
      in: false, reason: '1 Wikipedia editions, under the 2 the surroundings tier asks for',
    });
  });

  it('reads the guide test among five places and the editions test among twenty-five', () => {
    // Eight neighbours of a Dakar mosque. The guide test reads (floor 5): the Grande Mosquée, used by three
    // editions where the best are used by three, enters; the editions test does not read (floor 25).
    const dakar: Surroundings = { groupSize: 8, topEditions: [30, 12, 10, 9, 7, 5, 4, 3], topGuideEditions: [5, 4, 3, 3, 1], topReaders: [40_000, 9_000, 4_000] };
    const v = surroundingsVerdict({ editions: 10, guideEditions: 3, readers: read }, dakar);
    expect(v.in && v.note.startsWith('In the surroundings tier by the guides:')).toBe(true);
    // The same place with no guide: its 10 editions would reach the median of the best (9), but the group is under 25.
    const w = surroundingsVerdict({ editions: 10, guideEditions: 0, readers: read }, dakar);
    expect(w.in).toBe(false);
  });

  it('refuses where fewer neighbours than the smaller floor share the place\'s density', () => {
    const island: Surroundings = { groupSize: 4, topEditions: [30, 12, 10, 9], topGuideEditions: [5, 4], topReaders: [20_000] };
    expect(surroundingsVerdict({ editions: 10, guideEditions: 3, readers: read }, island)).toEqual({
      in: false, reason: '4 places of its density within 150 km, under the floor of 5: too few to measure against',
    });
  });

  it('reads the guide reference over the places a guide uses at all, so a sparse guide is a small reference', () => {
    // Twenty-five places, three used by a guide: the reference is the median of those three.
    const sparse: Surroundings = { groupSize: 25, topEditions: [20, 18, 15, 12, 11, 10, 9, 8, 7, 6], topGuideEditions: [2, 1, 1], topReaders: [90_000, 50_000] };
    const v = surroundingsVerdict({ editions: 4, guideEditions: 1, readers: read }, sparse);
    expect(v.in).toBe(true);
    if (v.in) expect(v.reference).toEqual({ editions: 10.5, guide: 1, readers: 70_000 });
  });

  it('says so when no place around is used by any guide, and the editions test alone decides', () => {
    const unguided: Surroundings = { ...kyoto, topGuideEditions: [] };
    const v = surroundingsVerdict({ editions: 10, guideEditions: 0, readers: read }, unguided);
    expect(v.in).toBe(false);
    if (!v.in) expect(v.reason).toMatch(/no Wikivoyage edition uses any place here$/);
  });

  it('sets no editions reference where no place around is read in any edition, and says so', () => {
    const unread: Surroundings = { groupSize: 30, topEditions: [], topGuideEditions: [2, 1], topReaders: [] };
    const v = surroundingsVerdict({ editions: 3, guideEditions: 0, readers: read }, unread);
    expect(v.in).toBe(false);
    if (!v.in) expect(v.reason).toMatch(/no place is read in any Wikipedia edition/);
  });

  it('reads the editions and Wikivoyage tests whole for a place it holds', () => {
    // One guide against Kyoto's five: under a quarter (1.25), and over the 1.0 a stay share on the guide test would ask.
    expect(surroundingsVerdict({ editions: 7, guideEditions: 1, readers: read }, kyoto, SURROUNDINGS_CUT, true).in).toBe(false);
  });

  it('takes its numbers from the register, and is on (ADR-0175 decision 3, ADR-0181)', () => {
    expect(SURROUNDINGS_CUT).toEqual({
      enabled: true, neighbours: 'all', radiusKm: 150, densityNeighbours: 20, densityRatio: 4, best: 10,
      guideShare: 0.25, editionsShare: 1, readersShare: 1.5, guideGroupFloor: 5, editionsGroupFloor: 25, readersGroupFloor: 25,
      minLanguages: 2, minReaders: 3_000, guideForTypes: ['tunnel', 'dam', 'lock'], stayReadersShare: 0.8,
    });
  });
});

// Real places, as the review read them: the ten best of the places of their own density within 150 km of each.
// Wat Maha That Wora Wihan in Ratchaburi (Q13020799), a hundred kilometres west of Bangkok:
// two Wikipedia editions, no guide, 7,724 readers a year.
const ratchaburi: Surroundings = {
  groupSize: 1_975,
  topEditions: [27, 22, 14, 13, 13, 11, 10, 10, 9, 9],
  topGuideEditions: [4, 4, 3, 2, 2, 2, 2, 2, 1, 1],
  topReaders: [76_390, 71_629, 68_602, 54_937, 42_872, 39_994, 36_586, 34_372, 33_971, 23_907],
};
// Wat Suwannaram in Bangkok Noi (Q1416391): four editions, three guides, 7,617 readers; Bangkok's best set the references.
const bangkokNoi: Surroundings = {
  groupSize: 1_254,
  topEditions: [47, 44, 42, 27, 26, 25, 24, 20, 19, 19],
  topGuideEditions: [7, 7, 6, 6, 4, 4, 4, 4, 4, 4],
  topReaders: [322_973, 276_939, 228_947, 190_354, 137_417, 99_545, 88_611, 85_162, 84_244, 82_269],
};
// Ottawa's Peace Tower (Q3533602): six editions, no guide, 23,645 readers a year, among the best of its own neighbours.
const ottawa: Surroundings = {
  groupSize: 168,
  topEditions: [33, 22, 18, 16, 14, 12, 9, 9, 8, 8],
  topGuideEditions: [4, 4, 3, 2, 2, 2, 2, 2, 2, 2],
  topReaders: [43_499, 34_633, 30_913, 23_645, 21_535, 19_771, 18_199, 17_685, 17_334, 15_801],
};
// The Skopje Clock Tower (Q1131501): ten editions, two guides, 2,862 readers a year.
const skopje: Surroundings = {
  groupSize: 805,
  topEditions: [32, 29, 28, 27, 27, 27, 24, 23, 23, 22],
  topGuideEditions: [6, 6, 5, 5, 5, 5, 5, 5, 5, 5],
  topReaders: [38_963, 35_133, 34_656, 30_476, 30_324, 26_925, 26_027, 24_951, 24_212, 22_993],
};

describe('the surroundings tier on real places (ADR-0175 decision 3, ADR-0181)', () => {
  it('refuses a temple no guide names where its neighbours of its density are read far more', () => {
    // Within 150 km of Ratchaburi, the places of its density reach Bangkok's outer districts: the best are read 41,433 times.
    const v = surroundingsVerdict({ editions: 2, guideEditions: 0, readers: 7_724 }, ratchaburi);
    expect(v.in).toBe(false);
    if (!v.in) expect(v.reason).toMatch(/^below the surroundings tier's cut: within 150 km, 1,975 places of its density: .*the best have 41,433 readers a year at the median, this place 7,724;/);
  });

  it('measures a Bangkok temple against Bangkok\'s best: its readers are far under them, and the guides let it in', () => {
    const v = surroundingsVerdict({ editions: 4, guideEditions: 3, readers: 7_617 }, bangkokNoi);
    expect(v.in).toBe(true);
    if (v.in) {
      expect(v.reference).toEqual({ editions: 25.5, guide: 4, readers: 118_481 });
      expect(v.note).toMatch(/^In the surroundings tier by the guides:/);
    }
    // With no guide, the same temple stays out: 7,617 readers against a neighbourhood the Grand Palace leads.
    expect(surroundingsVerdict({ editions: 4, guideEditions: 0, readers: 7_617 }, bangkokNoi).in).toBe(false);
  });

  it('asks 3,000 readers a year of a new place whatever its tests, and 2,400 of a place it holds', () => {
    // The Skopje Clock Tower passes the guide test (two guides, over a quarter of a median of five) and is read 2,862 times.
    const tower = { editions: 10, guideEditions: 2, readers: 2_862 };
    expect(surroundingsVerdict(tower, skopje)).toEqual({ in: false, reason: '2,862 readers a year, under the 3,000 the surroundings tier asks for' });
    const held = surroundingsVerdict(tower, skopje, SURROUNDINGS_CUT, true);
    expect(held.in && held.note.startsWith('Stays in the surroundings tier by the guides')).toBe(true);
    expect(surroundingsVerdict({ ...tower, readers: 2_300 }, skopje, SURROUNDINGS_CUT, true)).toEqual({
      in: false, reason: '2,300 readers a year, under the 2,400 the surroundings tier asks for of a place it holds',
    });
  });

  it('keeps a place it holds while its readers reach 0.8 of the readers share, and lets no new one in there', () => {
    // Ottawa's median is 20,653 readers: a new place needs 1.5 times it (30,979.5), a held one 1.2 times it (24,783.6).
    // The Peace Tower, read 23,645 times, is under both.
    const peace = { editions: 6, guideEditions: 0, readers: 23_645 };
    expect(surroundingsVerdict(peace, ottawa).in).toBe(false);
    expect(surroundingsVerdict(peace, ottawa, SURROUNDINGS_CUT, true).in).toBe(false);
    // A tower of the same neighbourhood read 26,000 times stays where it is held, and does not enter new.
    const read26 = { ...peace, readers: 26_000 };
    expect(surroundingsVerdict(read26, ottawa).in).toBe(false);
    const held = surroundingsVerdict(read26, ottawa, SURROUNDINGS_CUT, true);
    expect(held.in).toBe(true);
    if (held.in) expect(held.note).toMatch(/^Stays in the surroundings tier by its readers, the readers test read at 1\.2 times the reference for a place it holds: /);
  });
});

describe('the types that need a guide', () => {
  it('refuses a tunnel, a dam or a lock no Wikivoyage edition uses, and lets one a guide uses through', () => {
    // Rostock's Warnow Tunnel: nine editions, 12,698 readers, no guide.
    expect(needsAGuide('tunnel', 0)).toMatch(/^a tunnel enters the surroundings tier only while a Wikivoyage edition uses it, and none does/);
    // The Kurobe Dam, used by the Bengali, English and Japanese Wikivoyages; the Finse Tunnel by the English one.
    expect(needsAGuide('dam', 3)).toBeNull();
    expect(needsAGuide('tunnel', 1)).toBeNull();
    expect(needsAGuide('lock', 0)).not.toBeNull();
    // A bridge needs none.
    expect(needsAGuide('bridge', 0)).toBeNull();
  });
});
