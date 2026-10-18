/**
 * The map on a serial site's component-items card (#1342): every place the
 * site is made of as a grey, named pin, and the component a curator is reading
 * with its candidate item beside it — two pins, the line between them and how
 * far apart they stand.
 *
 * The camera frames the pair alone, centred: the component's point and its
 * candidate, padded so both fit (`frameGeoJson`, the one camera call for a
 * shape a surface holds), or the point alone at street level where the
 * candidate has no position (#1691). The site's other places are drawn but
 * never framed: a far neighbour in the frame pushed the pair to the map's edge
 * (Prašuma Janj and its candidate 1.3 km off, on the Beech Forests), and a
 * curator who wants the neighbours zooms out to them.
 *
 * One map per card, on the card rather than behind a link — a curator wants the
 * distance at a look. The card mounts it only while it is near the screen
 * (`useNearViewport`): the queue renders a page of these cards, and a WebGL
 * context per card would pass the browser's cap and blank the earliest maps.
 */

import { useEffect, useMemo, useRef } from 'react';
import { Box, Typography } from '@mui/material';
import { Layer, Marker, Source, type MapRef } from 'react-map-gl/maplibre';
import type { ReviewQueueItem } from '../../api/reviewQueue';
import { MAP_STYLE } from '../../constants/mapStyles';
import { useNearViewport } from '../../hooks/useNearViewport';
import { frameGeoJson } from '../../utils/mapUtils';
import { moveView, shortWayLongitudeDelta } from '../../utils/moveDescription';
import { GuardedMap } from '../shared/GuardedMap';

export type SitePoint = NonNullable<ReviewQueueItem['site_points']>[number];

/** What the map is reading now: one component's point, and its candidate where the item's position is known. */
export interface MapFocus {
  point: { locationId: number; name: string; latitude: number; longitude: number };
  candidate: { label: string; latitude: number; longitude: number; distance: string } | null;
}

/** The candidate's pin: neither the component's colour nor the site's grey. */
const CANDIDATE_PIN = '#5D4037';
const SITE_PIN = '#9E9E9E';
const DISTANCE_LINE = '#5D4037';
const FRAME = { padding: 56, duration: 600 } as const;
/** How close the map stands on a point whose candidate has no position: a street, where its own pin is readable. */
export const POINT_ALONE_ZOOM = 14;
/** The map's height, which the card keeps its rows' controls clear of. */
export const MAP_HEIGHT = 300;

type Spot = { lat: number; lon: number };

/** The site's other places that have a coordinate. */
function othersOf(points: readonly SitePoint[], focus: MapFocus): Array<SitePoint & { latitude: number; longitude: number }> {
  return points.filter((p): p is SitePoint & { latitude: number; longitude: number } => (
    p.locationId !== focus.point.locationId && p.latitude != null && p.longitude != null
  ));
}

/** The pair the camera frames, or null where the candidate has no position and the point stands alone. */
export function framedShape(focus: MapFocus): GeoJSON.MultiPoint | null {
  const { point, candidate } = focus;
  if (!candidate) return null;
  return { type: 'MultiPoint', coordinates: [[point.longitude, point.latitude], [candidate.longitude, candidate.latitude]] };
}

/** Bring the camera to the focus: the pair framed, or the point alone centred at street level. */
function frameFocus(map: MapRef | null, focus: MapFocus, shape: GeoJSON.MultiPoint | null, duration: number): void {
  if (!map) return;
  if (shape) frameGeoJson(map, shape, { ...FRAME, duration });
  else map.easeTo({ center: [focus.point.longitude, focus.point.latitude], zoom: POINT_ALONE_ZOOM, duration });
}

/** The line from the point to its candidate, drawn the short way across the antimeridian. */
function distanceLine(from: Spot, to: Spot): GeoJSON.Feature<GeoJSON.LineString> {
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: [[from.lon, from.lat], [from.lon + shortWayLongitudeDelta(from, to), to.lat]] },
  };
}

