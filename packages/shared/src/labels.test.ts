import { describe, it, expect } from 'vitest';
import { foldLabel, sameLabel, tidyLabel } from './labels.js';

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
