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
      minLanguages: 2, minReaders: 3_000, guideForTypes: ['tunnel', 'dam', 'lock', 'bridge'], heritageForTypes: ['bridge'], stayReadersShare: 0.8,
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

// Two places the tier holds by the guides alone, with the medians of their admission notes on the dev catalogue
// (the lists schematic): the Finse Tunnel (Q5450940), on the Bergen Line, used by the English Wikivoyage, and the
// Eschbach Dam (Q896077) in Remscheid, used by the German and English ones.
const finse: Surroundings = {
  groupSize: 1_089,
  topEditions: [36, 30, 24, 20, 17, 15, 12, 10, 9, 8],
  topGuideEditions: [5, 4, 4, 3, 3, 3, 3, 2, 2, 2],
  topReaders: [232_735, 120_000, 80_000, 50_000, 36_000, 30_235, 20_000, 15_000, 10_000, 9_000],
};
const eschbach: Surroundings = {
  groupSize: 28_467,
  topEditions: [60, 50, 40, 30, 25, 23, 22, 20, 18, 16],
  topGuideEditions: [7, 6, 5, 4, 4, 3, 3, 2, 2, 2],
  topReaders: [2_000_000, 900_000, 500_000, 300_000, 170_000, 156_714, 140_000, 120_000, 110_000, 100_000],
};
const finseTunnel = { editions: 5, readers: 5_320 };
const eschbachDam = { editions: 5, readers: 6_774 };

