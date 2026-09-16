/**
 * What the world layer asks the catalogue for, from where the map is looking.
 *
 * Two decisions, both of them about cost rather than about correctness, which
 * is why they live in a module with a test rather than inside the component:
 *
 * **Which tier.** Below the marker band the layer is a heatmap and a point is a
 * coordinate; at and above it every point is a pin with a name. The band is
 * `MARKER_FADE_START`, the same number the region layer fades on, so the
 * detailed read is already in hand when the first pin appears.
 *
 * **How much world.** Below the band, the whole of it: the answer is 37 kB for
 * every kind at once (18 kB folded), the first screen *is* the world, and one
 * cache entry means panning and zooming out there costs nothing at all. Above
 * the band a viewport is a small fraction of the world and carrying names for
 * the rest would be most of the payload, so the read is boxed — snapped
 * outward to a quarter of the viewport's own span, which is both the cache key
 * and the margin: a pan of up to a quarter of the screen lands inside the box
 * already fetched, and a longer one keeps the previous answer on screen while
 * the next is in flight.
 */

import { MARKER_FADE_START } from './layers';
import type { PointsBox, PointsDetail, WorldPointsQuery } from '../../api/worldPoints';

/** How the box is quantised, as a fraction of the viewport's own span. */
const SNAP = 4;

/** The corners MapLibre reports, before any of this module's rules. */
export interface ViewportBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** Longitude wrapped into [-180, 180). */
function wrapLongitude(value: number): number {
  return ((value + 180) % 360 + 360) % 360 - 180;
}

function snapOut(value: number, step: number, up: boolean): number {
  const snapped = up ? Math.ceil(value / step) : Math.floor(value / step);
  return Number((snapped * step).toFixed(6));
}

/**
 * The box a viewport asks for, or null for the whole world.
 *
 * Null when the viewport already holds every longitude — a box would be the
 * world with extra steps, and `west > east` on a wrapped-round view would name
 * a sliver instead of everything.
 *
 * A view that crosses the antimeridian keeps `west > east`, which is the
 * convention the endpoint reads and `bboxEnvelopes.ts` turns into two
 * envelopes. Snapping happens before the wrap, so the two edges cannot snap
 * past each other and turn a crossing view into an empty one.
 *
 * **The "whole world" question is asked of the snapped span, not the raw one,
 * and that is the whole reason the snapping is done before the test.** Each
 * edge rounds outward by up to a step, so a snapped span reaches 1.5x the
 * viewport's; a raw span under 360 can snap past it, and then the two wrapped
 * edges come back with `west < east` naming a box *narrower* than the viewport
 * rather than the world. Measured on the shape the review found: a 300 degree
 * view from -149 to 151 has a step of 75, snaps to -150 and 225, and 225 wraps
 * to -135 — a 15 degree box for a 300 degree screen, not even a crossing one,
 * so the endpoint builds one small envelope and the layer draws pins over five
 * per cent of the map. That breaks this module's own invariant, the one its
 * test asserts: the box always holds the viewport it was built from.
 *
 * Reachable on the map that draws this layer, which is why it is a bug rather
 * than a hypothetical: `RegionMapVT` does not set `dragRotate={false}` the way
 * the three dialog maps do, so pitch is on, and a pitched viewport at the fade
 * band's floor reports a longitude span well past 240 degrees.
 *
 * Latitude needs no equivalent guard — it clamps to the poles *after* snapping,
 * so an overshoot there is corrected rather than wrapped around.
 */
export function boxForViewport(bounds: ViewportBounds): PointsBox | null {
  const lngSpan = bounds.east - bounds.west;
  if (lngSpan >= 360) return null;
  const latSpan = Math.max(bounds.north - bounds.south, 1e-6);
  const lngStep = Math.max(lngSpan / SNAP, 1e-4);
  const latStep = Math.max(latSpan / SNAP, 1e-4);
  const west = snapOut(bounds.west, lngStep, false);
  const east = snapOut(bounds.east, lngStep, true);
  if (east - west >= 360) return null;
  return {
    west: wrapLongitude(west),
    south: Math.max(snapOut(bounds.south, latStep, false), -90),
    east: wrapLongitude(east),
    north: Math.min(snapOut(bounds.north, latStep, true), 90),
  };
}

/** Which tier a zoom is drawn from. */
export function detailForZoom(zoom: number): PointsDetail {
  return zoom >= MARKER_FADE_START ? 'markers' : 'overview';
}

/**
 * The whole read a view asks for.
 *
 * Built as one value so that it can be the query key: two views that ask the
 * same question are the same cache entry, which is the point of snapping the
 * box at all.
 */
export function queryForView(
  kindId: number | null,
  folded: boolean,
  zoom: number,
  bounds: ViewportBounds,
): WorldPointsQuery {
  const detail = detailForZoom(zoom);
  return {
    kindId,
    folded,
    detail,
    box: detail === 'markers' ? boxForViewport(bounds) : null,
  };
}

/**
 * The key an answer is cached under: the whole question, nothing else.
 *
 * React Query hashes it structurally, so two views that ask the same question
 * are one cache entry — which is what snapping the box is for.
 */
export function pointsKey(query: WorldPointsQuery) {
  return ['world-points', query.kindId, query.detail, query.folded, query.box] as const;
}

/**
 * Whether two views ask the same question — structurally, over the box's four
 * numbers.
 *
 * A function rather than a comparison written at the call site, because the
 * key's last element is an object and anything that stringifies each element on
 * its own turns *every* box into `[object Object]`: `join` does, and so does a
 * key-by-key `String()`. Under that comparison the layer crossed into the
 * marker tier once and every pan after it read as unchanged — panning from
 * Paris to Berlin at zoom 6 kept Paris' pins and drew nothing over Berlin, with
 * `boxForViewport`'s whole snap-and-refetch contract unreachable. Both review
 * bots caught it; nothing in this file's tests did, which is why the rule is
 * here now and tested beside the box it compares.
 */
export function sameQuestion(a: WorldPointsQuery, b: WorldPointsQuery): boolean {
  return a.kindId === b.kindId
    && a.detail === b.detail
    && a.folded === b.folded
    && (a.box === null || b.box === null
      ? a.box === b.box
      : a.box.west === b.box.west && a.box.south === b.box.south
        && a.box.east === b.box.east && a.box.north === b.box.north);
}
