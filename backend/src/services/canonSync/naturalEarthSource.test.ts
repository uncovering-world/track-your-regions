import { describe, it, expect } from 'vitest';
import { normalizeNeCountry, normalizeNeDisputed } from './naturalEarthSource.js';

describe('normalizeNeCountry', () => {
  it('prefers ISO_A3_EH over the -99 ISO_A3 quirk (France case)', () => {
    const f = normalizeNeCountry(
      { ADMIN: 'France', ISO_A2_EH: 'FR', ISO_A3: '-99', ISO_A3_EH: 'FRA', SOV_A3: 'FR1', TYPE: 'Country', WIKIDATAID: 'Q142' },
      { type: 'MultiPolygon', coordinates: [] },
    );
    expect(f.iso3).toBe('FRA');
    expect(f.iso2).toBe('FR');
    expect(f.wikidataQid).toBe('Q142');
  });

  it('falls back to ADM0_A3 when both ISO fields are -99', () => {
    const f = normalizeNeCountry(
      { ADMIN: 'Kosovo', ISO_A2_EH: '-99', ISO_A3: '-99', ISO_A3_EH: '-99', ADM0_A3: 'KOS', SOV_A3: 'KOS', TYPE: 'Disputed' },
      { type: 'MultiPolygon', coordinates: [] },
    );
    expect(f.iso3).toBe('KOS');
    expect(f.iso2).toBeNull();
  });
});

describe('normalizeNeDisputed', () => {
  it('extracts name, note, sovereign and QID', () => {
    const f = normalizeNeDisputed(
      { BRK_NAME: 'Crimea', NOTE_BRK: 'Admin. by Russia; claimed by Ukraine', SOV_A3: 'RUS', TYPE: 'Disputed', WIKIDATAID: 'Q7835' },
      { type: 'MultiPolygon', coordinates: [] },
    );
    expect(f).toMatchObject({ name: 'Crimea', sovIso3: 'RUS', type: 'Disputed', wikidataQid: 'Q7835' });
    expect(f.note).toContain('claimed by Ukraine');
  });
});
