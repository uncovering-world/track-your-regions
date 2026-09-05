/**
 * The colour an object is drawn in — its pin, its row, its card's edge, its
 * type chip — decided once (#814).
 *
 * A colour says which *kind* of place this is: a World Heritage site, an art
 * museum, a monument (ADR-0045). World Heritage is the one kind whose types a
 * traveller tells apart on the map — a natural site is green where a cultural
 * one is purple — so there the type refines the colour; every other kind is one
 * colour. Keyed on the type value alone, as this file was, a museum's blue hung
 * on the literal `art` every museum row carried, and a monument — whose types
 * no map knew — fell into the cultural purple in the list while its pin was the
 * map's teal fallback: the same object two colours depending on where you
 * looked at it.
 *
 * Used across ExperienceList, ExperienceCard, ExperienceDetailPanel, the two
 * marker layers and the Discover pages.
 */

export interface CategoryColorSet {
  /** Primary/border color */
  primary: string;
  /** Light background */
  bg: string;
  /** Text color (darker shade) */
  text: string;
}

const CULTURAL: CategoryColorSet = { primary: '#8B5CF6', bg: '#EDE9FE', text: '#7C3AED' };
const NATURAL: CategoryColorSet = { primary: '#10B981', bg: '#D1FAE5', text: '#059669' };
const MIXED: CategoryColorSet = { primary: '#F59E0B', bg: '#FEF3C7', text: '#D97706' };
/** Art museums: blue from `SOURCE_PALETTE`, so a museum and a monument are never one colour. */
const ART_MUSEUMS: CategoryColorSet = { primary: '#2563EB', bg: '#DBEAFE', text: '#1D4ED8' };
/** Public art: the teal the map's fallback always drew it in, now a colour of its own. */
const PUBLIC_ART: CategoryColorSet = { primary: '#0d9488', bg: '#CCFBF1', text: '#0F766E' };
/** A kind with no palette of its own, and a World Heritage row with no type. */
const UNKNOWN: CategoryColorSet = { primary: '#6366F1', bg: '#E0E7FF', text: '#4F46E5' };

/**
 * The types a traveller tells apart by colour: World Heritage's three. No other
 * kind's types are coloured — a monument and a sculpture are one kind and one
 * pin — and a museum has no type at all.
 */
export const TYPE_COLORS: Record<string, CategoryColorSet> = {
  cultural: CULTURAL,
  natural: NATURAL,
  mixed: MIXED,
};

/**
 * The kinds with a colour of their own, by the id their source row is seeded
 * with in `db/init/01-schema.sql` (1 UNESCO World Heritage Sites, 2 Top Art
 * Museums, 3 Public Art & Monuments). Until the kind table of ADR-0045 §4
 * lands, a kind is its source row, and the id is what a list row carries
 * (`category_id`) — a name is renamed (#815). World Heritage's is the purple
 * of its cultural sites, which is what the kind reads as where no type
 * refines it — a count chip, a row whose type is not stored.
 */
const KIND_COLORS: Record<number, CategoryColorSet> = {
  1: CULTURAL,
  2: ART_MUSEUMS,
  3: PUBLIC_ART,
};

/**
 * The colour set an object is drawn in: its type's where the kind's types are
 * told apart (World Heritage's three — the vocabularies are closed and
 * disjoint, so a type value names its kind), its kind's otherwise, and a
 * neutral indigo for a kind this file does not know — never another kind's
 * colour.
 */
export function experienceColors(
  categoryId: number | null | undefined,
  type: string | null | undefined,
): CategoryColorSet {
  if (type && TYPE_COLORS[type]) return TYPE_COLORS[type];
  if (categoryId != null && KIND_COLORS[categoryId]) return KIND_COLORS[categoryId];
  return UNKNOWN;
}

/** The one colour of `experienceColors` — what a pin, a row stripe or a card edge takes. */
export function experienceColor(
  categoryId: number | null | undefined,
  type: string | null | undefined,
): string {
  return experienceColors(categoryId, type).primary;
}

// =============================================================================
// Visited / Checked Status Colors
// =============================================================================

/** Green used for visited checkboxes and check-circle icons */
export const VISITED_GREEN = '#22c55e';

/** Amber used for partially visited (indeterminate) checkboxes */
export const PARTIAL_AMBER = '#F59E0B';

// =============================================================================
// Source/Category Palette (for dynamic category ID coloring)
// =============================================================================

/** Deterministic palette for auto-coloring source categories by ID */
export const SOURCE_PALETTE = [
  '#0d9488', // teal
  '#7C3AED', // purple
  '#D97706', // amber
  '#2563EB', // blue
  '#DC2626', // red
  '#059669', // emerald
  '#9333EA', // violet
  '#CA8A04', // yellow
  '#0891B2', // cyan
  '#BE185D', // pink
  '#4F46E5', // indigo
  '#EA580C', // orange
];

/**
 * A kind's colour for a surface that shows the kind and not one object — the
 * count chips of Discover — which is the same colour its objects are drawn in:
 * `experienceColors` with no type, so "Art Museums 12" is the blue of the
 * museum cards under it and "Art 40" the teal of the monument pins, rather
 * than the palette's amber and blue over them. The palette answers only for a
 * kind this file gives no colour of its own.
 */
export function getSourceColor(categoryId: number): string {
  const own = experienceColors(categoryId, null);
  return own === UNKNOWN ? SOURCE_PALETTE[categoryId % SOURCE_PALETTE.length] : own.primary;
}

/**
 * Shorten category display names for compact UI (chips, badges).
 *
 * "Art Museums" rather than "Museums": archaeology, natural-history and
 * military museums are a separate category, so the short form has to keep the
 * word that tells them apart or two chips will read the same.
 */
export function shortSourceName(name: string): string {
  return name
    .replace('UNESCO World Heritage Sites', 'UNESCO')
    .replace('Top Art Museums', 'Art Museums')
    .replace('Public Art & Monuments', 'Art');
}
