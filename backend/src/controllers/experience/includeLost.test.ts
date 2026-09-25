import { describe, it, expect } from 'vitest';
import { includeLost } from './includeLost.js';

describe('includeLost', () => {
  it('is off unless the caller asks', () => {
    expect(includeLost({})).toBe(false);
    expect(includeLost({ includeLost: 'false' })).toBe(false);
    // A truthy-looking string is not the ask: only the explicit value counts,
    // or a stray `?includeLost=0` would put demolished sites back on the map
    expect(includeLost({ includeLost: '0' })).toBe(false);
    expect(includeLost({ includeLost: 'yes' })).toBe(false);
  });

  it('accepts the query-string and the parsed form', () => {
    expect(includeLost({ includeLost: 'true' })).toBe(true);
    expect(includeLost({ includeLost: true })).toBe(true);
  });
});
