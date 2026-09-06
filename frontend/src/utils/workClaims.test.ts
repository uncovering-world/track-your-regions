import { describe, it, expect } from 'vitest';
import { claimLabel } from './workClaims';

describe('claimLabel for a work', () => {
  it('says nothing for a work the source still owns whole', () => {
    expect(claimLabel([])).toBeNull();
    expect(claimLabel(undefined)).toBeNull();
    expect(claimLabel(null)).toBeNull();
  });

  it('names the column a correction claimed, in the row\'s words', () => {
    expect(claimLabel(['name'])).toBe('title corrected');
    expect(claimLabel(['year'])).toBe('year corrected');
    expect(claimLabel(['image_url'])).toBe('picture corrected');
  });

  it('says the makers were confirmed, because often nothing about them changed', () => {
    // The stored order is a query planner's (ADR-0040): claiming the column is
    // usually a curator vouching for the order the *Visitation* already had, and
    // "corrected" would describe that as a change nobody made.
    expect(claimLabel(['artists'])).toBe('makers confirmed');
  });

  it('joins several claims under one verb, in the row\'s own order', () => {
    // One act by one person: two verbs would read as two separate edits.
    expect(claimLabel(['artists', 'name'])).toBe('title and makers corrected');
    expect(claimLabel(['year', 'image_url', 'name'])).toBe('title, year and picture corrected');
  });

  it('leaves a claim it cannot describe to the claims screen', () => {
    // The credit has no key of its own on a work — the picture's claim covers
    // it — and anything else in the column is not this row's to name.
    expect(claimLabel(['metadata.imageCredit'])).toBeNull();
    expect(claimLabel(['is_iconic'])).toBeNull();
  });
});
