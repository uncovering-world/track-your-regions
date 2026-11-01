/**
 * The outlines of the places a point dialog pins (#2205).
 *
 * Where the catalogue holds a place's outline (OpenStreetMap's polygon,
 * ADR-0059), the place's own card draws it (`useExtentLayer`); a curator judging
 * on a review card whether a proposed point is inside a site needs it there too.
 * The near pair of Bisotun and its caravanserai asks exactly that: does the
 * caravanserai stand within the site.
 *
 * Each place is read the way the card reads it (`experienceDetailsQuery`, the
 * same cache entry), once the dialog opens, and only the places the card names:
 * a dialog is opened by a click, never on hover, so the read rule of
 * `experienceCardQueries.ts` holds. The outline is drawn with the card's own
 * paint, and its credit stands under the map with the extent, through
 * `ExtentLine`, the one component that draws it (ADR-0059 decision 3).
 */

import { Box, Typography } from '@mui/material';
import { useQueries } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { Layer, Source, type LayerProps } from 'react-map-gl/maplibre';
import { experienceDetailsQuery } from '../../api/experienceCardQueries';
import { experienceColor } from '../../utils/kindColors';
import { extentFillLayer, extentLineLayer } from '../experienceMarkers/layers';
import { ExtentLine } from './ExtentLine';
import { frameGeoJson, type MapLike } from '../../utils/mapUtils';

const SOURCE = 'point-dialog-extent';
/** The card's own paint (`layers.ts`), on this dialog's source. */
const OUTLINE_FILL = { ...extentFillLayer, id: `${SOURCE}-fill`, source: SOURCE } as LayerProps;
const OUTLINE_LINE = { ...extentLineLayer, id: `${SOURCE}-line`, source: SOURCE } as LayerProps;

export interface PlaceOutline {
  id: number;
  name: string;
  areaKm2: number | null | undefined;
  feature: GeoJSON.Feature;
}

/** The outlines the catalogue holds for these places, in their order; empty while they load. */
export function usePlaceOutlines(placeIds: readonly number[], enabled: boolean): PlaceOutline[] {
  const details = useQueries({
    queries: placeIds.map(id => ({ ...experienceDetailsQuery(id), enabled })),
    combine: results => results.map(result => result.data),
  });
  return useMemo(() => details.flatMap((detail) => {
    if (!detail?.boundary_geojson) return [];
    const feature: GeoJSON.Feature = {
      type: 'Feature',
      geometry: detail.boundary_geojson,
      properties: { color: experienceColor(detail.kind_id, detail.type) },
    };
    return [{ id: detail.id, name: detail.name, areaKm2: detail.area_km2, feature }];
  }), [details]);
}

/** The outlines, under the pins: drawn before the markers, which are DOM over the canvas anyway. */
export function OutlineLayers({ outlines }: { outlines: readonly PlaceOutline[] }) {
  const data = useMemo<GeoJSON.FeatureCollection>(
    () => ({ type: 'FeatureCollection', features: outlines.map(outline => outline.feature) }),
    [outlines],
  );
  if (outlines.length === 0) return null;
  return (
    <Source id={SOURCE} type="geojson" data={data}>
      <Layer {...OUTLINE_FILL} />
      <Layer {...OUTLINE_LINE} />
    </Source>
  );
}

/** Each drawn outline's extent and its credit, beside the map and visible without interaction. */
export function OutlineCredits({ outlines }: { outlines: readonly PlaceOutline[] }) {
  if (outlines.length === 0) return null;
  return (
    <Box sx={{ px: 2, pt: 1 }}>
      {outlines.map(outline => (
        <Box key={outline.id} sx={{ display: 'flex', gap: 0.5, alignItems: 'baseline' }}>
          {/* Whose outline, where the map draws more than one. */}
          {outlines.length > 1 && (
            <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>{`${outline.name}:`}</Typography>
          )}
          <ExtentLine areaKm2={outline.areaKm2} />
        </Box>
      ))}
    </Box>
  );
}

/**
 * Frames the pins and the outlines together once the outlines arrive, by the one
 * rule (`frameGeoJson`): an outline read after the map loaded would otherwise
 * stand half off the frame the pins alone were given.
 */
export function useFrameWithOutlines(
  map: MapLike | null,
  outlines: readonly PlaceOutline[],
  points: readonly { latitude: number; longitude: number }[],
  options: { padding: number | { top: number; bottom: number; left: number; right: number }; maxZoom: number },
): void {
  useEffect(() => {
    if (!map || outlines.length === 0) return;
    const framed: GeoJSON.GeometryCollection = {
      type: 'GeometryCollection',
      geometries: [
        { type: 'MultiPoint', coordinates: points.map(point => [point.longitude, point.latitude]) },
        ...outlines.map(outline => outline.feature.geometry),
      ],
    };
    frameGeoJson(map, framed, { ...options, duration: 0 });
    // Framed when the outlines arrive or the map loads; the pins and the options are the dialog's for its whole life.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reframing on every render of the pins would undo the reader's pan
  }, [map, outlines]);
}
