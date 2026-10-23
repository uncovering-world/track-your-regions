import { describe, expect, it } from 'vitest';
import { approximateLocationWords } from './approximateLocation';

describe('what a visitor is told about a roughly placed point (#1912)', () => {
  it('says a point given to the whole minute is often a kilometre or more off, and promises no radius', () => {
    const words = approximateLocationWords('whole-minute');
    expect(words).toMatch(/^Approximate location: .*nearest minute of arc.*a kilometre or more/);
    // Half of these points stand farther off than any bound a radius would give (Longmen: 10 km).
    expect(words).not.toMatch(/within/);
  });

  it('says a point several parts share may stand elsewhere nearby', () => {
    expect(approximateLocationWords('shared')).toMatch(/^Approximate location: .*one point for several parts/);
  });
});
