/**
 * The pieces of the point dialog's look at several points that are not a move
 * (#2202): the near-places card's two places, the sources card's two points of
 * one place. Each pin says whose it is on the map itself and in the row of
 * links under the map, and nothing is called a proposal.
 *
 * Beside `PointPreviewDialog` rather than inside it so the dialog stays the
 * one statement of which look it opens on.
 */

import { Fragment, useEffect, useState } from 'react';
import { Box, Button, Link, Typography } from '@mui/material';
import { Marker, type MapRef } from 'react-map-gl/maplibre';
import { mapsTargets } from '../../utils/mapsLink';
import { focusFromGeoJson, type MapLike } from '../../utils/mapUtils';
import { groupLabel, LABEL_REACH, labelSides, pinGroups, type LabelSide, type ScreenPoint } from './pinLayout';
import { distanceLabel, movedBy, moveView } from '../../utils/moveDescription';

/** One point the dialog draws, and whose it is: a place with what it is, or a source. */
export interface MapPin {
  latitude: number;
  longitude: number;
  /** Whose the point is, as the map labels it: the place's name, a source or "Wikipedia". */
  label: string;
  /** The card's own place: "(this card)" follows its name, and stays on the map however short the name is cut. */
  own?: boolean;
  /**
   * What the place is (its kinds, the site it is part of), said once, in its row
   * under the map (#2273): on the map it made labels too long to read.
   */
  detail?: string;
  /**
   * What a curator may answer from this pin, where the card that opened the
   * dialog takes an answer about the point (#2202): the sources card's "keep
   * this point". Offered on the pin's row under the map; the card does the
   * answering, as it does for its own buttons.
   */
  action?: { label: string; onPick: () => void; disabled?: boolean };
}

/**
 * The colours pins are told apart by, in order: MapLibre's own pin first, then
 * the brown the component-items map gives a candidate, then colours no basemap
 * feature wears.
 */
export const PIN_COLOURS = ['#3FB1CE', '#5D4037', '#2E7D32', '#6A1B9A', '#EF6C00'] as const;

export function pinColour(index: number): string {
  return PIN_COLOURS[index % PIN_COLOURS.length];
}

/** How close the camera stands on one pin: the surroundings a description talks about, not the roof. */
const ONE_PIN_ZOOM = 11;
/** The basemap's last useful level, where two pins metres apart are still two pins. */
export const PINS_MAX_ZOOM = 17;

/** The pins as the shape the framing rule measures (#674). */
export function pinsGeoJson(pins: readonly MapPin[]): GeoJSON.MultiPoint {
  return { type: 'MultiPoint', coordinates: pins.map(pin => [pin.longitude, pin.latitude]) };
}

/**
 * Where the camera stands before the map has loaded and framed the pins by
 * the one rule (`frameGeoJson`, on load): on the pins' anchor, at the zoom
 * their span asks for, so the first frame is already about right and the
 * framing settles it rather than jumping to it. The anchor and the box come
 * from `focusFromGeoJson`, never from a min/max over the longitudes, so two
 * pins either side of the antimeridian are centred between them.
 */
export function pinsView(pins: readonly MapPin[]): { longitude: number; latitude: number; zoom: number } {
  const focus = pins.length > 1 ? focusFromGeoJson(pinsGeoJson(pins)) : null;
  if (!focus) return { longitude: pins[0].longitude, latitude: pins[0].latitude, zoom: ONE_PIN_ZOOM };
  const [west, south, east, north] = focus.bbox;
  const { zoom } = moveView({ lon: west, lat: south }, { lon: east, lat: north });
  return { longitude: focus.anchorPoint[0], latitude: focus.anchorPoint[1], zoom };
}

/** How the pins stand to each other, for the title: two pins by their distance. */
export function pinsApart(pins: readonly MapPin[]): string | null {
  if (pins.length !== 2) return null;
  const [a, b] = pins;
  const move = movedBy({ lon: a.longitude, lat: a.latitude }, { lon: b.longitude, lat: b.latitude });
  return move ? `${distanceLabel(move.meters)} apart` : null;
}

