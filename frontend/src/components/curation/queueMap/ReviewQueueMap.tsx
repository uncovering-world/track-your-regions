/**
 * The review queue on a map (#2477): every open question the toolbar's chips select, one
 * marker per place, in the column the list takes otherwise. The card beside it is the
 * list's, opened the way a row opens it: by writing the question's key into the address's
 * `row`, which the page reads whether a row or a marker wrote it.
 *
 * - **What it reads.** `fetchReviewQueueMap` under the address's chips (`useQueueMapRead`,
 *   which the page shares to walk on after an answer), keyed under `reviewQueueAll`, so the
 *   refresh an answer makes takes the answered question off the map as it takes it off the list.
 * - **What it draws** (`queueMapLayers.ts`). Map mode's own layers: heat below
 *   `HEATMAP_MAX_ZOOM`, a pin per place above it in its first question's colour, a badge
 *   counting a place's questions where it has more than one, and the open question's
 *   place drawn as selected at every zoom.
 * - **A click.** A place with one question opens its card. A place with several opens a
 *   short list of them, each in the chip's word and colour, and picking one opens it.
 * - **The camera** is not in the address. A region chip frames the region by its stored
 *   frame (`smartFitBounds`); otherwise, or where the region has none, the map frames
 *   every point (`frameGeoJson`, which measures across the antimeridian). It frames again
 *   when the chips change, never after an answer, so the camera stays where the curator
 *   is working. After an answer the page opens the nearest open question (`nextOnMap`), and
 *   the map pans to its place, at the same zoom, only when the place is out of view.
 * - **Under it**, after an answer, where the next question is: this place's, or the nearest
 *   and how far. Then how many open questions the chips select, and that all are on the map
 *   or how many have no point, with the way to the list. Then the legend.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Box, Button, List, ListItemButton, ListItemText, Popover, Stack, Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import {
  Layer, NavigationControl, Source, type MapLayerMouseEvent, type MapRef,
} from 'react-map-gl/maplibre';
import type { QueueMapPlace } from '../../../api/reviewQueue';
import { fetchRegionAncestors } from '../../../api/regions';
import { queryKeys } from '../../../api/queryKeys';
import { MAP_STYLE, OSM_ATTRIBUTION_CONTROL } from '../../../constants/mapStyles';
import type { ReviewAddress } from '../../../utils/appUrl';
import { frameGeoJson, smartFitBounds } from '../../../utils/mapUtils';
import { pointInView } from '../../../utils/viewBounds';
import { plural } from '../../../utils/plural';
import { GuardedMap } from '../../shared/GuardedMap';
import {
  legendKinds, placeOfRow, queueMarkers, questionColor, questionCount, questionRow, questionWord, selectedMarker,
  spreadOf, stepLine, type MapStep,
} from './queueMapData';
import {
  QUESTION_PIN_LAYERS, SOURCE_QUESTIONS, SOURCE_SELECTED, questionBadgeBgLayer, questionBadgeTextLayer,
  questionHeatLayer, questionPinLayer, selectedPinLayer, selectedRingLayer,
} from './queueMapLayers';
import { useQueueMapRead } from './useQueueMapRead';

/** The closest the points are framed: a chip that leaves one place shows it among its streets. */
const SPREAD_MAX_ZOOM = 14;

/**
 * The places a click opened a list of, by id so a refresh lists what is still open about
 * them: one place of several questions, or places no closer view would separate.
 */
interface Picking { placeIds: number[]; top: number; left: number }

function Swatch({ color }: { color: string }) {
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-block', flexShrink: 0, width: 10, height: 10, borderRadius: '50%',
        bgcolor: color, border: 1.5, borderColor: 'common.white', boxShadow: '0 0 0 1px rgba(0,0,0,0.25)',
      }}
    />
  );
}

/** How many open questions the chips select, and whether every one of them is on the map. */
export function QueueMapLine({ count, unplaced, onShowList }: {
  count: number;
  unplaced: number;
  onShowList: () => void;
}) {
  if (unplaced === 0) {
    return <Typography variant="body2">{`${plural(count, 'open question')}, all on the map.`}</Typography>;
  }
  return (
    <Typography variant="body2">
      {`${plural(count, 'open question')}. ${unplaced} ${unplaced === 1 ? 'has' : 'have'} no point on the map.`}
      {' '}
      <Button size="small" onClick={onShowList} sx={{ textTransform: 'none', py: 0, verticalAlign: 'baseline' }}>
        See them in the list
      </Button>
    </Typography>
  );
}

