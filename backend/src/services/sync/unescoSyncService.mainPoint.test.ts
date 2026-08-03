/**
 * Tests for the site's main point.
 *
 * UNESCO leaves `coordinates` null on serial nominations and puts the real
 * positions in `components_list`. Requiring the main field discarded 28 of the
 * 29 records that failed the dry run of 3 August — including sites already in
 * the catalogue whose main field the source has since emptied.
 */

import { describe, it, expect } from 'vitest';
import { resolveMainPoint } from './unescoSyncService.js';
import type { UnescoApiRecord, ParsedLocation } from './types.js';

function record(overrides: Partial<UnescoApiRecord> = {}): UnescoApiRecord {
  return { id_no: '136', name_en: 'Garamba National Park', category: 'Natural', ...overrides };
}

function component(overrides: Partial<ParsedLocation> = {}): ParsedLocation {
  return { name: 'Weiße Stadt', externalRef: '1239bis-005', lat: 52.5694, lon: 13.3508, ...overrides };
}

describe('resolveMainPoint', () => {
  it('uses the site\'s own coordinates when the source provides them', () => {
    const point = resolveMainPoint(record({ coordinates: { lat: -2.3333, lon: 34.8333 } }), []);

    expect(point).toEqual({ lat: -2.3333, lon: 34.8333 });
  });

  it('falls back to the components when the main field is empty', () => {
    // The shape of 28 of the 29 dry-run failures
    const point = resolveMainPoint(record(), [component()]);

    expect(point).toEqual({ lat: 52.5694, lon: 13.3508 });
  });

  it('picks the most central component, not the first one listed', () => {
    // Getbol's shape: parts strung along a coast, the first of them 300 km from
    // the middle — far enough to land in another region
    const point = resolveMainPoint(record(), [
      component({ lat: 37.5, lon: 126.6 }),
      component({ lat: 35.0, lon: 126.2 }),
      component({ lat: 34.8, lon: 126.1 }),
    ]);

    expect(point).toEqual({ lat: 35.0, lon: 126.2 });
  });

  it('still returns a real component rather than an average of them', () => {
    // A centroid of scattered parts can fall in open water; every component is
    // by construction a place at the site
    const parts = [
      component({ lat: 0.14, lon: 6.64 }),
      component({ lat: 0.22, lon: 6.60 }),
      component({ lat: 1.60, lon: 7.40 }),
    ];
    const point = resolveMainPoint(record(), parts);

    expect(parts.some(p => p.lat === point?.lat && p.lon === point?.lon)).toBe(true);
  });

  it('prefers the site\'s own point over its components', () => {
    const point = resolveMainPoint(
      record({ coordinates: { lat: 1, lon: 2 } }),
      [component({ lat: 50, lon: 50 })],
    );

    expect(point).toEqual({ lat: 1, lon: 2 });
  });

  it('treats a coordinate of zero as a position, not as missing', () => {
    // A site on the equator or the prime meridian; truthiness would send it to
    // the component fallback and move it
    const point = resolveMainPoint(
      record({ coordinates: { lat: 0, lon: 6.6 } }),
      [component({ lat: 50, lon: 50 })],
    );

    expect(point).toEqual({ lat: 0, lon: 6.6 });
  });

  it('averages longitudes the short way round the antimeridian', () => {
    // Parts half a degree apart across the 180th meridian. An arithmetic mean
    // puts their centre at longitude 0 — the opposite side of the planet — and
    // would rank both against it. See CLAUDE.md § Antimeridian Handling.
    const parts = [
      component({ lat: -16.0, lon: 179.9 }),
      component({ lat: -16.1, lon: -179.9 }),
      component({ lat: -16.05, lon: 179.95 }),
    ];
    const point = resolveMainPoint(record(), parts);

    // The middle part is nearest the true centre; a mean of 0 would have picked
    // whichever part sat closest to Greenwich instead
    expect(point).toEqual({ lat: -16.05, lon: 179.95 });
  });

  it('gives up only when there is no coordinate anywhere', () => {
    // Site 1567 — the one genuine failure, in July and now
    expect(resolveMainPoint(record({ id_no: '1567' }), [])).toBeNull();
  });

  it('treats a half-populated coordinate pair as absent', () => {
    const point = resolveMainPoint(
      record({ coordinates: { lat: 52.5, lon: undefined as unknown as number } }),
      [component({ lat: 10, lon: 20 })],
    );

    expect(point).toEqual({ lat: 10, lon: 20 });
  });
});