/** What follows the card's own place's name, on the map and in its row. */
const OWN_MARK = ' (this card)';

/** A pin's name as its row and its hover text say it: the card's own place marked. */
export function pinName(pin: Pick<MapPin, 'label' | 'own'>): string {
  return pin.own ? `${pin.label}${OWN_MARK}` : pin.label;
}

/** A pin's name as a label joined to another pin's says it on the map: an article's point as Wikipedia's. */
function shortName(pin: Pick<MapPin, 'label' | 'own'>): string {
  return pin.label.startsWith('Wikipedia') ? 'Wikipedia' : pinName(pin);
}

/**
 * A run of a label that may be cut short, down to `floor` px: only a run longer
 * than that is, so "Bisotun" keeps its own width rather than a floor's.
 */
function cutShort(text: string, floor: number) {
  const long = textWidth(text) > floor;
  return { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: long ? 1 : 0, minWidth: long ? floor : undefined } as const;
}

/** A label's longest run on the map before it is cut short; the whole is its hover text. */
const LABEL_MAX_WIDTH = 360;
const LABEL_HEIGHT = 20;
/** The label's padding, its colour bar and each colour dot, beside the text. */
const LABEL_CHROME = 18;
const DOT_WIDTH = 10;
/** The label's gap before each of its parts (`gap: 0.5`). */
const DOT_GAP = 4;

let measuring: CanvasRenderingContext2D | null | undefined;
/** The width a label's text takes on screen, measured where a canvas is to hand, estimated where none is. */
function textWidth(text: string): number {
  if (measuring === undefined) {
    measuring = typeof document === 'undefined' ? null : document.createElement('canvas').getContext?.('2d') ?? null;
    // In the page's own type, which the label is drawn in.
    if (measuring) measuring.font = `600 12px ${getComputedStyle(document.body).fontFamily || 'sans-serif'}`;
  }
  return measuring ? measuring.measureText(text).width : text.length * 6.5;
}

/** Where a label's marker stands against its pin, for each side `labelSides` chose. */
const LABEL_ANCHOR: Record<LabelSide, { anchor: 'top' | 'bottom' | 'left' | 'right'; offset: [number, number] }> = {
  bottom: { anchor: 'top', offset: [0, LABEL_REACH.below] },
  top: { anchor: 'bottom', offset: [0, -LABEL_REACH.above] },
  right: { anchor: 'left', offset: [LABEL_REACH.beside, -LABEL_REACH.middle] },
  left: { anchor: 'right', offset: [-LABEL_REACH.beside, -LABEL_REACH.middle] },
};

/** The map a label's place on screen is asked of. */
function mapOf(map: MapLike): ReturnType<MapRef['getMap']> {
  return 'getMap' in map ? map.getMap() : map;
}

/** Where the pins stand on screen, and the canvas they stand on. */
interface ScreenRead { points: ScreenPoint[]; bounds: { width: number; height: number } }

/**
 * Where each pin stands on screen, read again whenever the camera moves; null
 * until the map has loaded, and while the pins it was read for are not the
 * pins drawn (an article's pin arriving), so a layout never reads a stale one.
 */
function useScreenPoints(map: MapLike | null, pins: readonly { latitude: number; longitude: number }[]): ScreenRead | null {
  const key = pins.map(pin => `${pin.longitude},${pin.latitude}`).join(';');
  const [read, setRead] = useState<ScreenRead & { key: string } | null>(null);
  useEffect(() => {
    if (!map) { setRead(null); return; }
    const m = mapOf(map);
    const at = key === '' ? [] : key.split(';').map(pair => pair.split(',').map(Number) as [number, number]);
    const project = () => {
      const canvas = m.getContainer?.();
      setRead({
        key,
        points: at.map(lngLat => m.project(lngLat)),
        bounds: { width: canvas?.clientWidth ?? Infinity, height: canvas?.clientHeight ?? Infinity },
      });
    };
    let frame = 0;
    const onMove = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(project); };
    project();
    m.on('move', onMove);
    return () => { cancelAnimationFrame(frame); m.off('move', onMove); };
  }, [map, key]);
  return read && read.key === key ? read : null;
}

