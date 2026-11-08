/**
 * Shared map styles for MapLibre GL components. `MAP_STYLE` is the style of
 * every map that imports it — Map mode through react-map-gl, and Discover's
 * own `maplibregl.Map` — so a glyph URL or a basemap changed here reaches all
 * of them. A map that declares a style of its own is not reached.
 */

import type { RasterSourceSpecification, StyleSpecification } from 'maplibre-gl';

/**
 * The credit OpenStreetMap's tiles carry on every map that draws them (#2350):
 * the tile usage policy asks for it clearly on the map, and the attribution
 * guidelines ask for it visible without interaction and linked to the
 * copyright page. MapLibre's attribution control shows a source's
 * `attribution`, so a map that draws these tiles keeps that control on.
 */
export const OSM_ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors';

/** MapLibre's own credit, which its attribution control shows unless told otherwise. */
export const MAPLIBRE_ATTRIBUTION = '<a href="https://maplibre.org/" target="_blank">MapLibre</a>';

/**
 * The attribution control of every map that draws `OSM_RASTER_SOURCE` (#2364).
 * MapLibre adds a source's credit to the control only once the source has
 * loaded, so the corner widened under the reader on every map, a layout shift
 * of its own. Named here from the map's creation, the credit is in the corner
 * from the first frame; when the source loads, MapLibre drops its copy as a
 * duplicate, and the text does not change. MapLibre's credit is named beside
 * it, since a custom attribution replaces the default.
 */
export const OSM_ATTRIBUTION_CONTROL = { customAttribution: [MAPLIBRE_ATTRIBUTION, OSM_ATTRIBUTION] };

/** OpenStreetMap's standard tiles, with their credit: the one source every map that draws them uses. */
export const OSM_RASTER_SOURCE: RasterSourceSpecification = {
  type: 'raster',
  tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
  tileSize: 256,
  attribution: OSM_ATTRIBUTION,
};

export const MAP_STYLE = {
  version: 8 as const,
  glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
  sources: {
    osm: OSM_RASTER_SOURCE,
  },
  layers: [{ id: 'osm-tiles', type: 'raster' as const, source: 'osm' }],
} satisfies StyleSpecification;

/**
 * `MAP_STYLE` drawn muted, for a map whose own marks are the point: the point
 * dialog's pins and their labels (#2273). OpenStreetMap's standard tiles at
 * full colour wear crosses, cafés and hotel icons the size of a pin's label;
 * faded and greyed they stay readable as streets and squares, and the pins are
 * the strongest marks on the map.
 */
export const MUTED_MAP_STYLE = {
  ...MAP_STYLE,
  layers: [{
    id: 'osm-tiles', type: 'raster' as const, source: 'osm',
    paint: { 'raster-saturation': -0.7, 'raster-contrast': -0.15, 'raster-brightness-min': 0.12 },
  }],
} satisfies StyleSpecification;
