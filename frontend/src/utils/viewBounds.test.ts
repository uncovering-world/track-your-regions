import { describe, it, expect } from 'vitest';
import { pointInView, type ViewBounds } from './viewBounds';

/** Prague at street zoom, the view #553 was reported from. */
const PRAGUE: ViewBounds = { west: 14.35, south: 50.05, east: 14.50, north: 50.11 };
/**
 * A view straddling the dateline, in the shape MapLibre actually answers with:
 * `west <= east`, values past 180. `LngLatBounds.extend` assigns `Math.min` and
 * `Math.max` on longitude, so the `west > east` form never comes out of
 * `getBounds()` — believing it did was the defect these cases pin.
 */
const DATELINE: ViewBounds = { west: 175, south: -20, east: 185, north: 20 };
/** Panned on past it: the transform's centre drifts, the numbers keep climbing. */
const PANNED_PAST: ViewBounds = { west: 170, south: -20, east: 210, north: 20 };
/** The same view in this repository's own convention, which also arrives here. */
const WRAPPED: ViewBounds = { west: 175, south: -20, east: -175, north: 20 };

describe('pointInView', () => {
  it('holds a point inside the box', () => {
    expect(pointInView(14.42, 50.087, PRAGUE)).toBe(true);
  });

  it('drops a point outside it, in either axis', () => {
    expect(pointInView(16.6, 50.087, PRAGUE)).toBe(false);
    expect(pointInView(14.42, 49.0, PRAGUE)).toBe(false);
  });

  it('holds both sides of a dateline view MapLibre reports unwrapped', () => {
    // The API answers in [-180, 180] while the map reasons past it, so this is
    // the comparison that decides whether a row survives: at 179 and at -179 the
    // pins are both on screen — MapLibre draws world copies — and both rows must
    // stay. `lng >= 175 && lng <= 185` answers false for -179.
    expect(pointInView(179, 0, DATELINE)).toBe(true);
    expect(pointInView(-179, 0, DATELINE)).toBe(true);
  });

  it('holds a point in a view panned well past the dateline', () => {
    // Fly Japan → Alaska and the centre lands near 190; nothing here sets
    // `renderWorldCopies={false}` or `maxBounds`, so the numbers keep going.
    // `[170, 210]` matches no real longitude at all under a literal comparison.
    expect(pointInView(-150, 0, PANNED_PAST)).toBe(true);
    expect(pointInView(175, 0, PANNED_PAST)).toBe(true);
  });

  it('still answers the west > east form this repository publishes', () => {
    // `focus_bbox` and the `bbox` query parameter use it, so a caller passing one
    // straight in keeps working.
    expect(pointInView(179, 0, WRAPPED)).toBe(true);
    expect(pointInView(-179, 0, WRAPPED)).toBe(true);
    expect(pointInView(0, 0, WRAPPED)).toBe(false);
  });

  it('drops the strip the dateline view does not cover', () => {
    expect(pointInView(0, 0, DATELINE)).toBe(false);
    expect(pointInView(169, 0, DATELINE)).toBe(false);
  });

  it('holds every longitude once the whole world is on screen', () => {
    // Zoomed out, `getBounds()` reports a width of 360 or more; folding the far
    // edge away with a modulo would drop points at the seam.
    const WORLD: ViewBounds = { west: -180, south: -85, east: 180, north: 85 };
    const WIDER: ViewBounds = { west: -200, south: -85, east: 200, north: 85 };
    for (const lng of [-179, -90, 0, 90, 179]) {
      expect(pointInView(lng, 0, WORLD)).toBe(true);
      expect(pointInView(lng, 0, WIDER)).toBe(true);
    }
  });

  it('counts a point exactly on the edge as inside', () => {
    // A pin drawn on the border of the viewport is one the reader can see, so the
    // list has to hold its row.
    expect(pointInView(PRAGUE.west, PRAGUE.south, PRAGUE)).toBe(true);
    expect(pointInView(PRAGUE.east, PRAGUE.north, PRAGUE)).toBe(true);
  });
});
