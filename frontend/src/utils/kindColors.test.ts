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
import {
  TYPE_COLORS, experienceColor, experienceColors, kindColor, kindColorExpression, shortKindName,
} from './kindColors';

/** The source rows `db/init/01-schema.sql` seeds. */
const WORLD_HERITAGE = 1;
const ART_MUSEUMS = 2;
const PUBLIC_ART = 3;
const PLACES_OF_WORSHIP = 4;
const ARCHAEOLOGY = 5;

describe('experienceColors', () => {
  it('refines a World Heritage site by its type, which is what the map tells apart', () => {
    expect(experienceColor(WORLD_HERITAGE, 'cultural')).toBe(TYPE_COLORS.cultural.primary);
    expect(experienceColor(WORLD_HERITAGE, 'natural')).toBe(TYPE_COLORS.natural.primary);
    expect(experienceColor(WORLD_HERITAGE, 'mixed')).toBe(TYPE_COLORS.mixed.primary);
  });

  it('gives an art museum its kind\'s colour, with no type to hang it on', () => {
    // Every museum row used to carry the literal `art`; an art museum has no
    // type now. Archaeology's `museum` *is* a type (ADR-0058) — of archaeology,
    // not of museums — and it hangs on the kind below, not here.
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
      experienceColor(PUBLIC_ART, null), experienceColor(PLACES_OF_WORSHIP, null),
      experienceColor(ARCHAEOLOGY, null),
    ];
    expect(new Set(primaries).size).toBe(primaries.length);
    // The tints too, not the line colours alone: `bg` and `text` are what the
    // type chip is drawn in (`discover/ExperienceCard.tsx`,
    // `ExperienceDetailPanel.tsx`, `ExperienceExpandedDetails.tsx`), so two
    // kinds sharing a background put an archaeology museum's "Museum" chip on
    // the tint a mixed World Heritage site's chip already sits on — the same
    // "which kind is this" confusion the primaries are kept apart to prevent.
    const backgrounds = [
      experienceColors(WORLD_HERITAGE, 'cultural').bg, experienceColors(WORLD_HERITAGE, 'natural').bg,
      experienceColors(WORLD_HERITAGE, 'mixed').bg, experienceColors(ART_MUSEUMS, null).bg,
      experienceColors(PUBLIC_ART, null).bg, experienceColors(PLACES_OF_WORSHIP, null).bg,
      experienceColors(ARCHAEOLOGY, null).bg,
    ];
    expect(new Set(backgrounds).size).toBe(backgrounds.length);
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
      expect(kindColor(kind)).toBe(experienceColor(kind, null));
    }
    // A kind with no colour of its own still gets a deterministic one from the palette.
    expect(kindColor(99)).not.toBe(experienceColors(99, null).primary);
  });

  it('falls to a neutral colour for a kind it does not know, never to another kind\'s', () => {
    const unknown = experienceColors(99, null);
    for (const known of [TYPE_COLORS.cultural, TYPE_COLORS.natural, TYPE_COLORS.mixed,
      experienceColors(ART_MUSEUMS, null), experienceColors(PUBLIC_ART, null)]) {
      expect(unknown.primary).not.toBe(known.primary);
    }
    expect(experienceColors(undefined, null)).toEqual(unknown);
  });

  it('gives a place of worship its own colour, whatever its type', () => {
    expect(experienceColor(PLACES_OF_WORSHIP, 'cathedral')).toBe('#BE185D');
    expect(experienceColor(PLACES_OF_WORSHIP, null)).toBe('#BE185D');
    expect(kindColor(PLACES_OF_WORSHIP)).toBe('#BE185D');
  });

  it('draws a dig and the museum that shows its finds in one colour', () => {
    // Archaeology has two types and one colour: a traveller browses the
    // excavation and the museum holding what came out of it as one list
    // (ADR-0058), so neither type refines the pin. The amber-brown sits beside
    // the art museums' blue — the kind a museum row is easiest to confuse with.
    expect(experienceColor(ARCHAEOLOGY, 'site')).toBe('#B45309');
    expect(experienceColor(ARCHAEOLOGY, 'museum')).toBe('#B45309');
    expect(experienceColor(ARCHAEOLOGY, null)).toBe('#B45309');
    expect(kindColor(ARCHAEOLOGY)).toBe('#B45309');
    // An archaeology museum is not an art museum, and the map must not say it is.
    expect(experienceColor(ARCHAEOLOGY, 'museum')).not.toBe(experienceColor(ART_MUSEUMS, null));
    // Nor the neutral a kind this file does not know falls to.
    expect(experienceColor(ARCHAEOLOGY, null)).not.toBe(experienceColors(99, null).primary);
  });
});

