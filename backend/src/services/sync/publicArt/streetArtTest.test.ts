/**
 * Whether a candidate the street-art entrance named is a street-art place
 * (#2035), asked on the places the rule was measured on: the Lennon Wall in
 * Prague (typed a wall), Hosier Lane in Melbourne (a road), the Freedom Tunnel
 * in New York (a railway tunnel), and the tail of a graffiti category — a
 * cathedral, a painting, a commune.
 */

import { describe, expect, it } from 'vitest';
import { buildTrees } from './classes.js';
import { streetArtVerdict, type StreetArtFacts } from './streetArtTest.js';

const WALL = 'Q42948';
const ROAD = 'Q34442';
const RAILWAY_TUNNEL = 'Q1311958';
const WORSHIP = 'Q1370598';
const CATHEDRAL = 'Q2977';
const PAINTING = 'Q3305213';
const SETTLEMENT = 'Q486972';
const LOST_ARTWORK = 'Q4140840';
const TOMB = 'Q381885';

const trees = buildTrees({
  sculptural: [], fountain: [], commemorative: [], museum: [],
  worship: [WORSHIP, CATHEDRAL],
  lost: [LOST_ARTWORK],
});

const facts = (over: Partial<StreetArtFacts>): StreetArtFacts => ({
  qid: 'Q1630131', classes: [WALL], excludedRoots: [], atlasObscura: true, guided: true, readers: 40_000,
  ended: false, admitted: false, onEarth: true, lat: 50.0862, lon: 14.4073, ...over,
});

const reasonOf = (v: ReturnType<typeof streetArtVerdict>) => ('reason' in v ? v.reason : null);

describe('the street-art line (#2035)', () => {
  it('admits a newcomer with two of the three marks, whatever its class', () => {
    expect(streetArtVerdict(facts({}), trees)).toEqual({ pass: true, type: 'street-art' });
    expect(streetArtVerdict(facts({ qid: 'Q5908090', classes: [ROAD], guided: false }), trees)).toEqual({ pass: true, type: 'street-art' });
    expect(streetArtVerdict(facts({ qid: 'Q5500657', classes: [RAILWAY_TUNNEL], atlasObscura: false, readers: 12_000 }), trees))
      .toEqual({ pass: true, type: 'street-art' });
  });

  it('leaves a newcomer below the line out quietly, and one whose readers cannot be read', () => {
    expect(streetArtVerdict(facts({ guided: false, readers: 9_999 }), trees)).toEqual({ pass: false, quiet: true });
    expect(streetArtVerdict(facts({ readers: null }), trees)).toEqual({ pass: false, quiet: true });
  });

  it('keeps a held place on one mark, and lets it fall with none', () => {
    const held = facts({ admitted: true, atlasObscura: false, guided: false });
    expect(streetArtVerdict({ ...held, readers: 10_000 }, trees)).toEqual({ pass: true, type: 'street-art' });
    expect(reasonOf(streetArtVerdict({ ...held, readers: 3_210 }, trees))).toBe(
      'no Atlas Obscura entry, no Wikivoyage guide and 3,210 readers a year: '
      + 'below the street-art line (2 of those to enter, with 10,000 readers a year; 1 to stay)',
    );
  });

  it('keeps a held place whose readers cannot be read', () => {
    expect(streetArtVerdict(facts({ admitted: true, atlasObscura: false, guided: false, readers: null }), trees))
      .toEqual({ pass: true, type: 'street-art' });
  });
});

describe('what a street-art place is not (#2035)', () => {
  it('refuses a place of worship or a lost work through its tree', () => {
    expect(reasonOf(streetArtVerdict(facts({ classes: [CATHEDRAL] }), trees))).toBe('a place of worship: not a street-art place');
    expect(reasonOf(streetArtVerdict(facts({ classes: [LOST_ARTWORK] }), trees))).toBe('a lost or destroyed work: not a street-art place');
  });

  it('refuses a burial place by its class', () => {
    expect(reasonOf(streetArtVerdict(facts({ classes: [TOMB] }), trees))).toBe('a tomb: not a street-art place');
  });

  it('names the excluded root a class is a kind of', () => {
    expect(reasonOf(streetArtVerdict(facts({ classes: [PAINTING], excludedRoots: [PAINTING] }), trees)))
      .toBe('a painting: not a street-art place');
    expect(reasonOf(streetArtVerdict(facts({ classes: ['Q2035001'], excludedRoots: [SETTLEMENT] }), trees)))
      .toBe('a human settlement: not a street-art place');
  });

  it('refuses a place that is gone, has no coordinate, or is off Earth, in that order', () => {
    expect(reasonOf(streetArtVerdict(facts({ ended: true, lat: null }), trees)))
      .toBe('demolished or dissolved (P576): nothing to stand in front of');
    expect(reasonOf(streetArtVerdict(facts({ lat: null }), trees))).toBe('no coordinate (P625): nowhere to stand');
    expect(reasonOf(streetArtVerdict(facts({ onEarth: false }), trees)))
      .toBe('not on Earth: its coordinate (P625) is on another globe');
  });

  it('reads the line before what it is, so a category tail below the line is never refused', () => {
    expect(streetArtVerdict(facts({ classes: [CATHEDRAL], guided: false, readers: 500 }), trees)).toEqual({ pass: false, quiet: true });
  });
});
