/**
 * Where a place actually is, for a curator judging a claim about it — and, where
 * the place is theirs to correct, the pin already in their hands.
 *
 * A coordinate printed as text answers almost nothing: "14.1303, 38.7186" does not tell
 * anyone whether a description's "close to Ethiopia's northern border" is true. A map
 * does, in one look.
 *
 * A dialog rather than a map on every card, and the reason is a hard limit rather than
 * taste: each MapLibre instance holds its own WebGL context, browsers keep about a dozen
 * per tab, and the review page renders up to 25 cards *per kind*, across every kind the
 * queue returns. Stated as a rule and not a number because the number keeps growing, and
 * the newest kind grows it fastest: an answered withdrawal is one card holding up to 25
 * points, each with a dialog of its own, where a withdrawal card holds one per lost part.
 * Mounting one map per card would evict the earlier contexts and blank the maps — the
 * failure looks like a rendering bug and is really a resource cap. The conclusion is
 * unmoved by any of that arithmetic: MUI's `Dialog` mounts no children while closed and
 * only one can be open, so the count is one by construction, and nothing loads until it
 * is asked for.
 *
 * One mode, not two. Where a caller hands in a `correction`, the dialog opens on
 * `PointCorrection` — the map already on the place, the pin already draggable, Save
 * asleep until something changed — rather than on a look with a button to press before
 * editing. The count stays at one: the picker's map *is* the map then, and the read-only
 * one is drawn only where nothing may be corrected. Which is still most callers: a reader
 * looking at a place, and `ObjectContext`, which shows the source's locator rather than
 * a place.
 *
 * **A move is drawn as a move.** Where a caller hands in `movedTo` — a run proposing a
 * different coordinate, a card whose question is whether the new point is the better one
 * — the read-only map draws both: the place readers see as a grey pin, the proposed one
 * as the pin, and an arrow from the first to the second, at the zoom the move itself asks
 * for (`moveView`). Two pairs of numbers and "158 m north-west" say that something moved;
 * whether it moved onto the ruins or off them is read from the ground under the arrow.
 *
 * **A neighbour is drawn as a neighbour.** Where a caller hands in `beside` — a candidate
 * Wikidata item standing near a component (#1272), whose question is whether the two are
 * one place — the map draws both pins at the zoom that holds them and the title says how
 * far apart they stand, with no arrow and no talk of a move: confirming the item leaves
 * the point where it is.
 *
 * In `shared/` because the same look is asked for from three places — the review
 * page's cards, the object's own screen and the places list on a map — and the rule
 * for where a place may be corrected is the same on all of them: wherever a curator is
 * looking at one.
 */

