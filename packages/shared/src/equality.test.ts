import { describe, it, expect } from 'vitest';
import { jsonEquals } from './equality.js';

/**
 * The four properties a run's changeset and a review card used to state each
 * against its own copy (#570). They are the whole of what the two sides have to
 * agree on, so they are stated once, here, against the one declaration.
 */
describe('the equality a run and a curation card share', () => {
  it('does not treat key order inside a value as a difference', () => {
    expect(jsonEquals({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(jsonEquals({ criteria: ['i', 'iv'], inDanger: false }, { inDanger: false, criteria: ['i', 'iv'] })).toBe(true);
  });

  it('does not treat a null or empty key as different from a missing one', () => {
    expect(jsonEquals({ criteria: null }, {})).toBe(true);
    expect(jsonEquals({ criteria: '' }, {})).toBe(true);
    expect(jsonEquals({ criteria: undefined }, { criteria: null })).toBe(true);
    expect(jsonEquals(null, '')).toBe(true);
  });

  it('does treat array order inside a value as a difference', () => {
    expect(jsonEquals({ criteria: ['i', 'iv'] }, { criteria: ['iv', 'i'] })).toBe(false);
    expect(jsonEquals(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(jsonEquals(['a'], ['a', 'b'])).toBe(false);
  });

  it('holds a string apart from the number that reads the same', () => {
    expect(jsonEquals({ year: 1979 }, { year: '1979' })).toBe(false);
    expect(jsonEquals(1979, '1979')).toBe(false);
  });

  it('reads an array and an object as different things', () => {
    expect(jsonEquals([], {})).toBe(false);
    expect(jsonEquals({ 0: 'a' }, ['a'])).toBe(false);
  });
});