export function ReviewQueueMap({
  address, placeName, onOpen, onShowList, step = null,
}: {
  address: ReviewAddress;
  /** A place's name where the list has loaded a row of it, for the short list's heading. */
  placeName: (placeId: number) => string | undefined;
  /** Opens a question's card, by the list's key of its row. */
  onOpen: (row: string) => void;
  onShowList: () => void;
  /** Where the map walked after the last answer, while the question it opened is open. */
  step?: MapStep | null;
}) {
  const { regionId } = address;
  const { read: { data, isError, isPlaceholderData }, chipsKey } = useQueueMapRead(address);

  // The region a chip names, by the frame the database stored for it: the last of its
  // ancestors is the region itself.
  const framedRegion = typeof regionId === 'number' ? regionId : null;
  const { data: ancestors, isError: regionFailed } = useQuery({
    queryKey: queryKeys.regions.ancestors(framedRegion),
    queryFn: () => fetchRegionAncestors(framedRegion!),
    enabled: framedRegion !== null,
  });
  const region = ancestors?.at(-1);
  const regionFocus = region?.id === framedRegion ? region : undefined;

  const places = useMemo(() => data?.places ?? [], [data]);
  const markers = useMemo(() => queueMarkers(places), [places]);
  const selectedPlace = placeOfRow(address.row);
  const selected = useMemo(() => selectedMarker(places, selectedPlace), [places, selectedPlace]);
  const placesById = useMemo(() => new Map(places.map(place => [place.placeId, place])), [places]);
  const legend = useMemo(() => legendKinds(places), [places]);

  const map = useRef<MapRef>(null);
  const [loaded, setLoaded] = useState(false);
  const framedFor = useRef<string | null>(null);
  // A failed first read unmounts the map: the one that replaces it loads and frames afresh.
  const unmounted = isError && !data;
  useEffect(() => {
    if (!unmounted) return;
    framedFor.current = null;
    setLoaded(false);
  }, [unmounted]);
  useEffect(() => {
    if (!loaded || !map.current || framedFor.current === chipsKey) return;
    if (framedRegion !== null) {
      // The region's own frame, once its read answers; its points where it has none.
      if (!ancestors && !regionFailed) return;
      if (regionFocus?.focusBbox) {
        smartFitBounds(map.current, regionFocus.focusBbox, {
          anchorPoint: regionFocus.anchorPoint, padding: 24, duration: 400,
        });
        framedFor.current = chipsKey;
        return;
      }
    }
    if (!data || isPlaceholderData) return;
    frameGeoJson(map.current, spreadOf(data.places), { padding: 40, duration: 400, maxZoom: SPREAD_MAX_ZOOM });
    framedFor.current = chipsKey;
  }, [loaded, chipsKey, framedRegion, ancestors, regionFailed, regionFocus, data, isPlaceholderData]);

  // A walk after an answer keeps the camera: the map pans to the next place, at the same zoom,
  // only when that place is out of view. Once per walk, so a re-render does not pull the map back.
  const walked = useRef<MapStep | null>(null);
  useEffect(() => {
    if (!loaded || !map.current || step === null || walked.current === step) return;
    walked.current = step;
    const bounds = map.current.getBounds();
    const view = {
      west: bounds.getWest(), south: bounds.getSouth(), east: bounds.getEast(), north: bounds.getNorth(),
    };
    if (!pointInView(step.lon, step.lat, view)) map.current.easeTo({ center: [step.lon, step.lat], duration: 400 });
  }, [loaded, step]);

  const [pointer, setPointer] = useState(false);
  const [picking, setPicking] = useState<Picking | null>(null);
  const onClick = (event: MapLayerMouseEvent) => {
    // The markers of the chips before a change stay drawn while the new read is on its way, and open nothing.
    if (isPlaceholderData) return;
    const hit = [...new Set((event.features ?? []).map(feature => feature.id))]
      .flatMap(id => (typeof id === 'number' ? [placesById.get(id)] : []))
      .filter((found): found is QueueMapPlace => found !== undefined);
    // Several places under one pin, the whole of Rome when Lazio is framed: the map
    // comes closer to them rather than opening whichever happens to be drawn on top.
    // Places a closer view would not separate are listed: those on one and the same point, and
    // any under one pin once the map is as close as it frames (a square and the fountain in it).
    const onePoint = hit.every(place => place.lon === hit[0]?.lon && place.lat === hit[0]?.lat);
    const asClose = (map.current?.getZoom() ?? 0) >= SPREAD_MAX_ZOOM;
    if (!onePoint && !asClose) {
      frameGeoJson(map.current, spreadOf(hit), { padding: 60, duration: 400, maxZoom: SPREAD_MAX_ZOOM });
      return;
    }
    const [place] = hit;
    if (!place) return;
    if (hit.length === 1 && place.questions.length === 1) {
      onOpen(questionRow(place, place.questions[0]));
      return;
    }
    setPicking({ placeIds: hit.map(found => found.placeId), top: event.originalEvent.clientY, left: event.originalEvent.clientX });
  };

  // A failed first read has nothing to draw; a failed refresh keeps the map and the points it holds.
  if (unmounted) {
    return (
      <Alert severity="error" action={<Button color="inherit" size="small" onClick={onShowList}>Show the list</Button>}>
        Could not read where the questions are. The list still holds every one of them.
      </Alert>
    );
  }

  // Read through the current answer, so a question answered meanwhile leaves the list.
  const pickedPlaces = picking
    ? picking.placeIds.flatMap(id => { const found = placesById.get(id); return found ? [found] : []; })
    : [];
  const pickedQuestions = picking
    ? pickedPlaces.flatMap(place => place.questions.map(question => ({ place, question })))
    : [];
  const pickedName = pickedPlaces.length === 1 ? placeName(pickedPlaces[0].placeId) : undefined;
  const pickedTitle = pickedPlaces.length > 1
    ? `${plural(pickedQuestions.length, 'question')} about ${plural(pickedPlaces.length, 'place')} here`
    : `${plural(pickedQuestions.length, 'question')} about ${pickedName ?? 'this place'}`;

  return (
    <Stack spacing={1}>
      <Box
        sx={{
          position: 'relative', borderRadius: 1, overflow: 'hidden', border: 1, borderColor: 'divider',
          height: { xs: 320, md: 'calc(100vh - 300px)' }, minHeight: { md: 360 },
        }}
      >
        <GuardedMap
          ref={map}
          initialViewState={{ longitude: 0, latitude: 20, zoom: 1 }}
          mapStyle={MAP_STYLE}
          attributionControl={OSM_ATTRIBUTION_CONTROL}
          style={{ width: '100%', height: '100%' }}
          onLoad={() => setLoaded(true)}
          interactiveLayerIds={QUESTION_PIN_LAYERS}
          onClick={onClick}
          onMouseEnter={() => setPointer(true)}
          onMouseLeave={() => setPointer(false)}
          cursor={pointer ? 'pointer' : undefined}
          unavailableCompact
          unavailableDetail="The list holds every question, and the card answers it without a map."
        >
          <NavigationControl position="top-right" showCompass={false} />
          {/* Nothing is mounted until there is something to draw: an empty heatmap costs what a
              full one does (`maplibre-patterns.md` § A layer in the style costs what the viewport costs). */}
          {markers.features.length > 0 && (
            <Source id={SOURCE_QUESTIONS} type="geojson" data={markers}>
              <Layer {...questionHeatLayer} />
              <Layer {...questionPinLayer} />
              <Layer {...questionBadgeBgLayer} />
              <Layer {...questionBadgeTextLayer} />
            </Source>
          )}
          {selected.features.length > 0 && (
            <Source id={SOURCE_SELECTED} type="geojson" data={selected}>
              <Layer {...selectedRingLayer} />
              <Layer {...selectedPinLayer} />
            </Source>
          )}
        </GuardedMap>
        {!data && (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ position: 'absolute', left: 12, bottom: 12, bgcolor: 'background.paper', px: 1, borderRadius: 1 }}
          >
            Reading where the questions are…
          </Typography>
        )}
      </Box>

      {isError && data && (
        <Alert severity="warning">The map could not refresh. It shows the questions as they were.</Alert>
      )}
      {step && (
        <Typography variant="body2" role="status">{stepLine(step)}</Typography>
      )}
      {data && (
        <QueueMapLine count={questionCount(data.places, data.unplaced)} unplaced={data.unplaced} onShowList={onShowList} />
      )}
      {legend.length > 0 && (
        <Stack direction="row" columnGap={2} rowGap={0.5} flexWrap="wrap" aria-label="What the colours mean">
          {legend.map(kind => (
            <Stack key={kind.key} direction="row" spacing={0.75} alignItems="center">
              <Swatch color={kind.color} />
              <Typography variant="caption">{kind.word}</Typography>
            </Stack>
          ))}
        </Stack>
      )}

      <Popover
        open={picking !== null && pickedQuestions.length > 0}
        onClose={() => setPicking(null)}
        anchorReference="anchorPosition"
        anchorPosition={picking ? { top: picking.top, left: picking.left } : undefined}
      >
        {picking && (
          <Box sx={{ py: 1, minWidth: 220 }}>
            <Typography variant="subtitle2" sx={{ px: 2 }}>
              {pickedTitle}
            </Typography>
            <List dense disablePadding>
              {pickedQuestions.map(({ place, question }) => {
                const row = questionRow(place, question);
                return (
                  <ListItemButton
                    key={row}
                    selected={row === address.row}
                    onClick={() => { setPicking(null); onOpen(row); }}
                    sx={{ gap: 1 }}
                  >
                    <Swatch color={questionColor(question)} />
                    <ListItemText
                      primary={questionWord(question)}
                      secondary={pickedPlaces.length > 1 ? placeName(place.placeId) : undefined}
                    />
                  </ListItemButton>
                );
              })}
            </List>
          </Box>
        )}
      </Popover>
    </Stack>
  );
}