import { Box, Dialog, DialogContent, DialogTitle, IconButton, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { Layer, Marker, Source } from 'react-map-gl/maplibre';
import { GuardedMap } from './GuardedMap';
import { MAP_STYLE } from '../../constants/mapStyles';
import { PointCorrection, type PlaceToCorrect } from './PointCorrection';
import { moveLabel, moveView, movedBy, shortWayLongitudeDelta } from '../../utils/moveDescription';

/** The pin readers see today, where the map also draws the one proposed: present, and plainly not the news. */
const STORED_PIN = '#757575';
const MOVE_LINE = '#C62828';
/** A neighbour drawn beside the place: another pin, in a colour that is neither readers' nor the news. */
const BESIDE_PIN = '#5D4037';

/**
 * The line a move is drawn along, and the arrowhead on it.
 *
 * The head is a marker rather than a symbol layer: a symbol needs an image in the
 * basemap's sprite, and the styles this map draws with are not ours to add one to. It
 * sits at the middle of the line, turned to the bearing and pinned to the map's own
 * rotation, so it keeps pointing along the line however the map is turned.
 */
function MoveArrow({ from, to }: {
  from: { latitude: number; longitude: number };
  to: { latitude: number; longitude: number };
}) {
  const before = { lon: from.longitude, lat: from.latitude };
  const after = { lon: to.longitude, lat: to.latitude };
  const middle = moveView(before, after);
  const bearing = movedBy(before, after)?.degrees ?? 0;
  const line: GeoJSON.Feature<GeoJSON.LineString> = {
    type: 'Feature',
    properties: {},
    // The end is written relative to the start, so a move across the
    // antimeridian is drawn across it — past 180 — rather than the long way
    // round through Greenwich, away from both pins.
    geometry: {
      type: 'LineString',
      coordinates: [
        [from.longitude, from.latitude],
        [from.longitude + shortWayLongitudeDelta(before, after), to.latitude],
      ],
    },
  };
  return (
    <>
      <Source id="proposed-move" type="geojson" data={line}>
        <Layer id="proposed-move-line" type="line" paint={{ 'line-color': MOVE_LINE, 'line-width': 2.5 }} />
      </Source>
      <Marker
        latitude={middle.latitude}
        longitude={middle.longitude}
        rotation={bearing}
        rotationAlignment="map"
        anchor="center"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" style={{ display: 'block' }}>
          <path d="M9 2 L15 14 L9 11 L3 14 Z" fill={MOVE_LINE} stroke="#fff" strokeWidth="1" />
        </svg>
      </Marker>
    </>
  );
}

type Coordinate = { lon: number; lat: number };
type Companion = { move: string | null; apart: string | null; other: Coordinate | null };

/**
 * What the map draws beside the place, if anything: the proposed move as the
 * title says it, or the neighbour, each only where it stands a metre or more
 * off — two points closer than that are one pin. Nothing under a correction,
 * which has its own form.
 */
function companion(
  stored: Coordinate,
  movedTo: { latitude: number; longitude: number } | undefined,
  beside: { latitude: number; longitude: number } | undefined,
  correcting: boolean,
): Companion {
  const none: Companion = { move: null, apart: null, other: null };
  if (correcting) return none;
  const apartFrom = (place: { latitude: number; longitude: number } | undefined): [Coordinate, string] | null => {
    if (!place) return null;
    const at = { lon: place.longitude, lat: place.latitude };
    const label = (movedBy(stored, at)?.meters ?? 0) >= 1 ? moveLabel(stored, at) : null;
    return label ? [at, label] : null;
  };
  const proposed = apartFrom(movedTo);
  if (proposed) return { move: proposed[1], apart: null, other: proposed[0] };
  const neighbour = apartFrom(beside);
  return neighbour ? { move: null, apart: neighbour[1], other: neighbour[0] } : none;
}

export function PointPreviewDialog({ open, onClose, name, latitude, longitude, movedTo, beside, correction }: {
  open: boolean;
  onClose: () => void;
  name: string;
  latitude: number;
  longitude: number;
  /**
   * Where a run proposes the place is instead. With it the map shows the move: both
   * pins and the arrow between them. Read by the look alone — a correction opens on
   * its own form, whose picker already draws the source's position.
   */
  movedTo?: { latitude: number; longitude: number };
  /**
   * A place standing beside this one, which is not a move (#1272): a candidate item
   * near a component. With it the map draws both pins and the title says how far
   * apart they stand. Read by the look alone, like `movedTo`.
   */
  beside?: { latitude: number; longitude: number; label: string };
  /**
   * Offered where a curator may correct the place: what to correct, and where the
   * outcome line goes. Absent, the dialog is the look it always was.
   */
  correction?: { place: PlaceToCorrect; onDone: (message: string) => void };
}) {
  const stored = { lon: longitude, lat: latitude };
  const { move, apart, other } = companion(stored, movedTo, beside, Boolean(correction));
  const view = other ? moveView(stored, other) : { latitude, longitude, zoom: 11 };
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ pr: 6 }}>
        {name}
        <Typography variant="body2" color="text.secondary">
          {latitude.toFixed(4)}, {longitude.toFixed(4)}
          {move && ` → ${movedTo?.latitude.toFixed(4)}, ${movedTo?.longitude.toFixed(4)} · a proposed move of ${move}`}
          {apart && ` · ${beside?.label} stands ${apart}`}
          {/* Whose place this is — unless the place is named for the object already,
              as a museum's one place is, where the line would say the name twice. */}
          {correction && correction.place.objectName !== name ? ` · ${correction.place.objectName}` : ''}
        </Typography>
        <IconButton onClick={onClose} sx={{ position: 'absolute', right: 8, top: 8 }} aria-label="close">
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      {correction ? (
        <DialogContent>
          {/* Keyed on the place, since the card that owns this dialog is mounted
              unkeyed and a form holding one place's draft must not carry it onto
              the next. Cancel is the dialog's close: there is no look to go back to. */}
          <PointCorrection
            key={correction.place.locationId}
            place={correction.place}
            onDone={(message) => {
              correction.onDone(message);
              onClose();
            }}
            onCancel={onClose}
          />
        </DialogContent>
      ) : (
        <DialogContent sx={{ height: 420, p: 0, position: 'relative' }}>
          {/* Mounted only while the dialog is open — MUI unmounts the content by default,
              which is what keeps the WebGL context to the moment it is wanted. Zoom 11
              shows the surroundings a description talks about rather than the roof of the
              building, which is what a curator is checking. */}
          {open && (
            <GuardedMap
              initialViewState={view}
              mapStyle={MAP_STYLE}
              style={{ width: '100%', height: '100%' }}
              unavailableCompact
              unavailableDetail="The coordinate is above; the rest of this card needs no map."
            >
              {movedTo && move ? (
                <>
                  <MoveArrow from={{ latitude, longitude }} to={movedTo} />
                  <Marker latitude={latitude} longitude={longitude} color={STORED_PIN} />
                  <Marker latitude={movedTo.latitude} longitude={movedTo.longitude} />
                </>
              ) : (
                <Marker latitude={latitude} longitude={longitude} />
              )}
              {beside && apart && <Marker latitude={beside.latitude} longitude={beside.longitude} color={BESIDE_PIN} />}
            </GuardedMap>
          )}
          {apart && beside && (
            <Box
              sx={{
                position: 'absolute', left: 12, bottom: 12, px: 1, py: 0.5, borderRadius: 1,
                bgcolor: 'background.paper', boxShadow: 1, fontSize: 12, lineHeight: 1.5,
              }}
            >
              <Box><Box component="span" sx={{ color: 'primary.main', fontWeight: 700 }}>●</Box> {name}</Box>
              <Box><Box component="span" sx={{ color: BESIDE_PIN, fontWeight: 700 }}>●</Box> {beside.label}</Box>
            </Box>
          )}
          {move && (
            // Which pin is which, on the map and not only in the title: a legend a
            // curator has to look away from the pins to read is one they skip.
            <Box
              sx={{
                position: 'absolute', left: 12, bottom: 12, px: 1, py: 0.5, borderRadius: 1,
                bgcolor: 'background.paper', boxShadow: 1, fontSize: 12, lineHeight: 1.5,
              }}
            >
              <Box><Box component="span" sx={{ color: STORED_PIN, fontWeight: 700 }}>●</Box> readers see</Box>
              <Box><Box component="span" sx={{ color: 'primary.main', fontWeight: 700 }}>●</Box> the run proposes</Box>
            </Box>
          )}
        </DialogContent>
      )}
    </Dialog>
  );
}