/**
 * Just enough of MapLibre's expression language to answer this one expression,
 * so the parity below is an evaluation rather than a comparison of shapes.
 *
 * Five forms, which is all `kindColorExpression` builds: `case`, `match`, `==`,
 * `coalesce` and `get`. Anything else throws rather than quietly answering, so
 * a form added to the expression fails here instead of being skipped.
 */
type Feature = Record<string, unknown>;

/** `case`: condition, value, …, fallback. */
function evaluateCase(args: unknown[], feature: Feature): unknown {
  for (let i = 0; i + 1 < args.length; i += 2) {
    if (evaluate(args[i], feature) === true) return evaluate(args[i + 1], feature);
  }
  return evaluate(args[args.length - 1], feature);
}

/** `match`: input, label, value, …, fallback. Labels are compared as written. */
function evaluateMatch(args: unknown[], feature: Feature): unknown {
  const input = evaluate(args[0], feature);
  for (let i = 1; i + 1 < args.length; i += 2) {
    if (args[i] === input) return evaluate(args[i + 1], feature);
  }
  return evaluate(args[args.length - 1], feature);
}

/** `coalesce`: the first operand that is neither null nor missing. */
function evaluateCoalesce(args: unknown[], feature: Feature): unknown {
  for (const arg of args) {
    const value = evaluate(arg, feature);
    if (value !== undefined && value !== null) return value;
  }
  return null;
}

function evaluate(expr: unknown, feature: Feature): unknown {
  if (!Array.isArray(expr)) return expr;
  const [op, ...args] = expr as [string, ...unknown[]];
  if (op === 'get') return feature[args[0] as string];
  if (op === '==') return evaluate(args[0], feature) === evaluate(args[1], feature);
  if (op === 'coalesce') return evaluateCoalesce(args, feature);
  if (op === 'case') return evaluateCase(args, feature);
  if (op === 'match') return evaluateMatch(args, feature);
  throw new Error(`the evaluator does not know "${op}"`);
}

describe('kindColorExpression', () => {
  /**
   * Every pair a tile feature can carry: the five seeded kinds, a kind this
   * file does not know, and a feature whose kind is missing altogether —
   * against the three World Heritage types, the type values other kinds
   * actually store, and no type at all.
   */
  const kinds = [WORLD_HERITAGE, ART_MUSEUMS, PUBLIC_ART, PLACES_OF_WORSHIP, ARCHAEOLOGY, 99, null];
  const types = ['cultural', 'natural', 'mixed', 'site', 'museum', 'monument', 'sculpture', null];
  const pairs = kinds.flatMap(kindId => types.map(type => ({ kindId, type })));

  it.each(pairs)('draws {kindId: $kindId, type: $type} as experienceColor does', ({ kindId, type }) => {
    // The world layer's features come out of a vector tile with the kind and
    // the type on them, and MapLibre picks the colour. That it picks the same
    // one the region markers are given is the whole promise of generating the
    // expression from the tables rather than writing a palette twice (#814).
    const feature: Record<string, unknown> = {};
    if (kindId !== null) feature.kindId = kindId;
    if (type !== null) feature.type = type;
    expect(evaluate(kindColorExpression(), feature)).toBe(experienceColor(kindId, type));
  });
});

describe('shortKindName', () => {
  it('shortens the kind name for a chip', () => {
    expect(shortKindName('Places of worship')).toBe('Worship');
    expect(shortKindName('World Heritage Sites')).toBe('World Heritage');
    expect(shortKindName('Art Museums')).toBe('Art Museums');
  });
});
