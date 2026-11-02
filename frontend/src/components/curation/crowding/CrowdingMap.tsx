/**
 * The crowded-city window's map (ADR-0180, #2282): every row as a numbered
 * dot coloured by where it stands — in the list, shadowed, new, or not taken
 * once an answer is staged — the window's place ringed, and the kind's radius
 * drawn around it as a dashed circle.
 *
 * The camera frames the circle (`frameGeoJson`, which handles a circle over
 * the antimeridian), so the dots are read where the rule counts them. A dot
 * and its row light up together: the pointer on either sets the hovered
 * membership, and a click on a dot scrolls its row into view. A hover only
 * lights a dot, so the map stays still while the pointer reads down the list;
 * a click on a row whose dot is off the map brings it into view at the same
 * zoom (`showDot`). Zoom buttons stand in for the mouse wheel.
 *
 * One map per window, mounted with the dialog, so one WebGL context at a time.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Box, Typography } from '@mui/material';
import { Layer, Marker, NavigationControl, Source, type MapRef } from 'react-map-gl/maplibre';
import type { CrowdingWindow, CrowdingWindowRow } from '../../../api/crowding';
import { MAP_STYLE } from '../../../constants/mapStyles';
import { frameGeoJson } from '../../../utils/mapUtils';
import { GuardedMap } from '../../shared/GuardedMap';
import { drawnStanding, type DrawnStanding, type Staging } from './crowdingStaging';

/** The map's height beside the list. */
const MAP_HEIGHT = 420;

/** A dot's fill and edge by standing: a shadowed place is hollow, so it reads apart without its colour. */
const DOT: Record<DrawnStanding, { fill: string; edge: string; ink: string }> = {
  listed: { fill: 'primary.main', edge: 'primary.main', ink: 'common.white' },
  shadowed: { fill: 'background.paper', edge: 'grey.600', ink: 'text.primary' },
  new: { fill: 'warning.main', edge: 'warning.main', ink: 'common.white' },
  refused: { fill: 'error.main', edge: 'error.main', ink: 'common.white' },
};

/** The Earth's mean radius, in kilometres: the sphere the circle is drawn on. */
const EARTH_KM = 6371.0088;

/**
 * The circle of `radiusKm` around a point, as a polygon of `steps` points
 * along it on the sphere. Its longitudes run past ±180 where it crosses the
 * antimeridian, which is what `frameGeoJson` reads a crossing from.
 */
export function radiusCircle(latitude: number, longitude: number, radiusKm: number, steps = 96): GeoJSON.Feature<GeoJSON.Polygon> {
  const toRad = Math.PI / 180;
  const lat = latitude * toRad;
  const lon = longitude * toRad;
  const angle = radiusKm / EARTH_KM;
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i += 1) {
    const bearing = (2 * Math.PI * (i % steps)) / steps;
    const lat2 = Math.asin(Math.sin(lat) * Math.cos(angle) + Math.cos(lat) * Math.sin(angle) * Math.cos(bearing));
    const lon2 = lon + Math.atan2(
      Math.sin(bearing) * Math.sin(angle) * Math.cos(lat),
      Math.cos(angle) - Math.sin(lat) * Math.sin(lat2),
    );
    ring.push([lon2 / toRad, lat2 / toRad]);
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } };
}

/**
 * Brings a point into the map's view at the zoom it has: nothing moves when it
 * is in view already, so a curator reading down the list keeps the frame they
 * chose, and an off-screen dot is centred rather than zoomed out to.
 */
export function showDot(map: Pick<MapRef, 'getBounds' | 'easeTo'> | null, longitude: number, latitude: number): void {
  if (!map) return;
  if (map.getBounds().contains([longitude, latitude])) return;
  map.easeTo({ center: [longitude, latitude], duration: 400 });
}

