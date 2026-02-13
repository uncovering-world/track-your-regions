/**
 * Shared category color definitions for experience display
 *
 * Used across ExperienceList, ExperienceCard, ExperienceDetailPanel, and Discover pages.
 */

// =============================================================================
// Experience Category Colors (cultural / natural / mixed)
// =============================================================================

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

export const CATEGORY_COLORS: Record<string, CategoryColorSet> = {
  cultural: CULTURAL,
  natural: NATURAL,
  mixed: MIXED,
};

/** Get the primary color for a category (fallback to cultural purple) */
export function getCategoryPrimaryColor(category: string | null | undefined): string {
  return CATEGORY_COLORS[category ?? '']?.primary ?? CULTURAL.primary;
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

/** Get a deterministic color for a category by its numeric ID */
export function getSourceColor(categoryId: number): string {
  return SOURCE_PALETTE[categoryId % SOURCE_PALETTE.length];
}

/** Shorten category display names for compact UI (chips, badges) */
export function shortSourceName(name: string): string {
  return name
    .replace('UNESCO World Heritage Sites', 'UNESCO')
    .replace('Top Museums', 'Museums')
    .replace('Public Art & Monuments', 'Art');
}
