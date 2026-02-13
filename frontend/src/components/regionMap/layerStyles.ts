/**
 * Layer style configurations for RegionMapVT.
 *
 * Paint/layout config objects as factory functions taking selectedId.
 *
 * Priority: selected > hovered > visited > default.
 * Selected must always be the most prominent region on the map,
 * even when siblings are hovered.
 */

import type { ExpressionSpecification, FillLayerSpecification, LineLayerSpecification } from 'maplibre-gl';

type FillPaint = FillLayerSpecification['paint'];
type LinePaint = LineLayerSpecification['paint'];

export interface ExploringParams {
  active: boolean;
  hasSubregions: boolean;
}

/**
 * Hull fill paint (for archipelagos using TS hull geometries)
 */
export function hullFillPaint(selectedId: number | undefined): FillPaint {
  return {
    'fill-color': [
      'case',
      ['==', ['id'], selectedId ?? -1],
      '#6366f1', // Indigo for selected
      ['boolean', ['feature-state', 'visited'], false],
      '#10b981', // Emerald for visited
      ['has', 'color'],
      ['coalesce', ['get', 'color'], '#6366f1'],
      '#6366f1',
    ],
    'fill-opacity': [
      'case',
      // Selected always wins — strongest fill
      ['==', ['id'], selectedId ?? -1],
      0.18,
      // Hover on non-selected — below selected
      ['boolean', ['feature-state', 'hovered'], false],
      0.12,
      ['boolean', ['feature-state', 'visited'], false],
      0.10,
      0.04,
    ],
  };
}

/**
 * Regular region fill paint
 */
export function regionFillPaint(selectedId: number | undefined): FillPaint {
  return {
    'fill-color': [
      'case',
      ['==', ['id'], selectedId ?? -1],
      '#6366f1', // Indigo for selected
      ['boolean', ['feature-state', 'visited'], false],
      '#10b981', // Emerald for visited
      ['has', 'color'],
      ['coalesce', ['get', 'color'], '#6366f1'],
      '#6366f1',
    ],
    'fill-opacity': [
      'case',
      // Selected always wins — strongest fill
      ['==', ['id'], selectedId ?? -1],
      0.22,
      // Hover on non-selected — noticeably below selected
      ['boolean', ['feature-state', 'hovered'], false],
      0.16,
      ['boolean', ['feature-state', 'visited'], false],
      0.20,
      0.08,
    ],
  };
}

/**
 * Shared outline paint logic for both region and hull outlines.
 * Selected region always dominates; hovered siblings are visible but subordinate.
 */
function outlinePaint(
  selectedId: number | undefined,
  exploring?: ExploringParams,
): LinePaint {
  if (exploring?.active) {
    const isSelected = ['==', ['id'], selectedId ?? -1] as ExpressionSpecification;
    if (exploring.hasSubregions) {
      // Non-leaf: children collectively form parent border — show all
      return {
        'line-color': '#475569',
        'line-width': 1.5,
        'line-opacity': 0.6,
      };
    }
    // Leaf: only the selected region outline is visible
    return {
      'line-color': '#475569',
      'line-width': ['case', isSelected, 2.5, 0] as ExpressionSpecification,
      'line-opacity': ['case', isSelected, 0.85, 0] as ExpressionSpecification,
    };
  }

  return {
    'line-color': [
      'case',
      // Selected checked first — always prominent
      ['==', ['id'], selectedId ?? -1],
      '#4f46e5', // Darker indigo for selected outline
      ['boolean', ['feature-state', 'hovered'], false],
      '#0ea5e9', // Sky blue for hover
      ['boolean', ['feature-state', 'visited'], false],
      '#059669', // Darker emerald for visited
      ['has', 'color'],
      ['coalesce', ['get', 'color'], '#6366f1'],
      '#6366f1',
    ],
    'line-width': [
      'case',
      // Selected gets thickest border
      ['==', ['id'], selectedId ?? -1],
      2,
      ['boolean', ['feature-state', 'hovered'], false],
      1.5,
      0.75,
    ],
    'line-opacity': [
      'case',
      ['==', ['id'], selectedId ?? -1],
      0.7,
      ['boolean', ['feature-state', 'hovered'], false],
      0.6,
      0.35,
    ],
  };
}

