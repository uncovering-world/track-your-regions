/**
 * What the world layer asks for, from where the map is looking.
 *
 * These pin the two things a wrong answer would not announce: a box that
 * silently becomes a sliver across the antimeridian (the same class of failure
 * `bboxEnvelopes.ts` exists for, one layer up), and snapping that stops being
 * a cache key because two neighbouring views quantise differently.
 */

import { describe, it, expect } from 'vitest';
import {
  boxForViewport, detailForZoom, pointsKey, queryForView, sameQuestion,
} from './worldPointsView';
import { MARKER_FADE_START } from './layers';

describe('detailForZoom', () => {
  it('asks for the pins from the zoom the region layer starts fading them in', () => {
    // Not a number of its own: a detailed read arriving later than the first
    // pin draws it nameless and colourless for half a zoom level.
    expect(detailForZoom(MARKER_FADE_START)).toBe('markers');
    expect(detailForZoom(MARKER_FADE_START - 0.01)).toBe('overview');
  });

  it('asks for coordinates alone at the zooms the first screen opens on', () => {
    for (const zoom of [0, 1, 2, 3, 4]) expect(detailForZoom(zoom)).toBe('overview');
  });
});

describe('boxForViewport', () => {
  it('names no box when the view already holds every longitude', () => {
    expect(boxForViewport({ west: -180, south: -85, east: 180, north: 85 })).toBeNull();
    // A view wrapped more than once round is still the whole world.
    expect(boxForViewport({ west: -400, south: -85, east: 400, north: 85 })).toBeNull();
  });

  it('snaps outward, so the box always holds the viewport it was built from', () => {
    const view = { west: 3.1, south: 45.3, east: 12.9, north: 51.7 };
    const box = boxForViewport(view)!;
    expect(box.west).toBeLessThanOrEqual(view.west);
    expect(box.east).toBeGreaterThanOrEqual(view.east);
    expect(box.south).toBeLessThanOrEqual(view.south);
    expect(box.north).toBeGreaterThanOrEqual(view.north);
  });

  it('gives two views inside the same cells the same box, which is what makes it a cache key', () => {
    const first = boxForViewport({ west: 0.5, south: 40.5, east: 8.5, north: 48.5 });
    // Panned by a fortieth of the span, both edges still inside their cells.
    const second = boxForViewport({ west: 0.7, south: 40.7, east: 8.7, north: 48.7 });
    expect(second).toEqual(first);
  });

  it('asks again once an edge crosses a grid line, which is the bound on how stale an edge gets', () => {
    // Outward snapping cannot do better than this and should not pretend to:
    // a pan long enough to move an edge into the next cell is a pan that has
    // brought unfetched world on screen. What covers the gap is the previous
    // answer staying drawn while the next is in flight, not a wider box.
    const before = boxForViewport({ west: 0, south: 40, east: 8, north: 48 })!;
    const after = boxForViewport({ west: 0.2, south: 40, east: 8.2, north: 48 })!;
    expect(after.east).toBeGreaterThan(before.east);
    expect(after.west).toBe(before.west);
  });

  it('keeps west > east for a view across the antimeridian, rather than naming a sliver', () => {
    // Fiji: the endpoint reads this as two envelopes meeting at the line.
    const box = boxForViewport({ west: 175, south: -20, east: 185, north: -14 })!;
    expect(box.west).toBeGreaterThan(0);
    expect(box.east).toBeLessThan(0);
    expect(box.west).toBeGreaterThan(box.east);
  });

  it('never lets the two edges snap past each other on a crossing view', () => {
    // Snapping happens before the wrap for this reason: snapping wrapped
    // values would push 179.99 up to 180.01 -> -179.99 and turn a narrow
    // crossing view into one spanning almost the whole planet the other way.
    for (const east of [180.01, 180.5, 182, 190]) {
      const box = boxForViewport({ west: 179.5, south: 0, east, north: 5 })!;
      expect(box.west).toBeGreaterThan(box.east);
    }
  });

  it('names no box for a wide view whose snapped edges reach round the world', () => {
    // The raw span is 300, under 360, so the first guard lets it through; the
    // step is 75, the edges snap to -150 and 225, and 225 wraps to -135 — a 15
    // degree box for a 300 degree screen, and `west < east` so not even a
    // crossing one. The layer drew pins over five per cent of the map.
    expect(boxForViewport({ west: -149, south: 0, east: 151, north: 10 })).toBeNull();
  });

  it('holds the viewport it was built from at every span, which is the invariant', () => {
    // A sweep rather than a handful of cases, because the cases that were here
    // covered exactly-360 and past-360 and the hole was at 300. What is asserted
    // is the property the docblock claims, over every span and a full turn of
    // centres: the box either holds the viewport or is null for the whole world.
    const spanOf = (box: NonNullable<ReturnType<typeof boxForViewport>>) => (
      box.west > box.east ? (180 - box.west) + (box.east + 180) : box.east - box.west
    );
    for (let span = 1; span <= 359; span += 1) {
      for (let centre = -180; centre <= 180; centre += 15) {
        const view = { west: centre - span / 2, south: 0, east: centre + span / 2, north: 10 };
        const box = boxForViewport(view);
        if (box === null) continue;
        expect(spanOf(box)).toBeGreaterThanOrEqual(span - 1e-6);
      }
    }
  });

  it('never names a latitude off the planet', () => {
    const box = boxForViewport({ west: -10, south: -89.9, east: 10, north: 89.9 })!;
    expect(box.south).toBeGreaterThanOrEqual(-90);
    expect(box.north).toBeLessThanOrEqual(90);
  });

  it('survives a viewport with no height, which a map mid-resize reports', () => {
    expect(() => boxForViewport({ west: 5, south: 45, east: 5, north: 45 })).not.toThrow();
  });
});

