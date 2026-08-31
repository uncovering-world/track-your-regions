import { describe, it, expect } from 'vitest';
import { creators, creatorsBrief } from './creatorList';

describe('creators', () => {
  it('names one maker as itself', () => {
    expect(creators(['Leonardo da Vinci'])).toBe('Leonardo da Vinci');
  });

  it('joins two with "and", which is the fact rather than a summary of it', () => {
    expect(creators(['Ivan Shishkin', 'Konstantin Savitsky']))
      .toBe('Ivan Shishkin and Konstantin Savitsky');
  });

  it('joins three the way the rest of the product writes a list', () => {
    // The three Rhodian sculptors of the Laocoön, in Wikidata's order.
    expect(creators(['Athanadoros', 'Agesander of Rhodes', 'Polydoros']))
      .toBe('Athanadoros, Agesander of Rhodes and Polydoros');
  });

  it('says nothing where nobody is recorded, so a caller can leave the line out', () => {
    expect(creators([])).toBeNull();
    expect(creators(null)).toBeNull();
    expect(creators(undefined)).toBeNull();
  });

  it('ignores an entry that is only whitespace rather than printing a gap', () => {
    expect(creators(['Ivan Shishkin', '  '])).toBe('Ivan Shishkin');
    expect(creators(['   '])).toBeNull();
  });
});

describe('creatorsBrief', () => {
  it('gives two names whole, because two is what most works have', () => {
    expect(creatorsBrief(['Ivan Shishkin', 'Konstantin Savitsky']))
      .toBe('Ivan Shishkin and Konstantin Savitsky');
  });

  it('says who leads a collaboration and how many there are', () => {
    // The Moon Museum: six artists on a ceramic wafer. "Andy Warhol" alone never
    // said it was a collaboration.
    expect(creatorsBrief([
      'Andy Warhol', 'Claes Oldenburg', 'Robert Rauschenberg',
      'John Chamberlain', 'Forrest Myers', 'David Novros',
    ])).toBe('Andy Warhol and 5 others');
  });

  it('counts one other in the singular', () => {
    expect(creatorsBrief(['Athanadoros', 'Agesander of Rhodes', 'Polydoros']))
      .toBe('Athanadoros and 2 others');
    expect(creatorsBrief(['A', 'B', 'C'])).toBe('A and 2 others');
  });

  it('answers as the long form does where there is nothing to shorten', () => {
    expect(creatorsBrief(['Leonardo da Vinci'])).toBe('Leonardo da Vinci');
    expect(creatorsBrief([])).toBeNull();
  });
});
