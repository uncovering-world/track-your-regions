/**
 * Tests for the source's list as the writer receives it: `dedupeByIdentity`
 * removes the duplicates the source itself ships, and keeps every entry that
 * differs in reference or in point.
 */

import { describe, it, expect } from 'vitest';

import { dedupeByIdentity } from './locationIncoming.js';

describe('dedupeByIdentity', () => {
  it('keeps components that share a coordinate but not a reference', () => {
    // UNESCO's own data gives one coordinate to several distinct components:
    // site 874 has seventeen separately named and referenced rock shelters at
    // one point, with ten identical decimals — not a rounding artefact.
    // Collapsing those by point would discard 336 named components.
    const shelters = [
      { name: 'Abric I', externalRef: '874-185', lon: -0.11731, lat: 38.7835 },
      { name: 'Abric II', externalRef: '874-186', lon: -0.11731, lat: 38.7835 },
    ];

    expect(dedupeByIdentity(shelters)).toHaveLength(2);
  });

  it('keeps a reference that appears at more than one point', () => {
    // The mirror case: a component crossing a border is listed once per
    // country under one reference, with a distinct point each time.
    const transboundary = [
      { name: null, externalRef: '749ter-001', lon: 2.0, lat: 12.0 },
      { name: null, externalRef: '749ter-001', lon: 2.5, lat: 12.5 },
    ];

    expect(dedupeByIdentity(transboundary)).toHaveLength(2);
  });

  it('collapses entries that agree on both, which carry nothing to tell apart', () => {
    // Left in, these make the update's join many-to-many: both stored rows can
    // take the same incoming ordinal, and the write dies on the
    // (experience_id, ordinal) unique key — rolling that experience back on
    // every later sync.
    const repeated = [
      { name: 'A', externalRef: 'r1', lon: 5, lat: 5 },
      { name: 'B', externalRef: 'r1', lon: 5, lat: 5 },
    ];

    expect(dedupeByIdentity(repeated)).toHaveLength(1);
    expect(dedupeByIdentity(repeated)[0].name).toBe('A');
  });

  it('measures across the antimeridian, where a raw subtraction reads 40 000 km', () => {
    // A metre apart on the ground, 359.99999° apart in arithmetic. Unnormalised, both
    // entries survive here, both answer `ST_DWithin` against one stored row, and the
    // object gains a second row for one place under one reference — the very thing this
    // function exists to stop. The haversine this measure replaced was safe for free
    // (`sin(dLon/2)` reads 360° − ε as ε); an equirectangular one has to be told
    // (CLAUDE.md § Antimeridian Handling).
    const acrossTheLine = [
      { name: 'east side', externalRef: 'r1', lon: 179.999995, lat: 0 },
      { name: 'west side', externalRef: 'r1', lon: -179.999995, lat: 0 },
    ];

    expect(dedupeByIdentity(acrossTheLine)).toHaveLength(1);
    // And a real separation across the line is still two places: 1° at the equator is
    // 111 km, so the tolerance must not swallow it just because the numbers straddle 180.
    expect(dedupeByIdentity([
      { name: 'east side', externalRef: 'r1', lon: 179.5, lat: 0 },
      { name: 'west side', externalRef: 'r1', lon: -179.5, lat: 0 },
    ])).toHaveLength(2);
  });

  it('does not treat a null reference as an empty one', () => {
    // `IS NOT DISTINCT FROM` calls these two different references, so a key
    // that flattened them would drop one of a pair the SQL keeps apart — and
    // the mark would then take the survivor's row, hiding a point the source
    // still offers.
    const nullAndEmpty = [
      { name: 'A', externalRef: null, lon: 5, lat: 5 },
      { name: 'B', externalRef: '', lon: 5, lat: 5 },
    ];

    expect(dedupeByIdentity(nullAndEmpty)).toHaveLength(2);
  });

  it('does not treat a null reference as matching a present one', () => {
    const mixed = [
      { name: 'A', externalRef: null, lon: 5, lat: 5 },
      { name: 'B', externalRef: 'r1', lon: 5, lat: 5 },
    ];

    expect(dedupeByIdentity(mixed)).toHaveLength(2);
  });
});
