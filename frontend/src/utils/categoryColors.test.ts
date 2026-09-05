/**
 * An object is drawn in one colour everywhere: the colour of its kind, refined
 * by its type only where a traveller tells the types apart (World Heritage).
 *
 * Keyed on the type value alone, the old map gave a museum its blue through
 * the literal `art` every museum row carried and let a monument — a type no
 * map knew — fall into the cultural purple in the list while its pin was the
 * map's teal fallback (#814). What is pinned here is that no object takes
 * another kind's colour, and that the colours readers see did not move.
 */

import { describe, it, expect } from 'vitest';
import { TYPE_COLORS, experienceColor, experienceColors, getSourceColor } from './categoryColors';

/** The source rows `db/init/01-schema.sql` seeds. */
const WORLD_HERITAGE = 1;
const ART_MUSEUMS = 2;
const PUBLIC_ART = 3;

describe('experienceColors', () => {
  it('refines a World Heritage site by its type, which is what the map tells apart', () => {
    expect(experienceColor(WORLD_HERITAGE, 'cultural')).toBe(TYPE_COLORS.cultural.primary);
    expect(experienceColor(WORLD_HERITAGE, 'natural')).toBe(TYPE_COLORS.natural.primary);
    expect(experienceColor(WORLD_HERITAGE, 'mixed')).toBe(TYPE_COLORS.mixed.primary);
  });

  it('gives a museum its kind\'s colour, with no type to hang it on', () => {
    // Every museum row used to carry the literal `art`; a museum has no type now.
    expect(experienceColor(ART_MUSEUMS, null)).toBe('#2563EB');
  });

  it('gives a monument and a sculpture one colour: they are one kind', () => {
    expect(experienceColor(PUBLIC_ART, 'monument')).toBe(experienceColor(PUBLIC_ART, 'sculpture'));
    // The teal the map always drew public art in — nothing readers see moved.
    expect(experienceColor(PUBLIC_ART, 'monument')).toBe('#0d9488');
  });

  it('never lends a kind another kind\'s colour', () => {
    // The bug: a monument coloured as a cultural World Heritage site in the list.
    expect(experienceColor(PUBLIC_ART, 'monument')).not.toBe(TYPE_COLORS.cultural.primary);
    expect(experienceColor(ART_MUSEUMS, null)).not.toBe(experienceColor(PUBLIC_ART, null));
    const primaries = [
      experienceColor(WORLD_HERITAGE, 'cultural'), experienceColor(WORLD_HERITAGE, 'natural'),
      experienceColor(WORLD_HERITAGE, 'mixed'), experienceColor(ART_MUSEUMS, null),
      experienceColor(PUBLIC_ART, null),
    ];
    expect(new Set(primaries).size).toBe(primaries.length);
  });

  it('lets a type value name its kind where no kind id came with it', () => {
    // The vocabularies are closed and disjoint (`experienceTypes.ts`): `natural` is
    // World Heritage's wherever it appears, so a row that reached a surface without
    // its kind id still draws in the colour readers know it by, not in grey.
    expect(experienceColor(undefined, 'natural')).toBe(TYPE_COLORS.natural.primary);
    expect(experienceColor(null, 'cultural')).toBe(TYPE_COLORS.cultural.primary);
  });

  it('gives a World Heritage site with no type its kind\'s purple, not the neutral', () => {
    // A count chip, or a row whose type is not stored: the kind reads as its
    // cultural sites do, never as "unknown".
    expect(experienceColor(WORLD_HERITAGE, null)).toBe(TYPE_COLORS.cultural.primary);
  });

  it('colours a kind\'s count chip in the colour its objects are drawn in', () => {
    // The palette used to answer this by id — amber for museums, blue for public
    // art — over cards and pins drawn blue and teal: two colours per kind, one
    // per function. One answer now.
    for (const kind of [WORLD_HERITAGE, ART_MUSEUMS, PUBLIC_ART]) {
      expect(getSourceColor(kind)).toBe(experienceColor(kind, null));
    }
    // A kind with no colour of its own still gets a deterministic one from the palette.
    expect(getSourceColor(99)).not.toBe(experienceColors(99, null).primary);
  });

  it('falls to a neutral colour for a kind it does not know, never to another kind\'s', () => {
    const unknown = experienceColors(99, null);
    for (const known of [TYPE_COLORS.cultural, TYPE_COLORS.natural, TYPE_COLORS.mixed,
      experienceColors(ART_MUSEUMS, null), experienceColors(PUBLIC_ART, null)]) {
      expect(unknown.primary).not.toBe(known.primary);
    }
    expect(experienceColors(undefined, null)).toEqual(unknown);
  });
});
