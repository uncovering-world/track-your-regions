/**
 * The drawing side's fold, and the one promise that matters about it: it is the
 * same rule the catalogue is folded by.
 *
 * No module crosses the front/back boundary (#527), so the rule is declared
 * twice — and a second declaration is a second answer to "is this the same
 * name" waiting to happen. That the two agree is pinned from the storing side,
 * in `backend/src/services/sync/labelFold.test.ts`, where `urlSafety.test.ts`
 * pins the host list and where `node:fs` is in scope. What is asserted here is
 * the behaviour a curator meets.
 */

import { describe, it, expect } from 'vitest';
import { foldLabel, sameLabel, tidyLabel } from './labelFold';

describe('foldLabel', () => {
  it('folds the typesetting a source varies and nothing else', () => {
    // Q2415079, *The Washington Family*, lists Edward Savage twice under two
    // QIDs — the case the fold was written for.
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

describe('tidyLabel', () => {
  it('stores a name as a person would type it, and keeps the spelling', () => {
    // The two works the catalogue held with runs (#835), and a wrapped-line paste.
    expect(tidyLabel(' St. John  on Patmos ')).toBe('St. John on Patmos');
    expect(tidyLabel('Portrait of a Man (Self      Portrait?)')).toBe('Portrait of a Man (Self Portrait?)');
    expect(tidyLabel('Getbol,\u00a0Korean Tidal Flats')).toBe('Getbol, Korean Tidal Flats');
    // The store rule, not the fold: case and dashes are the curator's own.
    expect(tidyLabel('Boma–Badingilo')).toBe('Boma–Badingilo');
    expect(tidyLabel('Edward SAVAGE')).toBe('Edward SAVAGE');
    expect(tidyLabel('   ')).toBe('');
  });
});