/** A grey dot with the place's name — or its reference where the source names it none — beside it: present, named, and plainly not the question. */
function SitePin({ name }: { name: string | null }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, pointerEvents: 'none' }}>
      <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: SITE_PIN, border: '2px solid #fff', flexShrink: 0 }} />
      {name && (
        <Box component="span" sx={{ fontSize: 11, color: '#424242', textShadow: '0 0 3px #fff, 0 0 3px #fff', whiteSpace: 'nowrap' }}>
          {name}
        </Box>
      )}
    </Box>
  );
}

export function ComponentItemsMap({ sitePoints, focus }: { sitePoints: readonly SitePoint[]; focus: MapFocus }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MapRef>(null);
  const near = useNearViewport(box);
  const shape = useMemo(() => framedShape(focus), [focus]);
  useEffect(() => { frameFocus(map.current, focus, shape, FRAME.duration); }, [focus, shape]);

  const { point, candidate } = focus;
  const from = { lat: point.latitude, lon: point.longitude };
  const to = candidate ? { lat: candidate.latitude, lon: candidate.longitude } : null;
  const middle = to ? moveView(from, to) : null;

  return (
    <Box
      ref={box}
      sx={{ height: MAP_HEIGHT, position: 'relative', borderRadius: 1, overflow: 'hidden', border: 1, borderColor: 'divider' }}
    >
      {near && (
        <GuardedMap
          ref={map}
          initialViewState={middle ?? { latitude: point.latitude, longitude: point.longitude, zoom: POINT_ALONE_ZOOM }}
          onLoad={() => frameFocus(map.current, focus, shape, 0)}
          mapStyle={MAP_STYLE}
          style={{ width: '100%', height: '100%' }}
          unavailableCompact
          unavailableDetail="Each candidate's distance is written beside it; the rest of this card needs no map."
        >
          {othersOf(sitePoints, focus).map(other => (
            <Marker key={other.locationId} latitude={other.latitude} longitude={other.longitude} anchor="left" offset={[-5, 0]}>
              <SitePin name={other.name ?? other.ref} />
            </Marker>
          ))}
          {to && (
            <Source id="candidate-distance" type="geojson" data={distanceLine(from, to)}>
              <Layer id="candidate-distance-line" type="line"
                paint={{ 'line-color': DISTANCE_LINE, 'line-width': 2, 'line-dasharray': [2, 1.5] }} />
            </Source>
          )}
          <Marker latitude={point.latitude} longitude={point.longitude} />
          {candidate && <Marker latitude={candidate.latitude} longitude={candidate.longitude} color={CANDIDATE_PIN} />}
          {candidate && middle && (
            // Under the line rather than over it: a pin stands above its coordinate, and a label
            // above the middle would cover both pins whenever they are metres apart.
            <Marker latitude={middle.latitude} longitude={middle.longitude} anchor="top" offset={[0, 6]}>
              <Box sx={{ px: 0.75, borderRadius: 0.5, bgcolor: 'background.paper', boxShadow: 1, fontSize: 12, fontWeight: 600 }}>
                {candidate.distance}
              </Box>
            </Marker>
          )}
        </GuardedMap>
      )}
      {/* Which pin is which, on the map: a legend a curator has to look away to read is one they skip. */}
      <Box
        sx={{
          position: 'absolute', left: 8, bottom: 8, px: 1, py: 0.5, borderRadius: 1,
          bgcolor: 'background.paper', boxShadow: 1, fontSize: 12, lineHeight: 1.5, maxWidth: '70%',
        }}
      >
        <Box><Box component="span" sx={{ color: 'primary.main', fontWeight: 700 }}>●</Box> {point.name}</Box>
        {candidate
          ? <Box><Box component="span" sx={{ color: CANDIDATE_PIN, fontWeight: 700 }}>●</Box> {candidate.label}</Box>
          : <Typography variant="caption" color="text.secondary">The candidate’s position is not read yet</Typography>}
        <Box><Box component="span" sx={{ color: SITE_PIN, fontWeight: 700 }}>●</Box> the site’s other places</Box>
      </Box>
    </Box>
  );
}
