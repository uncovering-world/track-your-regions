/**
 * `experiences.category` is the venue type *within* a category, not one shared
 * enum: a UNESCO site writes `cultural`, an art museum writes `art`. Every value
 * our own importers write deliberately therefore needs an entry here, because
 * the surfaces that read it do not agree on what to do without one — the list
 * falls back to cultural purple, the two MapLibre layers fall back to teal, and
 * the same building ends up two colours depending on where you look at it.
 *
 * Public art is the exception on purpose: `landmarkSyncService` writes the
 * source's own free-form type, so those values fall through by design.
 */

import { describe, it, expect } from 'vitest';
import { CATEGORY_COLORS, getCategoryPrimaryColor } from './categoryColors';

/** The fallback in both `circle-color` match expressions. */
const MAP_FALLBACK = '#0d9488';

/** What our importers write: UNESCO's three, and the museum importer's one. */
const WRITTEN_TYPES = ['cultural', 'natural', 'mixed', 'art'];

describe('CATEGORY_COLORS', () => {
  it.each(WRITTEN_TYPES)('has an entry for %s, which an importer writes', (type) => {
    expect(CATEGORY_COLORS[type]).toBeDefined();
  });

  it('gives a museum a colour of its own rather than the cultural fallback', () => {
    // The bug this pins: with no `art` entry, `getCategoryPrimaryColor` returns
    // cultural purple while the map draws the teal fallback, so one museum is
    // purple in the list and teal on the map beside it.
    expect(getCategoryPrimaryColor('art')).not.toBe(CATEGORY_COLORS.cultural.primary);
  });

  it('keeps museums out of the colour public art falls through to', () => {
    // Landmarks write a free-form type and take the map fallback. A museum
    // taking the same one would make the two categories one colour on the map.
    expect(CATEGORY_COLORS.art.primary).not.toBe(MAP_FALLBACK);
  });

  it('gives every venue type a distinct colour', () => {
    const primaries = Object.values(CATEGORY_COLORS).map((c) => c.primary);
    expect(new Set(primaries).size).toBe(primaries.length);
  });

  it('still falls back for a type no importer declares', () => {
    // A landmark's free-form type has no entry and must not throw.
    expect(getCategoryPrimaryColor('sculpture')).toBe(CATEGORY_COLORS.cultural.primary);
    expect(getCategoryPrimaryColor(null)).toBe(CATEGORY_COLORS.cultural.primary);
  });
});