describe('the cut where no Wikivoyage usage is built (ADR-0175 decision 6)', () => {
  it('admits by the guides with the build in place, as the catalogue holds them', () => {
    expect(surroundingsVerdict({ ...finseTunnel, guideEditions: 1 }, finse)).toEqual({
      in: true, reference: { editions: 16, guide: 3, readers: 33_117.5 },
      note: 'In the surroundings tier by the guides: within 150 km, 1,089 places of its density: the 10 best are read in 16 '
        + 'Wikipedia editions at the median, this place in 5; the best have 33,117.5 readers a year at the median, this place 5,320; '
        + 'the best are used by 3 Wikivoyage editions at the median, this place by 1 (ADR-0171, ADR-0175, ADR-0181)',
    });
    const dam = surroundingsVerdict({ ...eschbachDam, guideEditions: 2 }, eschbach, SURROUNDINGS_CUT, true);
    expect(dam.in && dam.note).toMatch(/^In the surroundings tier by the guides: within 150 km, 28,467 places .* the best are used by 3\.5 Wikivoyage editions at the median, this place by 2 /);
  });

  it('keeps a held place a guide used when last read, and one no build was ever read for, naming the test it could not read', () => {
    const tunnel = surroundingsVerdict({ ...finseTunnel, guideEditions: null, guidedAsLastRead: true }, { ...finse, topGuideEditions: [] }, SURROUNDINGS_CUT, true);
    expect(tunnel).toEqual({
      in: true, reference: { editions: 16, guide: null, readers: 33_117.5 },
      note: 'Kept in the surroundings tier, the guides\' test unread: within 150 km, 1,089 places of its density: the 10 best are read in 16 '
        + 'Wikipedia editions at the median, this place in 5; the best have 33,117.5 readers a year at the median, this place 5,320; '
        + 'no Wikivoyage usage is built, so no guide\'s use is read; a Wikivoyage edition used this place when last read (ADR-0175 decision 6, ADR-0181)',
    });
    const dam = surroundingsVerdict({ ...eschbachDam, guideEditions: null, guidedAsLastRead: true }, eschbach, SURROUNDINGS_CUT, true);
    expect(dam.in && dam.note).toMatch(/^Kept in the surroundings tier, the guides' test unread: /);
    // The neighbours' guide editions the pool counted without a build are no reading either: no reference is set off them.
    expect(dam.in && dam.reference.guide).toBeNull();
    const neverRead = surroundingsVerdict({ ...eschbachDam, guideEditions: null, guidedAsLastRead: null }, eschbach, SURROUNDINGS_CUT, true);
    expect(neverRead.in && neverRead.note).toMatch(/no guide's use was ever read of this place \(ADR-0175 decision 6, ADR-0181\)$/);
  });

  it('lets a held place no guide used when last read fall by the tests it read, and says so', () => {
    const v = surroundingsVerdict({ ...finseTunnel, guideEditions: null, guidedAsLastRead: false }, finse, SURROUNDINGS_CUT, true);
    expect(v).toEqual({ in: false, reason: expect.stringMatching(
      /^below the surroundings tier's cut: .*no Wikivoyage usage is built, so no guide's use is read; no Wikivoyage edition used this place when last read$/) });
  });

  it('keeps no held place in an area too small for the guides\' test, which the build would not read either', () => {
    const small: Surroundings = { ...finse, groupSize: 4 };
    expect(surroundingsVerdict({ ...finseTunnel, guideEditions: null, guidedAsLastRead: true }, small, SURROUNDINGS_CUT, true).in).toBe(false);
  });

  it('admits no new place by a guide, and a new one by the tests it read', () => {
    // A new place two guides use where the best are used by five passes the guides' test alone with the build, and nothing without it.
    expect(surroundingsVerdict({ editions: 7, guideEditions: 2, readers: read }, kyoto).in).toBe(true);
    const v = surroundingsVerdict({ editions: 7, guideEditions: null, readers: read }, kyoto);
    expect(v).toEqual({ in: false, reason: expect.stringMatching(/no Wikivoyage usage is built, so no guide's use is read$/) });
    // A guide mark as last read lets no new place in.
    expect(surroundingsVerdict({ editions: 7, guideEditions: null, readers: read, guidedAsLastRead: true }, kyoto).in).toBe(false);
    // Its editions still admit it.
    const editions = surroundingsVerdict({ editions: 38, guideEditions: null, readers: read }, kyoto);
    expect(editions.in && editions.note).toMatch(/^In the surroundings tier by its editions: /);
  });
});

describe('the types that need a guide', () => {
  it('refuses a tunnel, a dam, a lock or a bridge no Wikivoyage edition uses, and lets one a guide uses through', () => {
    // Rostock's Warnow Tunnel: nine editions, 12,698 readers, no guide.
    expect(needsAGuide('tunnel', { guideEditions: 0 })).toMatch(/^a tunnel enters the surroundings tier only while a Wikivoyage edition uses it, and none does/);
    // The Kurobe Dam, used by the Bengali, English and Japanese Wikivoyages; the Finse Tunnel by the English one.
    expect(needsAGuide('dam', { guideEditions: 3 })).toBeNull();
    expect(needsAGuide('tunnel', { guideEditions: 1 })).toBeNull();
    expect(needsAGuide('lock', { guideEditions: 0 })).not.toBeNull();
    // The Astoria–Megler Bridge, a crossing no guide uses, is refused (#2324); an aqueduct needs none.
    expect(needsAGuide('bridge', { guideEditions: 0 })).toMatch(/^a bridge enters the surroundings tier only while a Wikivoyage edition uses it, and none does/);
    expect(needsAGuide('aqueduct', { guideEditions: 0 })).toBeNull();
  });

  it('counts a heritage designation as a guide for a bridge alone (#2324)', () => {
    // The Luding Bridge, a Major Historical and Cultural Site Protected at the National Level that no guide uses.
    expect(needsAGuide('bridge', { guideEditions: 0 }, false, SURROUNDINGS_CUT, true)).toBeNull();
    expect(needsAGuide('bridge', { guideEditions: null }, false, SURROUNDINGS_CUT, true)).toBeNull();
    // A listed dam still needs a guide: the exception is the bridge's.
    expect(needsAGuide('dam', { guideEditions: 0 }, false, SURROUNDINGS_CUT, true)).not.toBeNull();
  });

  it('reads a held one by its guide as last read where no usage is built, and lets no new one in (ADR-0175 decision 6)', () => {
    // The Finse Tunnel and the Eschbach Dam, held, a guide using each when last read: they stay.
    expect(needsAGuide('tunnel', { guideEditions: null, guidedAsLastRead: true }, true)).toBeNull();
    expect(needsAGuide('dam', { guideEditions: null, guidedAsLastRead: true }, true)).toBeNull();
    // Held and never read by a build: unknown, never no guide.
    expect(needsAGuide('dam', { guideEditions: null, guidedAsLastRead: null }, true)).toBeNull();
    // Held, and no guide used it when last read: it falls as it would have then.
    expect(needsAGuide('lock', { guideEditions: null, guidedAsLastRead: false }, true))
      .toMatch(/^a lock stays in the surroundings tier only while a Wikivoyage edition uses it, and none did when last read/);
    // New: nothing the run read says a guide uses it.
    expect(needsAGuide('tunnel', { guideEditions: null }))
      .toMatch(/^a tunnel enters the surroundings tier only when a Wikivoyage edition uses it, and no Wikivoyage usage is built/);
    expect(needsAGuide('bridge', { guideEditions: null })).not.toBeNull();
  });
});
