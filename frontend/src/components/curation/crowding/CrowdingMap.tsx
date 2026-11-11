/**
 * The crowded-city window's map (ADR-0180, #2282, #2358), in one of its two
 * views.
 *
 * - **The region's list**: every place of the group as a dot coloured by where
 *   it stands — on the region page, shadowed, new, or not taken once an answer
 *   is staged — framed on the group's places.
 * - **A place's circle**: the kind's radius around the place, drawn on the
 *   sphere as a dashed circle (`radiusCircle`) and framed (`frameGeoJson`,
 *   which handles a circle over the antimeridian); every place inside it in
 *   its group's look (`circleGroups`): the better known it is compared with
 *   marked, the less known faded, the ones not measured yet hollow, the place
 *   itself ringed.
 *
 * A dot and its row light up together: the pointer on either sets the hovered
 * membership. A hover over a dot says why the place stands where it does, or,
 * in a circle, how far it lies; a click opens the place's own circle. Zoom
 * buttons stand in for the mouse wheel. One map per window, so one WebGL
 * context at a time.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Box, Stack, Tooltip, Typography, type SxProps, type Theme } from '@mui/material';
import { Layer, Marker, NavigationControl, Source, type MapRef } from 'react-map-gl/maplibre';
import type { CrowdingGroupPlace, CrowdingPlaceView } from '../../../api/crowding';
import { MAP_STYLE, OSM_ATTRIBUTION_CONTROL } from '../../../constants/mapStyles';
import { frameGeoJson } from '../../../utils/mapUtils';
import { GuardedMap } from '../../shared/GuardedMap';
import { CIRCLE_GROUPS, circleGroups, groupOf, GROUP_WORDS, type CircleGroup } from './circleGroups';
import { drawnStanding, type DrawnStanding, type Staging } from './crowdingStaging';
import { distanceWords, whyWords, type RuleWords } from './rowWords';

/** A dot's look: fill, edge and size. A shadowed place is hollow, so it reads apart without its colour. */
interface Look { fill: string; edge: string; size: number; ring?: string }

const STANDING_LOOK: Record<DrawnStanding, Look> = {
  shown: { fill: 'primary.main', edge: 'primary.main', size: 12 },
  shadowed: { fill: 'background.paper', edge: 'grey.600', size: 12 },
  new: { fill: 'warning.main', edge: 'warning.main', size: 12 },
  refused: { fill: 'error.main', edge: 'error.main', size: 12 },
};

/**
 * In a place's circle, one look for each group its list names (`circleGroups`,
 * #2420), and the place itself. A place not measured yet is hollow, so it
 * reads apart from a less-known one without its colour.
 */
const GROUP_LOOK: Record<CircleGroup, Look> = {
  compared: { fill: 'primary.main', edge: 'common.white', size: 12, ring: 'primary.dark' },
  uncounted: { fill: 'background.paper', edge: 'primary.main', size: 10 },
  less: { fill: 'grey.500', edge: 'grey.500', size: 8 },
  measured: { fill: 'grey.500', edge: 'grey.500', size: 8 },
  unmeasured: { fill: 'background.paper', edge: 'grey.600', size: 8 },
};
const PLACE_LOOK: Look = { fill: 'common.white', edge: 'warning.main', size: 18 };

/** The Earth's mean radius, in kilometres: the sphere the circle is drawn on. */
const EARTH_KM = 6371.0088;

/** The closest a group's places are framed: a group of one place is shown among its streets. */
const GROUP_MAX_ZOOM = 14;

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

/** One dot to draw: where, how, and what a hover says of it. */
interface Drawn { id: number; name: string; latitude: number; longitude: number; look: Look; says: string; layer: number }

function Dot({ dot, hovered, onHover, onOpen }: {
  dot: Drawn;
  hovered: boolean;
  onHover: (membershipId: number | null) => void;
  onOpen: (membershipId: number) => void;
}) {
  const { look } = dot;
  return (
    <Tooltip title={dot.says} disableInteractive>
      <Box
        component="button"
        type="button"
        aria-label={dot.name}
        onMouseEnter={() => onHover(dot.id)}
        onMouseLeave={() => onHover(null)}
        onFocus={() => onHover(dot.id)}
        onBlur={() => onHover(null)}
        onClick={() => onOpen(dot.id)}
        sx={{
          width: look.size, height: look.size, p: 0, borderRadius: '50%', cursor: 'pointer', boxSizing: 'border-box',
          bgcolor: look.fill, border: look === PLACE_LOOK ? 4 : 2, borderColor: look.edge,
          outline: look.ring ? 2 : 0, outlineStyle: 'solid', outlineColor: look.ring ?? 'transparent',
          transform: hovered ? 'scale(1.6)' : undefined,
          boxShadow: hovered ? 4 : 1,
          transition: 'transform 120ms',
        }}
      />
    </Tooltip>
  );
}

/** What the map draws: a group's places, or a place's circle. */
export type CrowdingMapView =
  | { kind: 'region'; places: readonly CrowdingGroupPlace[]; rule: RuleWords; typeExempt: boolean }
  | { kind: 'place'; view: CrowdingPlaceView };

