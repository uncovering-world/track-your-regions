import { describe, it, expect } from 'vitest';
import { claimLabel } from './placeClaims';

describe('claimLabel', () => {
  it('says nothing for a place the source still owns whole', () => {
    expect(claimLabel([])).toBeNull();
    expect(claimLabel(undefined)).toBeNull();
    expect(claimLabel(null)).toBeNull();
  });

  it('names the field a correction claimed, in the row\'s words', () => {
    expect(claimLabel(['name'])).toBe('name corrected');
    expect(claimLabel(['location'])).toBe('pin corrected');
    expect(claimLabel(['location', 'name'])).toBe('name and pin corrected');
  });

  it('leaves a claim it cannot describe to the claims screen', () => {
    // Nothing writes other keys on a place today; if something does, the row says
    // nothing rather than something wrong.
    expect(claimLabel(['ordinal'])).toBeNull();
  });
});
