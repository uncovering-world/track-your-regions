/**
 * The antimeridian rule for a box, now that it has one owner.
 *
 * The rule is a trap rather than a formula, so what these pin is the trap:
 * `ST_MakeEnvelope(170, -10, -170, 10)` does not fail, it normalises to
 * xmin -170 / xmax 170 — the whole planet *except* the strip asked for — and
 * the measurement that found it was 290 places matched between 10 S and 10 N
 * where one is truly in the box.
 *
 * A second spelling of it is the thing to prevent, which is why the world
 * layer's points read and the experience list both come through here.
 */

import { describe, it, expect } from 'vitest';
import { bboxIntersectsSql, parseBbox } from './bboxEnvelopes.js';

const at = { west: 1, south: 2, east: 3, north: 4 };

describe('parseBbox', () => {
  it('reads west,south,east,north', () => {
    expect(parseBbox('-10,35,30,60')).toEqual({ west: -10, south: 35, east: 30, north: 60 });
  });

  it('reads a box drawn across the antimeridian as it is written, without normalising it', () => {
    // west > east is the convention, not an error to be corrected here: the
    // correction is what loses the strip.
    expect(parseBbox('170,-10,-170,10')).toEqual({ west: 170, south: -10, east: -170, north: 10 });
  });

  it.each([
    ['nothing', undefined],
    ['an empty value', ''],
    ['three numbers', '1,2,3'],
    ['five numbers', '1,2,3,4,5'],
    ['a word', 'abc'],
    ['a number missing', '1,2,,4'],
    ['an infinity', '1,2,3,Infinity'],
  ])('names no box for %s', (_case, raw) => {
    expect(parseBbox(raw)).toBeNull();
  });

  it.each([
    ['a repeated parameter', ['1,2', '3,4']],
    ['a single-element array', ['-10,35,30,60']],
    ['an object', { west: 1 }],
    ['a number', 1234],
  ])('names no box for %s, rather than coercing one out of it', (_case, raw) => {
    // Express parses `?bbox=1,2&bbox=3,4` into an array, and `String` of that
    // array is `'1,2,3,4'` — a box composed out of two halves nobody sent. The
    // schema that guards the world points endpoint calls this function, so the
    // coercion sat inside the validation instead of in front of it.
    expect(parseBbox(raw)).toBeNull();
  });
});

describe('bboxIntersectsSql', () => {
  it('is one envelope for an ordinary box, over the caller\'s own parameters', () => {
    const sql = bboxIntersectsSql('el.location', { west: -10, south: 35, east: 30, north: 60 }, at);
    expect(sql).toBe('ST_Intersects(el.location, ST_MakeEnvelope($1, $2, $3, $4, 4326))');
  });

  it('is two envelopes meeting at the line for a crossing box', () => {
    const sql = bboxIntersectsSql('el.location', { west: 170, south: -10, east: -170, north: 10 }, at);
    expect(sql).toBe('(ST_Intersects(el.location, ST_MakeEnvelope($1, $2, 180, $4, 4326))'
      + ' OR ST_Intersects(el.location, ST_MakeEnvelope(-180, $2, $3, $4, 4326)))');
  });

  it('parenthesises the two-envelope form, so a caller appending it with AND cannot lose half', () => {
    const crossing = bboxIntersectsSql('g', { west: 170, south: -10, east: -170, north: 10 }, at);
    expect(`${crossing} AND something`).toMatch(/^\(.*\) AND something$/);
  });

  it('reads the same latitudes twice rather than asking for eight parameters', () => {
    const sql = bboxIntersectsSql('g', { west: 170, south: -10, east: -170, north: 10 }, at);
    expect(sql.match(/\$2/g)).toHaveLength(2);
    expect(sql).not.toContain('$5');
  });

  it('never builds an envelope whose west exceeds its east', () => {
    // The whole point: every envelope this produces is one PostGIS reads as
    // written. A box touching the line at exactly 180 is not a crossing.
    for (const box of [
      { west: 170, south: -10, east: -170, north: 10 },
      { west: -180, south: -90, east: 180, north: 90 },
      { west: 179.9, south: 0, east: 180, north: 1 },
    ]) {
      const sql = bboxIntersectsSql('g', box, at);
      const envelopes = sql.match(/ST_MakeEnvelope\(([^)]+)\)/g) ?? [];
      expect(envelopes.length).toBeGreaterThan(0);
      for (const envelope of envelopes) {
        const [xmin, , xmax] = envelope.slice('ST_MakeEnvelope('.length, -1).split(',').map(part => part.trim());
        const value = (token: string) => (token.startsWith('$')
          ? { $1: box.west, $2: box.south, $3: box.east, $4: box.north }[token as '$1']
          : Number(token));
        expect(value(xmin)).toBeLessThan(value(xmax) as number);
      }
    }
  });
});
