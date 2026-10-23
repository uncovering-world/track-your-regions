import { describe, it, expect } from 'vitest';
import { foldLabel, foldTypography, sameLabel, sameTypography, tidyLabel } from './labels.js';

describe('the fold both sides use', () => {
  it('folds what a source varies in typesetting, and nothing further', () => {
    // Q2415079, *The Washington Family*, lists Edward Savage twice under two
    // QIDs — the case this was written for.
    expect(sameLabel('Edward Savage', 'edward  SAVAGE')).toBe(true);
    // A wrapped line pastes with two spaces; a dash may be any of Unicode's.
    expect(sameLabel('Vincent van Gogh', 'Vincent  van Gogh')).toBe(true);
    expect(sameLabel('Jean-Luc Godard', 'Jean‐Luc Godard')).toBe(true);
    expect(sameLabel('Boma-Badingilo', 'Boma–Badingilo')).toBe(true);
  });

  it('leaves a different name different', () => {
    // A name that differs by more than its punctuation is a real rename.
    expect(sameLabel('Agasias of Ephesus', 'Nicolas Cordier')).toBe(false);
    expect(sameLabel('Giulio Romano', 'Giulio Romani')).toBe(false);
  });

  it('reads an absent name as nothing rather than as "null"', () => {
    expect(foldLabel(null)).toBe('');
    expect(foldLabel(undefined)).toBe('');
  });
});

describe('the store rule both sides use', () => {
  it('collapses the whitespace a label service passes through, and nothing further', () => {
    // Q2390197 and Q2392901, the two works the catalogue held with runs (#835).
    expect(tidyLabel(' St. John  on Patmos ')).toBe('St. John on Patmos');
    expect(tidyLabel('Portrait of a Man (Self      Portrait?)')).toBe('Portrait of a Man (Self Portrait?)');
    expect(tidyLabel('  Louvre \n')).toBe('Louvre');
    // The no-break space four local names carry is whitespace to a person.
    expect(tidyLabel('Getbol, Korean Tidal Flats')).toBe('Getbol, Korean Tidal Flats');
    // A store rule, not the fold: case and dashes are the source's spelling.
    expect(tidyLabel('Boma–Badingilo')).toBe('Boma–Badingilo');
    expect(tidyLabel('MAK – Museum of Applied Arts')).toBe('MAK – Museum of Applied Arts');
    expect(tidyLabel('Edward SAVAGE')).toBe('Edward SAVAGE');
    // Nothing but whitespace is nothing: the schemas then refuse it as empty.
    expect(tidyLabel('   ')).toBe('');
  });
});

describe('a rewrite that changes only typography (#1834)', () => {
  it('folds quote, apostrophe and dash shapes, whitespace runs and the ends', () => {
    // Gondwana Rainforests of Australia's held description, one character apart.
    expect(sameTypography('on Australia\u2019s east coast', "on Australia's east coast")).toBe(true);
    expect(sameTypography('\u201cthe Pearl\u201d', '"the Pearl"')).toBe(true);
    expect(sameTypography('1450\u20131550', '1450-1550')).toBe(true);
    expect(sameTypography('Historic  Centre ', 'Historic Centre')).toBe(true);
    // The same letter composed and decomposed.
    expect(sameTypography('Hollok\u00f6', 'Hollok' + 'o\u0308')).toBe(true);
  });

  it('drops the trailing literal escape the World Heritage list once wrote', () => {
    // Pergamon's Maltepe Tumulus and Bursa's Muradiye, stored with a backslash and a t.
    expect(sameTypography('Maltepe Tumulus\\t', 'Maltepe Tumulus')).toBe(true);
    expect(sameTypography('Muradiye (Murad II) K\u00fclliye\\t\\t', 'Muradiye (Murad II) K\u00fclliye')).toBe(true);
    expect(foldTypography('Gwangneung Cluster\\t')).toBe('Gwangneung Cluster');
    // Inside the text it is not the escape at the end.
    expect(sameTypography('a\\tb', 'ab')).toBe(false);
    // One way only: a source that adds the escape writes garbage, and is asked.
    expect(sameTypography('Maltepe Tumulus', 'Maltepe Tumulus\\t')).toBe(false);
    expect(sameTypography('Maltepe Tumulus', 'Maltepe Tumulus\\t ')).toBe(false);
  });

  it('keeps a space between two letters, case and accents', () => {
    // Old Village of Holl\u00f3k\u0151's held description: a corruption, not typesetting.
    expect(sameTypography('Hollok\u00f6', 'Hollok \u00f6')).toBe(false);
    expect(sameTypography('Salzburg', 'salzburg')).toBe(false);
    expect(sameTypography('Kapikaya', 'Kap\u0131kaya')).toBe(false);
  });

  it('is no rewrite where the text is the same or one side is none', () => {
    expect(sameTypography('Salzburg', 'Salzburg')).toBe(false);
    expect(sameTypography(null, 'Salzburg')).toBe(false);
  });
});
