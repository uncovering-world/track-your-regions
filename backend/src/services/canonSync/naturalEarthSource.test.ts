import { describe, it, expect } from 'vitest';
import { normalizeNeCountry, normalizeNeDisputed, buildSovereignIso3Map, resolveSovereignCodes } from './naturalEarthSource.js';

const GEOM = { type: 'MultiPolygon', coordinates: [] };

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

describe('buildSovereignIso3Map / resolveSovereignCodes', () => {
  // GB1 group, listed in array order that would trip a naive "first Country-
  // typed member" pick: Jersey (a Crown Dependency, also TYPE=Country) comes
  // before the United Kingdom itself. Only HOMEPART=1 disambiguates it.
  const jersey = normalizeNeCountry(
    { ADMIN: 'Jersey', ISO_A2_EH: 'JE', ISO_A3_EH: 'JEY', SOV_A3: 'GB1', HOMEPART: -99, TYPE: 'Country' }, GEOM);
  const uk = normalizeNeCountry(
    { ADMIN: 'United Kingdom', ISO_A2_EH: 'GB', ISO_A3_EH: 'GBR', SOV_A3: 'GB1', HOMEPART: 1, TYPE: 'Country' }, GEOM);
  const gibraltar = normalizeNeCountry(
    { ADMIN: 'Gibraltar', ISO_A2_EH: 'GI', ISO_A3_EH: 'GIB', SOV_A3: 'GB1', HOMEPART: -99, TYPE: 'Disputed' }, GEOM);

  it('resolves a composite SOV_A3 group (GB1) to its HOMEPART member, not just any same-TYPE member', () => {
    const map = buildSovereignIso3Map([jersey, uk, gibraltar]);
    expect(map.get('GB1')).toBe('GBR');
  });

  it('maps a single-member (plain-ISO) SOV_A3 group to itself', () => {
    const france = normalizeNeCountry(
      { ADMIN: 'France', ISO_A2_EH: 'FR', ISO_A3_EH: 'FRA', SOV_A3: 'FRA', HOMEPART: 1, TYPE: 'Sovereign country' }, GEOM);
    const map = buildSovereignIso3Map([france]);
    expect(map.get('FRA')).toBe('FRA');
  });

  it('resolveSovereignCodes rewrites a matched sovIso3 and passes an unmatched one through untouched', () => {
    const map = buildSovereignIso3Map([jersey, uk, gibraltar]);
    const [resolved, passthrough] = resolveSovereignCodes(
      [gibraltar, { ...gibraltar, sovIso3: 'KAS' }], map,
    );
    expect(resolved.sovIso3).toBe('GBR');
    expect(passthrough.sovIso3).toBe('KAS'); // not in the map (e.g. an unresolvable code) — left as-is
  });
});
