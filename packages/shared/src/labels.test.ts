import { describe, it, expect } from 'vitest';
import { foldLabel, foldTypography, sameLabel, sameTypography, tidyLabel, untypeset } from './labels.js';

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

describe("the World Heritage list's typesetting defects (#1965)", () => {
  it('mends what the list wrote, as its reader stores it', () => {
    expect(untypeset('Shoal Tower,Kingston')).toBe('Shoal Tower, Kingston');
    expect(untypeset('Epipolae,Achradina,Tyche and Neapolis, Euryalus Castle, Dionysian forti \ufb01cations'))
      .toBe('Epipolae, Achradina, Tyche and Neapolis, Euryalus Castle, Dionysian fortifications');
    expect(untypeset('Segment Patacancha-Huacahuasi,Huacahuasi-Machucucho')).toBe('Segment Patacancha-Huacahuasi, Huacahuasi-Machucucho');
    expect(untypeset('"Kluchevskoy" Regional Nature Park"')).toBe('"Kluchevskoy" Regional Nature Park');
    expect(untypeset('Southern Kamchatka" Regional Nature Park (two parcels)')).toBe('Southern Kamchatka Regional Nature Park (two parcels)');
    expect(untypeset('\ufb02ats and Sta\ufb00')).toBe('flats and Staff');
  });

  it('keeps what is not a defect', () => {
    for (const name of [
      'Tokhwa-ri Tombs No. 1,2,3', 'Jebel Barisha [Deirouné]', 'Xanthos bis [outlier]', '[main complex of Mahabalipuram]',
      '"Kluchevskoy" Regional Nature Park', 'Park "Foo', 'Villa Mairea, Pori', 'Battery of 12" guns', 'Barrel 12"', '',
    ]) expect(untypeset(name)).toBe(name);
  });

  it('passes the mended name over the raw one, and never the raw one back', () => {
    expect(sameTypography('Shoal Tower,Kingston', 'Shoal Tower, Kingston')).toBe(true);
    expect(sameTypography('Dionysian forti \ufb01cations', 'Dionysian fortifications')).toBe(true);
    expect(sameTypography('Southern Kamchatka" Regional Nature Park', 'Southern Kamchatka Regional Nature Park')).toBe(true);
    expect(sameTypography('Shoal Tower, Kingston', 'Shoal Tower,Kingston')).toBe(false);
    expect(sameTypography('Southern Kamchatka Regional Nature Park', 'Southern Kamchatka" Regional Nature Park')).toBe(false);
    expect(foldTypography('Shoal Tower,Kingston')).toBe(foldTypography('Shoal Tower, Kingston'));
  });

  it('is its own mend, so what the reader stores passes the one-way check', () => {
    for (const name of [
      'Foo" Bar" Baz', 'a",b', 'a" \ufb01x', 'Shoal Tower,Kingston', '"Kluchevskoy" Regional Nature Park"', 'a" "b',
      'Southern Kamchatka"" Regional Park', 'Battery of 12" guns', 'Barrel 12"',
    ]) expect(untypeset(untypeset(name))).toBe(untypeset(name));
    expect(untypeset('Foo" Bar" Baz')).toBe('Foo Bar Baz');
    expect(untypeset('Southern Kamchatka"" Regional Park')).toBe('Southern Kamchatka Regional Park');
  });

  it('passes a rewrite of quote shapes in a text that held a defect and still does', () => {
    expect(sameTypography('Fort Ross,California \u201cthe fort\u201d', 'Fort Ross,California "the fort"')).toBe(true);
    expect(sameTypography('12\u2033 gun', '12" gun')).toBe(true);
    expect(sameTypography('the \u201cGolden" Gate', 'the \u201cGolden\u201d Gate')).toBe(true);
    expect(sameTypography('Park', 'Park\u201d')).toBe(false);
    expect(foldTypography('Kamchatka\u201d Park')).toBe(foldTypography('Kamchatka Park'));
    expect(untypeset('the \u201cGolden" Gate')).toBe('the \u201cGolden" Gate');
    expect(sameTypography('Battery of 12" guns', 'Battery of 12 guns')).toBe(false);
  });

  it('still holds a space put or taken inside a word, and a comma between digits', () => {
    expect(sameTypography('Tombs No. 1,2,3', 'Tombs No. 1, 2, 3')).toBe(false);
    expect(sameTypography('Shoal Tower, Kingston', 'Shoal Tower,  Kings ton')).toBe(false);
  });
});