describe('queryForView', () => {
  const world = { west: -180, south: -85, east: 180, north: 85 };

  it('asks for the whole world below the band, so panning there costs no request', () => {
    const over = queryForView(null, false, 2, { west: -10, south: 35, east: 30, north: 60 });
    expect(over).toEqual({ kindId: null, folded: false, detail: 'overview', box: null });
  });

  it('boxes the read once the pins are being drawn', () => {
    const query = queryForView(1, true, 6, { west: 2, south: 45, east: 12, north: 51 });
    expect(query.detail).toBe('markers');
    expect(query.box).not.toBeNull();
    expect(query.kindId).toBe(1);
    expect(query.folded).toBe(true);
  });

  it('carries no box at marker zoom over the whole world, which a wide screen can hold', () => {
    expect(queryForView(null, false, MARKER_FADE_START, world).box).toBeNull();
  });
});

describe('sameQuestion', () => {
  const at = (box: { west: number; south: number; east: number; north: number } | null) => ({
    kindId: 1, detail: 'markers' as const, folded: false, box,
  });
  const paris = { west: 2, south: 48, east: 3, north: 49 };
  const berlin = { west: 13, south: 52, east: 14, north: 53 };

  it('tells two different boxes apart — the bug this function exists for', () => {
    // `pointsKey(...).join('|')` made every box `[object Object]`, so once the
    // layer had crossed into the marker tier no pan ever changed the key:
    // panning from Paris to Berlin at zoom 6 kept Paris' pins. The joined form
    // is asserted here too, so the shortcut cannot come back looking harmless.
    expect(pointsKey(at(paris)).join('|')).toBe(pointsKey(at(berlin)).join('|'));
    expect(sameQuestion(at(paris), at(berlin))).toBe(false);
  });

  it('tells a box apart from one that differs in a single edge', () => {
    for (const edge of ['west', 'south', 'east', 'north'] as const) {
      const moved = { ...paris, [edge]: paris[edge] + 0.5 };
      expect(sameQuestion(at(paris), at(moved))).toBe(false);
    }
  });

  it('calls two views with equal boxes the same question, so a pan inside a cell costs nothing', () => {
    expect(sameQuestion(at(paris), at({ ...paris }))).toBe(true);
  });

  it('tells the whole world apart from a box, and from itself agrees', () => {
    expect(sameQuestion(at(null), at(paris))).toBe(false);
    expect(sameQuestion(at(paris), at(null))).toBe(false);
    expect(sameQuestion(at(null), at(null))).toBe(true);
  });

  it('tells the kind, the tier and the fold apart', () => {
    const base = { kindId: 1, detail: 'overview' as const, folded: false, box: null };
    expect(sameQuestion(base, { ...base, kindId: 2 })).toBe(false);
    expect(sameQuestion(base, { ...base, kindId: null })).toBe(false);
    expect(sameQuestion(base, { ...base, detail: 'markers' })).toBe(false);
    expect(sameQuestion(base, { ...base, folded: true })).toBe(false);
    expect(sameQuestion(base, { ...base })).toBe(true);
  });
});