/** A point the caller draws its own pin on, which the labels avoid and a pin on it joins: a move's two points. */
export interface DrawnPoint { latitude: number; longitude: number; colour: string }

/**
 * The labelled pins on the map (#2202, #2273): whose each point is, read
 * without looking away. Pins that stand on one point at the zoom drawn are one
 * pin, whose label names every one of them ("Cathedral of Santiago de
 * Compostela (this card), and Wikipedia's point"), so none is hidden under
 * another. A label names the place and nothing else, is cut short past
 * `LABEL_MAX_WIDTH` with the whole as its hover text, and hangs on the side of
 * its pin where it covers no other pin or label (`labelSides`). Until the map
 * has loaded and the screen can be measured, each pin stands alone with its
 * label under it.
 */
export function PinsOnMap({ pins, map, drawnElsewhere = [] }: {
  pins: ReadonlyArray<MapPin & { colour: string }>;
  map: MapLike | null;
  /**
   * Points whose pins the caller draws, unlabelled: a move's two points. A
   * label avoids them, and a pin on one joins it rather than being drawn over
   * it, its label beside the caller's pin (#2273).
   */
  drawnElsewhere?: readonly DrawnPoint[];
}) {
  const all = [...drawnElsewhere, ...pins];
  const fixed = drawnElsewhere.length;
  const screen = useScreenPoints(map, all);
  const groups = screen ? pinGroups(screen.points) : all.map((_, index) => [index]);
  const shown = groups.map(group => {
    const at = all[group[0]];
    const named = group.filter(index => index >= fixed).map(index => pins[index - fixed]);
    const colours = group.map(index => all[index].colour);
    if (named.length === 0) return { at, drawn: false, first: null, label: '', rest: '', colours, size: { width: 0, height: 0 } };
    const [first, ...others] = named;
    const label = groupLabel(named.map(pinName));
    // What follows the first place's name on the map. An article's point joined to a pin is
    // "Wikipedia's point": which article it is, its row and the hover text say. The name and
    // this are cut short before "(this card)", which says which pin is the card's.
    const rest = groupLabel(['', ...others.map(shortName)]);
    const dots = colours.length > 1 ? colours.length * (DOT_WIDTH + DOT_GAP) : 0;
    const width = Math.min(LABEL_MAX_WIDTH, textWidth(`${pinName(first)}${rest}`) + LABEL_CHROME + dots);
    // A caller's pin stands there already; a second would cover it.
    return { at, drawn: group[0] >= fixed, first, label, rest, colours, size: { width, height: LABEL_HEIGHT } };
  });
  const sides = screen
    ? labelSides(groups.map(group => screen.points[group[0]]), shown.map(each => each.size), screen.bounds)
    : shown.map((): LabelSide => 'bottom');
  return (
    <>
      {shown.map(({ at: pin, drawn, first, label, rest, colours }, index) => first && (
        <Fragment key={`${index}:${label}`}>
          {drawn && <Marker latitude={pin.latitude} longitude={pin.longitude} color={colours[0]} />}
          {/* Keyed by its side: react-map-gl moves a marker's offset when it changes, never its anchor. */}
          <Marker key={sides[index]} latitude={pin.latitude} longitude={pin.longitude} {...LABEL_ANCHOR[sides[index]]}>
            <Box
              title={label}
              sx={{
                display: 'flex', alignItems: 'center', gap: 0.5, maxWidth: LABEL_MAX_WIDTH, px: 0.75, borderRadius: 0.5,
                bgcolor: 'background.paper', boxShadow: 1, fontSize: 12, fontWeight: 600, lineHeight: `${LABEL_HEIGHT}px`,
                borderLeft: `3px solid ${colours[0]}`,
              }}
            >
              {/* Each pin's colour, as its row under the map wears it, where one label names several. */}
              {colours.length > 1 && colours.map((colour, at) => (
                <Box key={`${at}:${colour}`} component="span" sx={{ color: colour, fontSize: 10 }}>●</Box>
              ))}
              {/* One run of text: the name is cut first, the names it is joined with next. */}
              <Box component="span" sx={{ display: 'flex', minWidth: 0, whiteSpace: 'pre' }}>
                <Box component="span" sx={cutShort(first.label, 80)}>{first.label}</Box>
                {first.own && <Box component="span" sx={{ flexShrink: 0 }}>{OWN_MARK}</Box>}
                {rest && <Box component="span" sx={cutShort(rest, 64)}>{rest}</Box>}
              </Box>
            </Box>
          </Marker>
        </Fragment>
      ))}
    </>
  );
}

