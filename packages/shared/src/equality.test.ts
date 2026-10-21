import { describe, it, expect } from 'vitest';
import { isEmptyValue, jsonEquals } from './equality.js';

/**
 * The properties a run's changeset and a review card have to agree on
 * (#570), stated once, here, against the one declaration rather than once per
 * side against its own copy (#789).
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

  it('does not treat an empty list as different from a missing key', () => {
    expect(jsonEquals({ creators: [] }, {})).toBe(true);
    expect(jsonEquals([], null)).toBe(true);
    expect(jsonEquals([], '')).toBe(true);
    expect(jsonEquals({ creators: [] }, { creators: ['Anish Kapoor'] })).toBe(false);
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

describe('isEmptyValue', () => {
  it('reads every spelling of nothing as nothing, and a value as a value', () => {
    expect(isEmptyValue([])).toBe(true);
    expect(isEmptyValue(null)).toBe(true);
    expect(isEmptyValue(undefined)).toBe(true);
    expect(isEmptyValue('')).toBe(true);
    expect(isEmptyValue(false)).toBe(false);
    expect(isEmptyValue(0)).toBe(false);
    expect(isEmptyValue({})).toBe(false);
    expect(isEmptyValue([''])).toBe(false);
  });
});
