/**
 * Layer style configurations for RegionMapVT.
 *
 * Paint/layout config objects as factory functions taking selectedId.
 */

import type { FillLayerSpecification, LineLayerSpecification } from 'maplibre-gl';

type FillPaint = FillLayerSpecification['paint'];
type LinePaint = LineLayerSpecification['paint'];

/**
 * Hull fill paint (for archipelagos using TS hull geometries)
 */
export function hullFillPaint(selectedId: number | undefined): FillPaint {
  return {
    'fill-color': [
      'case',
      ['==', ['get', 'id'], selectedId ?? -1],
      '#6366f1', // Indigo for selected
      ['boolean', ['feature-state', 'visited'], false],
      '#10b981', // Emerald for visited
      ['has', 'color'],
      ['coalesce', ['get', 'color'], '#6366f1'],
      '#6366f1',
    ],
    'fill-opacity': [
      'case',
      ['==', ['get', 'id'], selectedId ?? -1],
      0.2,
      ['boolean', ['feature-state', 'hovered'], false],
      0.25,
      ['boolean', ['feature-state', 'visited'], false],
      0.15,
      0.08, // More transparent at rest
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
      ['==', ['get', 'id'], selectedId ?? -1],
      '#6366f1', // Indigo for selected
      ['boolean', ['feature-state', 'visited'], false],
      '#10b981', // Emerald for visited
      ['has', 'color'],
      ['coalesce', ['get', 'color'], '#6366f1'],
      '#6366f1',
    ],
    'fill-opacity': [
      'case',
      ['boolean', ['feature-state', 'hovered'], false],
      0.45,
      ['boolean', ['feature-state', 'visited'], false],
      0.35,
      0.2, // More transparent at rest
    ],
  };
}

/**
 * Region outline paint
 */
export function regionOutlinePaint(selectedId: number | undefined): LinePaint {
  return {
    'line-color': [
      'case',
      ['==', ['get', 'id'], selectedId ?? -1],
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
      ['boolean', ['feature-state', 'hovered'], false],
      2.5,
      ['==', ['get', 'id'], selectedId ?? -1],
      2,
      1, // Thinner borders
    ],
    'line-opacity': [
      'case',
      ['boolean', ['feature-state', 'hovered'], false],
      1,
      0.6,
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
