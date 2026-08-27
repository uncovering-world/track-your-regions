import { describe, it, expect } from 'vitest';
import { inDangerLabel } from './dangerLabel';

describe('inDangerLabel', () => {
  it('dates the badge where the catalogue knows the year', () => {
    // The Ancient City of Aleppo, listed in danger since 2013.
    expect(inDangerLabel(2013)).toBe('In Danger since 2013');
  });

  it('still badges a site whose listing carries no year', () => {
    expect(inDangerLabel(null)).toBe('In Danger');
  });

  it('reads an absent field as an undated badge, not as a missing year', () => {
    // `undefined === null` is false, so a check written against null alone
    // would print "In Danger since undefined" for a payload that omits it.
    expect(inDangerLabel(undefined)).toBe('In Danger');
    expect(inDangerLabel()).toBe('In Danger');
  });
});