/** The dots of a view, the hovered one over the rest. */
function dotsOf(view: CrowdingMapView, staging: Staging): Drawn[] {
  if (view.kind === 'region') {
    return view.places.map(place => ({
      id: place.membershipId, name: place.name, latitude: place.latitude, longitude: place.longitude,
      look: STANDING_LOOK[drawnStanding(place, staging)], says: `${place.name}: ${whyWords(place, view.rule, view.typeExempt)}`,
      layer: 0,
    }));
  }
  const { place, around } = view.view;
  return [
    ...around.map(entry => {
      const group = groupOf(entry, view.view);
      return {
        id: entry.membershipId, name: entry.name, latitude: entry.latitude, longitude: entry.longitude,
        look: GROUP_LOOK[group],
        says: `${entry.name}, ${distanceWords(entry.distanceM)}: ${GROUP_WORDS[group]}`,
        layer: group === 'compared' ? 1 : 0,
      };
    }),
    {
      id: place.membershipId, name: place.name, latitude: place.latitude, longitude: place.longitude,
      look: PLACE_LOOK, says: place.name, layer: 2,
    },
  ];
}

function Swatch({ look, label }: { look: Look; label: string }) {
  return (
    <Stack direction="row" spacing={0.75} alignItems="center">
      <Box sx={{
        width: look.size, height: look.size, borderRadius: '50%', boxSizing: 'border-box',
        bgcolor: look.fill, border: 2, borderColor: look.edge,
        outline: look.ring ? 2 : 0, outlineStyle: 'solid', outlineColor: look.ring ?? 'transparent',
      }} />
      <Typography variant="caption">{label}</Typography>
    </Stack>
  );
}

/**
 * The map's legend, so the colours read the same on the map and in the list:
 * in a place's circle, the groups its list names, in the list's words.
 */
export function CrowdingLegend({ view }: { view: CrowdingMapView }) {
  const groups = view.kind === 'place' ? circleGroups(view.view) : null;
  return (
    <Stack direction="row" columnGap={2} rowGap={0.5} flexWrap="wrap">
      {!groups ? (
        <>
          <Swatch look={STANDING_LOOK.shown} label="on the region page" />
          <Swatch look={STANDING_LOOK.shadowed} label="shadowed" />
          <Swatch look={STANDING_LOOK.new} label="new, waiting for a curator" />
          <Swatch look={STANDING_LOOK.refused} label="not taken" />
        </>
      ) : (
        <>
          <Swatch look={PLACE_LOOK} label="the place" />
          {CIRCLE_GROUPS.filter(group => groups[group].length > 0).map(group => (
            <Swatch key={group} look={GROUP_LOOK[group]} label={GROUP_WORDS[group]} />
          ))}
        </>
      )}
    </Stack>
  );
}

export function CrowdingMap({ view, staging, hovered, frame: frameSx, onHover, onOpen }: {
  view: CrowdingMapView;
  /** The map's height, lower where the window holds it over the list on a laptop (`crowdingLayout`). */
  frame: SxProps<Theme>;
  staging: Staging;
  hovered: number | null;
  onHover: (membershipId: number | null) => void;
  onOpen: (membershipId: number) => void;
}) {
  const map = useRef<MapRef>(null);
  const place = view.kind === 'place' ? view.view.place : null;
  const radiusKm = view.kind === 'place' ? view.view.kind.radiusKm : null;
  const ring = useMemo(
    () => (place && radiusKm !== null ? radiusCircle(place.latitude, place.longitude, radiusKm) : null),
    [place, radiusKm],
  );
  const places = view.kind === 'region' ? view.places : null;
  const spread = useMemo<GeoJSON.Feature<GeoJSON.MultiPoint> | null>(() => (places && places.length > 0
    ? { type: 'Feature', properties: {}, geometry: { type: 'MultiPoint', coordinates: places.map(p => [p.longitude, p.latitude]) } }
    : null), [places]);
  // The region's places framed, or the place's circle: a view opened moves the camera with it.
  const frame = useCallback(() => {
    if (ring) frameGeoJson(map.current, ring, { padding: 16, duration: 400 });
    else if (spread) frameGeoJson(map.current, spread, { padding: 24, duration: 400, maxZoom: GROUP_MAX_ZOOM });
  }, [ring, spread]);
  useEffect(() => { frame(); }, [frame]);

  const dots = dotsOf(view, staging);
  // The hovered dot last, so it is drawn over its neighbours rather than under them.
  const drawn = [...dots.filter(dot => dot.id !== hovered), ...dots.filter(dot => dot.id === hovered)];
  const start = place ?? places?.[0];

  return (
    <Box sx={[{ position: 'relative', borderRadius: 1, overflow: 'hidden', border: 1, borderColor: 'divider' }, ...(Array.isArray(frameSx) ? frameSx : [frameSx])]}>
      <GuardedMap
        ref={map}
        initialViewState={{ longitude: start?.longitude ?? 0, latitude: start?.latitude ?? 0, zoom: start ? 10 : 1 }}
        mapStyle={MAP_STYLE}
        attributionControl={OSM_ATTRIBUTION_CONTROL}
        style={{ width: '100%', height: '100%' }}
        onLoad={frame}
        unavailableCompact
        unavailableDetail="The list beside it holds every place; the answers need no map."
      >
        <NavigationControl position="top-right" showCompass={false} />
        {ring && (
          <Source id="crowding-radius" type="geojson" data={ring}>
            <Layer id="crowding-radius-line" type="line" paint={{ 'line-color': '#e07b00', 'line-width': 2, 'line-dasharray': [2, 2] }} />
          </Source>
        )}
        {drawn.map(dot => (
          <Marker key={dot.id} latitude={dot.latitude} longitude={dot.longitude}
            style={{ zIndex: dot.id === hovered ? 3 : dot.layer }}>
            <Dot dot={dot} hovered={dot.id === hovered} onHover={onHover} onOpen={onOpen} />
          </Marker>
        ))}
      </GuardedMap>
    </Box>
  );
}