/**
 * Region outline paint — normal and exploration modes.
 * In exploration mode, shows a visible neutral border for geographic context.
 */
export function regionOutlinePaint(
  selectedId: number | undefined,
  exploring?: ExploringParams,
): LinePaint {
  return outlinePaint(selectedId, exploring);
}

/**
 * Hull outline paint (for archipelago hull boundaries).
 * Mirrors regionOutlinePaint logic for hull features.
 */
export function hullOutlinePaint(
  selectedId: number | undefined,
  exploring?: ExploringParams,
): LinePaint {
  return outlinePaint(selectedId, exploring);
}

/**
 * Sibling context fill paint (dimmed background behind children tiles)
 */
export function contextFillPaint(selectedId: number | undefined): FillPaint {
  return {
    'fill-color': [
      'case',
      ['==', ['id'], selectedId ?? -1],
      '#6366f1', // Indigo for the selected region
      ['has', 'color'],
      ['coalesce', ['get', 'color'], '#94a3b8'],
      '#94a3b8', // Slate for siblings
    ],
    'fill-opacity': [
      'case',
      // Selected: subtle "you are here" wash
      ['==', ['id'], selectedId ?? -1],
      0.10,
      // Hovered (non-selected): slightly stronger
      ['boolean', ['feature-state', 'hovered'], false],
      0.08,
      // Default siblings: barely visible
      0.03,
    ],
  };
}

/**
 * Sibling context outline paint (thin border behind children tiles)
 */
export function contextOutlinePaint(selectedId: number | undefined): LinePaint {
  return {
    'line-color': [
      'case',
      ['==', ['id'], selectedId ?? -1],
      '#6366f1', // Indigo for selected
      ['boolean', ['feature-state', 'hovered'], false],
      '#0ea5e9', // Sky blue for hovered
      '#94a3b8', // Slate for siblings
    ],
    'line-width': [
      'case',
      ['==', ['id'], selectedId ?? -1],
      1.5,
      ['boolean', ['feature-state', 'hovered'], false],
      1.5,
      0.5,
    ],
    'line-opacity': [
      'case',
      ['==', ['id'], selectedId ?? -1],
      0.5,
      ['boolean', ['feature-state', 'hovered'], false],
      0.5,
      0.2,
    ],
  };
}

/**
 * Island fill paint (archipelago detail boundaries)
 */
export const islandFillPaint: FillPaint = {
  'fill-color': [
    'case',
    ['has', 'color'],
    ['coalesce', ['get', 'color'], '#6366f1'],
    '#6366f1',
  ],
  'fill-opacity': 0.06,
};

/**
 * Island outline paint
 */
export const islandOutlinePaint: LinePaint = {
  'line-color': [
    'case',
    ['has', 'color'],
    ['coalesce', ['get', 'color'], '#6366f1'],
    '#6366f1',
  ],
  'line-width': 0.5,
  'line-opacity': 0.5,
};

/**
 * Root region border paint (hover-only overlay at root level)
 */
export const rootRegionBorderPaint: LinePaint = {
  'line-color': [
    'case',
    ['boolean', ['feature-state', 'hovered'], false],
    '#0ea5e9',  // Sky blue on hover
    'transparent',  // Invisible when not hovered
  ],
  'line-width': [
    'case',
    ['boolean', ['feature-state', 'hovered'], false],
    2.5,
    0,
  ],
  'line-opacity': [
    'case',
    ['boolean', ['feature-state', 'hovered'], false],
    1,
    0,
  ],
};
