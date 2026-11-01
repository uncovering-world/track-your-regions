/**
 * The pieces of the point dialog's look at several points that are not a move
 * (#2202): the near-places card's two places, the sources card's two points of
 * one place. Each pin says whose it is on the map itself, in the legend and
 * in the row of links under the map, and nothing is called a proposal.
 *
 * Beside `PointPreviewDialog` rather than inside it so the dialog stays the
 * one statement of which look it opens on.
 */

import { Box, Button, Link, Typography } from '@mui/material';
import { Marker } from 'react-map-gl/maplibre';
import { mapsTargets } from '../../utils/mapsLink';
import { focusFromGeoJson } from '../../utils/mapUtils';
import { distanceLabel, movedBy, moveView } from '../../utils/moveDescription';

/** One point the dialog draws, and whose it is: a place with what it is, or a source. */
export interface MapPin {
  latitude: number;
  longitude: number;
  label: string;
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

/** A pin with its label under it, on the map: whose the point is, read without looking away. */
export function LabelledPin({ pin, colour }: { pin: MapPin; colour: string }) {
  return (
    <>
      <Marker latitude={pin.latitude} longitude={pin.longitude} color={colour} />
      {/* Under the point rather than above the pin, where it would cover the neighbour whenever
          two pins are metres apart. */}
      <Marker latitude={pin.latitude} longitude={pin.longitude} anchor="top" offset={[0, 4]}>
        <Box
          sx={{
            px: 0.75, borderRadius: 0.5, bgcolor: 'background.paper', boxShadow: 1, fontSize: 12,
            fontWeight: 600, whiteSpace: 'nowrap', pointerEvents: 'none', borderLeft: `3px solid ${colour}`,
          }}
        >
          {pin.label}
        </Box>
      </Marker>
    </>
  );
}

/** Which pin is which, on the map: a legend a curator has to look away from the pins to read is one they skip. */
export function PinLegend({ entries }: { entries: ReadonlyArray<{ colour: string; label: string }> }) {
  return (
    <Box
      sx={{
        position: 'absolute', left: 12, bottom: 12, px: 1, py: 0.5, borderRadius: 1, maxWidth: '70%',
        bgcolor: 'background.paper', boxShadow: 1, fontSize: 12, lineHeight: 1.5,
      }}
    >
      {entries.map(entry => (
        <Box key={entry.label}>
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
 * A pin that carries an action offers it at the end of its row.
 */
export function PinLinks({ pins }: { pins: ReadonlyArray<MapPin & { colour: string }> }) {
  return (
    <Box sx={{ px: 2.5, py: 1.5, display: 'grid', gap: 0.5 }}>
      {pins.map(pin => (
        <Typography key={pin.label} variant="body2" sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'baseline' }}>
          <Box component="span" sx={{ color: pin.colour, fontWeight: 700 }}>●</Box>
          <Box component="span" sx={{ fontWeight: 600 }}>{pin.label}</Box>
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
        </Typography>
      ))}
    </Box>
  );
}
