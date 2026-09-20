/**
 * What the subdivision map draws: the reference image where the dialog is in
 * overlay mode, the context layer of what already sits under the region, and
 * the divisions being grouped — each shape carrying its group's colour, lit up
 * where the pointer or a group chip is on it.
 *
 * Its own file beside `MapViewTab.tsx`, which had reached the length the lint
 * draws the line at (#933): the paint expressions are two thirds of what the
 * map's own markup was, and they are the part that answers to hover rather
 * than to the tab's controls.
 */

import { Source, Layer } from 'react-map-gl/maplibre';
import type { ImageOverlaySettings } from './ImageOverlayDialog';

export function SubdivisionMapLayers({
  imageOverlaySettings, imageDisplayMode, descendantGeometries,
  getDescendantDataWithColors, getMapDataWithColors,
  hoveredGroupIdx, hoveredUnassigned, hoveredDivisionId,
}: {
  imageOverlaySettings: ImageOverlaySettings | null;
  imageDisplayMode: 'overlay' | 'sideBySide';
  descendantGeometries: GeoJSON.FeatureCollection | null;
  getDescendantDataWithColors: () => GeoJSON.FeatureCollection;
  getMapDataWithColors: () => GeoJSON.FeatureCollection;
  hoveredGroupIdx: number | null;
  hoveredUnassigned: boolean;
  hoveredDivisionId: number | null;
}) {
  return (
    <>
              {/* Reference image overlay (only in overlay mode) */}
              {imageOverlaySettings && imageDisplayMode === 'overlay' && (
                <Source
                  id="image-overlay"
                  type="image"
                  url={imageOverlaySettings.imageUrl}
                  coordinates={imageOverlaySettings.coordinates}
                >
                  <Layer
                    id="image-overlay-layer"
                    type="raster"
                    paint={{
                      'raster-opacity': imageOverlaySettings.opacity,
                      'raster-fade-duration': 0,
                    }}
                  />
                </Source>
              )}

              {/* Descendant context layer (read-only, colored by group, highlighted on hover) */}
              {descendantGeometries && descendantGeometries.features.length > 0 && (
                <Source id="descendant-context" type="geojson" data={getDescendantDataWithColors()}>
                  <Layer
                    id="descendant-context-fill"
                    type="fill"
                    paint={{
                      'fill-color': ['get', 'groupColor'],
                      'fill-opacity': [
                        'case',
                        // Highlight when group chip is hovered
                        ['all',
                          ['==', hoveredGroupIdx ?? -999, ['get', 'groupIdx']],
                          ['!=', hoveredGroupIdx ?? -999, -999],
                        ],
                        0.35,
                        // Default: subtle
                        0.15,
                      ],
                    }}
                  />
                  <Layer
                    id="descendant-context-outline"
                    type="line"
                    paint={{
                      'line-color': [
                        'case',
                        ['all',
                          ['==', hoveredGroupIdx ?? -999, ['get', 'groupIdx']],
                          ['!=', hoveredGroupIdx ?? -999, -999],
                        ],
                        ['get', 'groupColor'],
                        '#9e9e9e',
                      ],
                      'line-width': [
                        'case',
                        ['all',
                          ['==', hoveredGroupIdx ?? -999, ['get', 'groupIdx']],
                          ['!=', hoveredGroupIdx ?? -999, -999],
                        ],
                        2,
                        1,
                      ],
                      'line-dasharray': [3, 2],
                      'line-opacity': [
                        'case',
                        ['all',
                          ['==', hoveredGroupIdx ?? -999, ['get', 'groupIdx']],
                          ['!=', hoveredGroupIdx ?? -999, -999],
                        ],
                        0.8,
                        0.5,
                      ],
                    }}
                  />
                </Source>
              )}

              <Source id="divisions" type="geojson" data={getMapDataWithColors()}>
                <Layer
                  id="divisions-fill"
                  type="fill"
                  paint={{
                    'fill-color': ['get', 'groupColor'],
                    'fill-opacity': [
                      'case',
                      // Highlight when directly hovered
                      ['==', ['get', 'id'], hoveredDivisionId ?? -1],
                      0.8,
                      // Highlight when group chip is hovered
                      ['all',
                        ['==', hoveredGroupIdx ?? -999, ['get', 'groupIdx']],
                        ['!=', hoveredGroupIdx ?? -999, -999]
                      ],
                      0.75,
                      // Highlight unassigned when unassigned chip is hovered (groupIdx === -1)
                      ['all',
                        ['==', hoveredUnassigned, true],
                        ['==', ['get', 'groupIdx'], -1]
                      ],
                      0.75,
                      // Default opacity
                      0.4,
                    ],
                  }}
                />
                <Layer
                  id="divisions-outline"
                  type="line"
                  paint={{
                    'line-color': [
                      'case',
                      // Thicker outline when group is hovered
                      ['all',
                        ['==', hoveredGroupIdx ?? -999, ['get', 'groupIdx']],
                        ['!=', hoveredGroupIdx ?? -999, -999]
                      ],
                      '#000000',
                      // Thicker outline when unassigned is hovered (groupIdx === -1)
                      ['all',
                        ['==', hoveredUnassigned, true],
                        ['==', ['get', 'groupIdx'], -1]
                      ],
                      '#000000',
                      '#333333',
                    ],
                    'line-width': [
                      'case',
                      ['==', ['get', 'id'], hoveredDivisionId ?? -1],
                      4,
                      // Thicker when group is hovered
                      ['all',
                        ['==', hoveredGroupIdx ?? -999, ['get', 'groupIdx']],
                        ['!=', hoveredGroupIdx ?? -999, -999]
                      ],
                      3,
                      // Thicker when unassigned is hovered (groupIdx === -1)
                      ['all',
                        ['==', hoveredUnassigned, true],
                        ['==', ['get', 'groupIdx'], -1]
                      ],
                      3,
                      2,
                    ],
                    'line-opacity': 0.8,
                  }}
                />
              </Source>
    </>
  );
}
