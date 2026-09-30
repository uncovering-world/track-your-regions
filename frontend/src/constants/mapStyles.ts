/**
 * Shared map styles for MapLibre GL components. `MAP_STYLE` is the style of
 * every map that imports it — Map mode through react-map-gl, and Discover's
 * own `maplibregl.Map` — so a glyph URL or a basemap changed here reaches all
 * of them. A map that declares a style of its own is not reached.
 */

import type { StyleSpecification } from 'maplibre-gl';

export const MAP_STYLE = {
  version: 8 as const,
  glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
  sources: {
    osm: {
      type: 'raster' as const,
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
    },
  },
  layers: [{ id: 'osm-tiles', type: 'raster' as const, source: 'osm' }],
} satisfies StyleSpecification;
