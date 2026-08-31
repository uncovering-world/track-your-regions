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
    // "A and B" says they made it together and nothing about which leads, so the
    // confirmation makes no difference here.
    expect(creatorsBrief(['Ivan Shishkin', 'Konstantin Savitsky']))
      .toBe('Ivan Shishkin and Konstantin Savitsky');
    expect(creatorsBrief(['Ivan Shishkin', 'Konstantin Savitsky'], true))
      .toBe('Ivan Shishkin and Konstantin Savitsky');
  });

  it('counts them rather than naming a leader nobody chose', () => {
    // The Moon Museum's list arrives from the pool with David Novros in front and
    // Andy Warhol last — the banded query answers in reverse of the source's own
    // order, so the first name is a query planner's pick (ADR-0040).
    expect(creatorsBrief([
      'David Novros', 'Forrest Myers', 'John Chamberlain',
      'Robert Rauschenberg', 'Claes Oldenburg', 'Andy Warhol',
    ])).toBe('6 artists');
  });

  it('leads with the first name once a curator has claimed the order', () => {
    expect(creatorsBrief([
      'Andy Warhol', 'Claes Oldenburg', 'Robert Rauschenberg',
      'John Chamberlain', 'Forrest Myers', 'David Novros',
    ], true)).toBe('Andy Warhol and 5 others');
  });

  it('counts three the same way, since three is already past a row', () => {
    expect(creatorsBrief(['Polydoros', 'Agesander of Rhodes', 'Athanadoros']))
      .toBe('3 artists');
    expect(creatorsBrief(['Athanadoros', 'Agesander of Rhodes', 'Polydoros'], true))
      .toBe('Athanadoros and 2 others');
  });

  it('takes the noun from its caller, so a monument is not called an artist', () => {
    expect(creatorsBrief(['A', 'B', 'C'], false, 'maker')).toBe('3 makers');
  });

  it('answers as the long form does where there is nothing to shorten', () => {
    expect(creatorsBrief(['Leonardo da Vinci'])).toBe('Leonardo da Vinci');
    expect(creatorsBrief([])).toBeNull();
    expect(creatorsBrief(null, true)).toBeNull();
  });
});
