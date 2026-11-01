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
 * is asked for. The one card that draws its map inline — the component-items card, whose
 * question is a distance among a site's places (`ComponentItemsMap`) — mounts it only while
 * the card is near the screen (`useNearViewport`), which bounds the count the same way.
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
 * **Points that are not a move are drawn as whose they are** (#2202). Where a caller hands
 * in `pins` — the near-places card's two places, Bisotun and the caravanserai at the foot
 * of its rock; the sources card's two points of one place — each pin is labelled on the
 * map, in the legend and under the map with whose it is, a place with what it is or a
 * source, in a colour of its own; no arrow is drawn and nothing is called a proposal,
 * since no run proposes anything there. The map frames every pin by the one framing rule
 * (`frameGeoJson`, #674), so two pins either side of the antimeridian are framed between
 * them, at a ceiling the basemap still reads at (`PINS_MAX_ZOOM`), since a region's
 * ceiling of 12 puts two pins 450 m apart twelve pixels from each other.
 *
 * **Every look ends in the way to each point on another map.** Under the map, each point
 * the dialog draws is a row — whose it is, its coordinate, and the links that open it in
 * OpenStreetMap and Google Maps (`PinLinks`) — so a curator checks the pin against another
 * map on the same point rather than retyping the numbers. A pin whose card takes an answer
 * about the point carries it as the pin's `action` — the sources card's "keep this point" —
 * and the row offers it; the card answers, the dialog only hands the press on.
 *
 * In `shared/` because the same look is asked for from three places — the review
 * page's cards, the object's own screen and the places list on a map — and the rule
 * for where a place may be corrected is the same on all of them: wherever a curator
 * whose scope reaches the place is looking at one (#613).
 */

import { Box, Dialog, DialogContent, DialogTitle, IconButton, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { Layer, Marker, Source } from 'react-map-gl/maplibre';
import { GuardedMap } from './GuardedMap';
import { MAP_STYLE } from '../../constants/mapStyles';
import { PointCorrection, type PlaceToCorrect } from './PointCorrection';
import {
  LabelledPin, PIN_COLOURS, PINS_MAX_ZOOM, PinLegend, PinLinks, pinColour, pinsApart, pinsGeoJson, pinsView, type MapPin,
} from './PointPreviewPins';
import { frameGeoJson } from '../../utils/mapUtils';
import { moveLabel, moveView, movedBy, shortWayLongitudeDelta } from '../../utils/moveDescription';

/** The pin readers see today, where the map also draws the one proposed: present, and plainly not the news. */
const STORED_PIN = '#757575';
const MOVE_LINE = '#C62828';
/**
 * How much of the map's edge the framed pins keep clear: more at the bottom,
 * where the lowest pin's label hangs under it and the legend stands in the
 * corner — at 70 the caravanserai's label sat under the legend.
 */
const PINS_PADDING = { top: 70, bottom: 130, left: 70, right: 70 };

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
type Companion = { move: string | null; other: Coordinate | null };

/**
 * What the map draws beside the place, if anything: the proposed move as the
 * title says it, only where it goes a metre or more — two points closer than
 * that are one pin. Nothing under a correction, which has its own form.
 */
function companion(
  stored: Coordinate,
  movedTo: { latitude: number; longitude: number } | undefined,
  correcting: boolean,
): Companion {
  if (correcting || !movedTo) return { move: null, other: null };
  const at = { lon: movedTo.longitude, lat: movedTo.latitude };
  const label = (movedBy(stored, at)?.meters ?? 0) >= 1 ? moveLabel(stored, at) : null;
  return label ? { move: label, other: at } : { move: null, other: null };
}

type ColouredPin = MapPin & { colour: string };

/**
 * What the look draws, as the rows under the map and the legend say it: the
 * labelled pins; or the stored and the proposed point of a move, named as the
 * legend always named them; or the one place.
 */
function pinsOf(
  several: readonly MapPin[] | null,
  name: string,
  stored: { latitude: number; longitude: number },
  movedTo: { latitude: number; longitude: number } | undefined,
  move: string | null,
): ColouredPin[] {
  if (several) return several.map((pin, index) => ({ ...pin, colour: pinColour(index) }));
  if (movedTo && move) {
    return [
      { ...stored, label: 'readers see', colour: STORED_PIN },
      { ...movedTo, label: 'the run proposes', colour: PIN_COLOURS[0] },
    ];
  }
  return [{ ...stored, label: name, colour: PIN_COLOURS[0] }];
}

/** Where the camera opens: on the pins' span, on the move, or on the one place at street level. */
function viewOf(
  several: readonly MapPin[] | null,
  stored: Coordinate,
  other: Coordinate | null,
): { latitude: number; longitude: number; zoom: number } {
  if (several) return pinsView(several);
  if (other) return moveView(stored, other);
  return { latitude: stored.lat, longitude: stored.lon, zoom: 11 };
}

/** What stands on the map: the labelled pins, the move, or the one pin. */
function Drawn({ several, drawn, move, movedTo, latitude, longitude }: {
  several: readonly MapPin[] | null;
  drawn: readonly ColouredPin[];
  move: string | null;
  movedTo: { latitude: number; longitude: number } | undefined;
  latitude: number;
  longitude: number;
}) {
  if (several) return <>{drawn.map(pin => <LabelledPin key={pin.label} pin={pin} colour={pin.colour} />)}</>;
  if (movedTo && move) {
    return (
      <>
        <MoveArrow from={{ latitude, longitude }} to={movedTo} />
        <Marker latitude={latitude} longitude={longitude} color={STORED_PIN} />
        <Marker latitude={movedTo.latitude} longitude={movedTo.longitude} />
      </>
    );
  }
  return <Marker latitude={latitude} longitude={longitude} />;
}

export function PointPreviewDialog({ open, onClose, name, latitude, longitude, movedTo, pins, correction }: {
  open: boolean;
  onClose: () => void;
  name: string;
  /** The place's point — or, with `pins`, the first of them, which the title prints for one pin. */
  latitude: number;
  longitude: number;
  /**
   * Where a run proposes the place is instead. With it the map shows the move: both
   * pins and the arrow between them. Read by the look alone — a correction opens on
   * its own form, whose picker already draws the source's position.
   */
  movedTo?: { latitude: number; longitude: number };
  /**
   * Points that are not a move, each with whose it is (#2202): two places that may be
   * one, two sources' points of one place. The map draws and labels every one and
   * frames them together; nothing is called a proposal. Read by the look alone.
   */
  pins?: readonly MapPin[];
  /**
   * Offered where a curator may correct the place: what to correct, and where the
   * outcome line goes. Absent, the dialog is the look it always was.
   */
  correction?: { place: PlaceToCorrect; onDone: (message: string) => void };
}) {
  const stored = { lon: longitude, lat: latitude };
  const several = pins && pins.length > 0 && !correction ? pins : null;
  const { move, other } = companion(stored, movedTo, Boolean(correction) || several !== null);
  const view = viewOf(several, stored, other);
  const drawn = pinsOf(several, name, { latitude, longitude }, movedTo, move);
  const apart = several ? pinsApart(several) : null;
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ pr: 6 }}>
        {name}
        <Typography variant="body2" color="text.secondary">
          {/* Two pins are said by how they stand to each other; their coordinates are under the map. */}
          {apart ?? `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`}
          {move && ` → ${movedTo?.latitude.toFixed(4)}, ${movedTo?.longitude.toFixed(4)} · a proposed move of ${move}`}
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
        <DialogContent sx={{ p: 0 }}>
          <Box sx={{ height: 420, position: 'relative' }}>
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
                unavailableDetail="The coordinates are below; the rest of this card needs no map."
                // Several pins are framed by the one rule once the map can be asked to;
                // one pin stands where the view already put it.
                onLoad={(event) => {
                  if (several && several.length > 1) {
                    frameGeoJson(event.target, pinsGeoJson(several), { padding: PINS_PADDING, duration: 0, maxZoom: PINS_MAX_ZOOM });
                  }
                }}
              >
                <Drawn several={several} drawn={drawn} move={move} movedTo={movedTo} latitude={latitude} longitude={longitude} />
              </GuardedMap>
            )}
            {/* Which pin is which, on the map and not only in the title, wherever there is more than one. */}
            {drawn.length > 1 && <PinLegend entries={drawn} />}
          </Box>
          <PinLinks pins={drawn} />
        </DialogContent>
      )}
    </Dialog>
  );
}