function Dot({ row, number, standing, isCentre, hovered, onHover, onPick }: {
  row: CrowdingWindowRow;
  number: number;
  standing: DrawnStanding;
  isCentre: boolean;
  hovered: boolean;
  onHover: (membershipId: number | null) => void;
  onPick: (membershipId: number) => void;
}) {
  const look = DOT[standing];
  return (
    <Box
      component="button"
      type="button"
      title={row.name}
      aria-label={`${number}. ${row.name}`}
      onMouseEnter={() => onHover(row.membershipId)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(row.membershipId)}
      onBlur={() => onHover(null)}
      onClick={() => onPick(row.membershipId)}
      sx={{
        width: 22, height: 22, p: 0, borderRadius: '50%', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, fontWeight: 700, lineHeight: 1,
        bgcolor: look.fill, color: look.ink, border: 2, borderColor: look.edge,
        outline: isCentre ? 3 : 0, outlineStyle: 'solid', outlineColor: 'primary.dark',
        transform: hovered ? 'scale(1.45)' : undefined,
        boxShadow: hovered ? 4 : 1,
        transition: 'transform 120ms',
      }}
    >
      {number}
    </Box>
  );
}

export function CrowdingMap({ around, staging, hovered, shown, onHover, onPick }: {
  around: CrowdingWindow;
  staging: Staging;
  hovered: number | null;
  /** The row a click asked to show, with a count so the same row can be asked again. */
  shown: { id: number; n: number } | null;
  onHover: (membershipId: number | null) => void;
  onPick: (membershipId: number) => void;
}) {
  const map = useRef<MapRef>(null);
  const { centre, kind } = around;
  const ring = useMemo(
    () => radiusCircle(centre.latitude, centre.longitude, kind.radiusKm),
    [centre.longitude, centre.latitude, kind.radiusKm],
  );
  const frame = useCallback(() => frameGeoJson(map.current, ring, { padding: 16, duration: 0 }), [ring]);
  // A new place to stand on (a step through a group of arrivals) moves the camera with it.
  useEffect(() => { frame(); }, [frame]);
  // A row clicked in the list is on the map: a dot in view stays put, one off it is brought into view at the same zoom.
  useEffect(() => {
    const row = shown === null ? undefined : around.rows.find(r => r.membershipId === shown.id);
    if (row) showDot(map.current, row.longitude, row.latitude);
  }, [shown, around.rows]);

  /** The hovered dot over every other, the window's place over the rest. */
  const layerOf = (id: number) => {
    if (id === hovered) return 2;
    return id === centre.membershipId ? 1 : 0;
  };
  // The hovered dot last, so it is drawn over its neighbours rather than under them.
  const order = around.rows.map((row, index) => ({ row, number: index + 1 }));
  const drawn = [...order.filter(({ row }) => row.membershipId !== hovered), ...order.filter(({ row }) => row.membershipId === hovered)];

  return (
    <Box>
      <Box sx={{ height: MAP_HEIGHT, position: 'relative', borderRadius: 1, overflow: 'hidden', border: 1, borderColor: 'divider' }}>
        <GuardedMap
          ref={map}
          initialViewState={{ longitude: centre.longitude, latitude: centre.latitude, zoom: 10 }}
          mapStyle={MAP_STYLE}
          style={{ width: '100%', height: '100%' }}
          onLoad={frame}
          unavailableCompact
          unavailableDetail="The list beside it holds every place and its distance; the answers need no map."
        >
          <NavigationControl position="top-right" showCompass={false} />
          <Source id="crowding-radius" type="geojson" data={ring}>
            <Layer id="crowding-radius-line" type="line" paint={{ 'line-color': '#5f6b7a', 'line-width': 2, 'line-dasharray': [2, 2] }} />
          </Source>
          {drawn.map(({ row, number }) => (
            <Marker key={row.membershipId} latitude={row.latitude} longitude={row.longitude}
              style={{ zIndex: layerOf(row.membershipId) }}>
              <Dot
                row={row}
                number={number}
                standing={drawnStanding(row, staging)}
                isCentre={row.membershipId === centre.membershipId}
                hovered={row.membershipId === hovered}
                onHover={onHover}
                onPick={onPick}
              />
            </Marker>
          ))}
        </GuardedMap>
      </Box>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
        The dashed circle is {kind.radiusKm} km around {centre.name}: the rule counts each place’s better-known
        neighbours within {kind.radiusKm} km of that place.
      </Typography>
    </Box>
  );
}
