import { describe, it, expect, vi } from 'vitest';

// The module pulls in the pool for loadGADMData; nothing under test touches it.
vi.mock('../../db/index.js', () => ({ pool: { query: vi.fn() } }));

import {
  cleanWvName,
  findBestAmongChildren,
  getNameVariants,
  isPrefixMatch,
  normalizeName,
  stripTrailingSuffix,
  type DivisionEntry,
} from './matcherUtils.js';

function division(id: number, name: string, parentId: number | null = null): DivisionEntry {
  return { id, name, nameNormalized: normalizeName(name), parentId };
}

describe('stripTrailingSuffix', () => {
  it('strips a recognised trailing suffix', () => {
    expect(stripTrailingSuffix('kaduna state')).toBe('kaduna');
    expect(stripTrailingSuffix('osaka prefecture')).toBe('osaka');
  });

  it('leaves a name whose last word is not a suffix', () => {
    expect(stripTrailingSuffix('new south wales')).toBe('new south wales');
    expect(stripTrailingSuffix('osh')).toBe('osh');
  });

  it('leaves a single word even when the word is itself a suffix', () => {
    // "Region" alone is the whole name, not a suffix on something.
    expect(stripTrailingSuffix('region')).toBe('region');
  });

  it('strips across a non-breaking space, not just a plain one', () => {
    // The regression this replaced: `lastIndexOf(' ')` found nothing here, so
    // the name got no suffix-stripped variant. GADM names contain NBSP, and in
    // buildGadmCountryNameIndex a missing key means the country cannot be found
    // by name at all.
    expect(stripTrailingSuffix('kaduna state')).toBe('kaduna');
    expect(stripTrailingSuffix('kaduna\tstate')).toBe('kaduna');
  });

  it('strips the whole whitespace run before the suffix', () => {
    expect(stripTrailingSuffix('kaduna   state')).toBe('kaduna');
  });

  it('ignores trailing whitespace when locating the last word', () => {
    expect(stripTrailingSuffix('kaduna state  ')).toBe('kaduna');
  });
});

describe('getNameVariants', () => {
  it('returns the normalized name alone when nothing is stripped', () => {
    expect(getNameVariants('Osh')).toEqual(['osh']);
  });

  it('adds the suffix-stripped variant', () => {
    expect(getNameVariants('Kaduna State')).toEqual(['kaduna state', 'kaduna']);
  });

  it('normalizes accents', () => {
    expect(getNameVariants('Córdoba')).toEqual(['cordoba']);
  });
});

describe('cleanWvName', () => {
  it('drops a parenthetical annotation', () => {
    expect(cleanWvName('Osh (city)')).toBe('Osh');
    expect(cleanWvName('Georgia (country)')).toBe('Georgia');
  });

  it('leaves a name without parentheses', () => {
    expect(cleanWvName(' Osh ')).toBe('Osh');
  });
});

describe('isPrefixMatch', () => {
  it('matches a long-enough shared prefix', () => {
    expect(isPrefixMatch('ingush', 'ingushetia')).toBe(true);
  });

  it('refuses a short or disproportionate prefix', () => {
    expect(isPrefixMatch('osh', 'oshikoto')).toBe(false); // under 4 chars
    expect(isPrefixMatch('kent', 'kentuckyandmore')).toBe(false); // under 60%
  });

  it('compares hyphenated names part by part', () => {
    expect(isPrefixMatch('kabardin-balkar', 'kabardino-balkaria')).toBe(true);
  });
});

describe('findBestAmongChildren', () => {
  const candidates = [division(1, 'Osh'), division(2, 'Osh (city)')];

  it('prefers an exact match over a prefix match', () => {
    const best = findBestAmongChildren('Osh', candidates);
    expect(best?.entry.id).toBe(1);
    expect(best?.score).toBe(700);
  });

  it('with cleaning on, "Osh (city)" is reduced to "Osh" and takes the province', () => {
    // The country-based policy's behaviour, correct for Wikivoyage titles where
    // the parenthetical is an article disambiguator.
    const best = findBestAmongChildren('Osh (city)', candidates);
    expect(best?.entry.id).toBe(1);
  });

  it('with cleaning off, "Osh (city)" matches the division of that exact name', () => {
    // The hierarchical policy's behaviour. A base-layer node named "Osh (city)"
    // exists only because a division of that name exists, so stripping the
    // parenthetical turns an available exact match into a wrong one.
    const best = findBestAmongChildren('Osh (city)', candidates, false);
    expect(best?.entry.id).toBe(2);
    expect(best?.score).toBe(700);
  });

  it('returns null when nothing matches', () => {
    expect(findBestAmongChildren('Zeeland', candidates, false)).toBeNull();
  });
});