/**
 * Which pin is which, on the map, for a move: its two pins carry no label of
 * their own. Every other look labels its pins, and the rows under the map are
 * the key, so it draws none (#2273).
 */
export function PinLegend({ entries }: { entries: ReadonlyArray<{ colour: string; label: string }> }) {
  return (
    <Box
      sx={{
        position: 'absolute', left: 12, bottom: 12, px: 1, py: 0.5, borderRadius: 1, maxWidth: '70%',
        bgcolor: 'background.paper', boxShadow: 1, fontSize: 12, lineHeight: 1.5,
      }}
    >
      {entries.map((entry, index) => (
        <Box key={`${index}:${entry.label}`}>
          <Box component="span" sx={{ color: entry.colour, fontWeight: 700 }}>●</Box> {entry.label}
        </Box>
      ))}
    </Box>
  );
}

/**
 * Each point under the map, with the way to it in OpenStreetMap and Google
 * Maps (`mapsLink.ts`, ADR-0115): a curator checking a pin against another map
 * opens that map on the same point. The device's own app and the visitor's
 * choice of one (`OpenInMapsLink`) are not offered: this is a desk, not a walk.
 * A pin that carries an action offers it at the end of its row, and one whose
 * ground is known says under it what OpenStreetMap holds there (#2206).
 */
export function PinLinks({ pins }: { pins: ReadonlyArray<MapPin & { colour: string; ground?: string }> }) {
  return (
    <Box sx={{ px: 2.5, py: 1.5, display: 'grid', gap: 0.5 }}>
      {pins.map((pin, index) => (
        <Typography key={`${index}:${pin.label}`} variant="body2" sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'baseline' }}>
          <Box component="span" sx={{ color: pin.colour, fontWeight: 700 }}>●</Box>
          <Box component="span" sx={{ fontWeight: 600 }}>{pinName(pin)}</Box>
          {pin.detail && <Box component="span">{pin.detail}</Box>}
          <Box component="span" color="text.secondary">{pin.latitude.toFixed(4)}, {pin.longitude.toFixed(4)}</Box>
          {mapsTargets(pin, pin.label, 'other').map(target => (
            <Link key={target.id} href={target.href} target="_blank" rel="noopener noreferrer">
              {target.name}
            </Link>
          ))}
          {pin.action && (
            <Button size="small" variant="outlined" disabled={pin.action.disabled} onClick={pin.action.onPick}
              aria-label={`${pin.action.label}: ${pin.label}`} sx={{ ml: 'auto', py: 0, lineHeight: 1.6 }}>
              {pin.action.label}
            </Button>
          )}
          {/* What OpenStreetMap holds at the point (#2206), on a line of its own under the pin's,
              after the pin's action so the action stays at the end of the pin's own line. */}
          {pin.ground && (
            <Box component="span" color="text.secondary" sx={{ flexBasis: '100%', boxSizing: 'border-box', pl: 2 }}>{`here: ${pin.ground}`}</Box>
          )}
        </Typography>
      ))}
    </Box>
  );
}
