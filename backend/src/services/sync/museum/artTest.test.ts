import { describe, it, expect } from 'vitest';
import { artVerdict, isSculptural, ART_CLASSES, EDITORIAL_OUT } from './artTest.js';

const painting = { sculptural: false };
const sculpture = { sculptural: true };

describe('artVerdict', () => {
  it('admits an entity carrying an art class, whatever it holds', () => {
    // the Uffizi is typed palace + art museum; the palace must not disqualify it
    expect(artVerdict(['Q2519', 'Q207694'], []).art).toBe(true);
  });

  it('keeps a museum typed only `museum` when its famous holdings are paintings', () => {
    // the Hermitage: bare `museum`, 34 famous paintings
    const v = artVerdict(['Q33506'], Array(34).fill(painting));
    expect(v.art).toBe(true);
    expect(v.why).toContain('painting-share');
  });

  it('drops a museum whose famous holdings are sculpture', () => {
    // Naturhistorisches Museum Vienna: the Venus of Willendorf and nothing painted
    expect(artVerdict(['Q33506'], [sculpture, sculpture]).art).toBe(false);
  });

  it('drops a museum with no famous holding at all', () => {
    expect(artVerdict(['Q33506'], []).art).toBe(false);
  });

  it('treats an equal split as art, not against it', () => {
    expect(artVerdict(['Q33506'], [painting, sculpture]).art).toBe(true);
  });
});

describe('isSculptural', () => {
  it('matches by shape, not by equality, because the pool carries many class labels', () => {
    for (const t of ['sculpture', 'statue', 'bust', 'group of casts', 'relief']) {
      expect(isSculptural(t)).toBe(true);
    }
    for (const t of ['painting', 'fresco', 'wall painting', 'drawing', 'painting series']) {
      expect(isSculptural(t)).toBe(false);
    }
  });
});

describe('ART_CLASSES', () => {
  it('carries the label named for each of the thirteen measured classes', () => {
    // Q207694 and Q3196771 are two distinct Wikidata entities that share the label "art museum" —
    // a regression here would mean one of them silently dropped out again.
    expect(Object.keys(ART_CLASSES).sort()).toEqual([
      'Q107524840', 'Q107537774', 'Q108860927', 'Q111889841', 'Q126195053', 'Q1475403',
      'Q207694', 'Q3196771', 'Q3844310', 'Q61891263', 'Q740437', 'Q957433', 'Q97662266',
    ].sort());
  });
});

describe('EDITORIAL_OUT', () => {
  it('names all four entities no class rule reaches', () => {
    // Each one carries an ART_CLASSES member and would otherwise be admitted by rule 1 alone —
    // removing any single key silently readmits that one entity.
    expect(Object.keys(EDITORIAL_OUT).sort()).toEqual(
      ['Q313746', 'Q623578', 'Q6373', 'Q699943'].sort(),
    );
  });

  it('gives the British Museum a reason naming the strict-art boundary', () => {
    expect(EDITORIAL_OUT.Q6373).toContain('British Museum');
    expect(EDITORIAL_OUT.Q6373).toContain('strict-art boundary');
  });

  it('gives East Side Gallery a reason naming it is not really a museum', () => {
    expect(EDITORIAL_OUT.Q313746).toContain('East Side Gallery');
  });
});
