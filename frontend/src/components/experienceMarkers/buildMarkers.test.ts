import { describe, it, expect } from 'vitest';
import { buildExperienceMarkers } from './buildMarkers';
import type { Experience, ExperienceLocation } from '../../api/experiences';

/**
 * The marker set is what the list-to-map hover resolves an experience against:
 * `markersRef.current.find(m => m.experienceId === expId)` returns undefined for
 * anything not built, and the hover handler then returns silently. So a marker
 * missing is not a marker missing — it is a row whose hover does nothing, with
 * no error and no clue.
 */
function makeExperience(id: number, overrides: Partial<Experience> = {}): Experience {
  return {
    id,
    name: `Experience ${id}`,
    category_name: 'UNESCO World Heritage Sites',
    longitude: 10 + id / 1000,
    latitude: 50 + id / 1000,
    location_count: 1,
    ...overrides,
  } as Experience;
}

function makeLocation(id: number, overrides: Partial<ExperienceLocation> = {}): ExperienceLocation {
  return {
    id,
    name: `Location ${id}`,
    longitude: 10,
    latitude: 50,
    ordinal: 0,
    in_region: true,
    ...overrides,
  } as ExperienceLocation;
}

describe('the point that stands for the row', () => {
  it('prefers one the source still lists over one waiting to be replaced', () => {
    // A point whose replacement is waiting to be published keeps its row and loses
    // its `ordinal` (ADR-0025 decision 5), and readers still see it. It must not
    // become the row's hover marker while a listed component is available: the ring
    // would sit on a place that disappears the moment a curator publishes.
    const exp = makeExperience(1, { location_count: 2 });
    const held = makeLocation(11, { ordinal: null, longitude: 1, latitude: 1 });
    const listed = makeLocation(12, { ordinal: 1, longitude: 2, latitude: 2 });

    const markers = buildExperienceMarkers([exp], { 1: [held, listed] }, new Set());

    expect(markers).toHaveLength(1);
    expect(markers[0].locationId).toBe(12);
  });

  it('still resolves a venue whose only point is waiting to be replaced', () => {
    // 1119 of 1604 experiences hold exactly one point, so mid-hold this is the
    // common shape. Preferring listed points must not mean building no marker —
    // that is a row whose hover does nothing, silently.
    const exp = makeExperience(2);
    const held = makeLocation(21, { ordinal: null });

    const markers = buildExperienceMarkers([exp], { 2: [held] }, new Set());

    expect(markers).toHaveLength(1);
    expect(markers[0].locationId).toBe(21);
    expect(markers[0].locationOrdinal).toBeNull();
  });
});

describe('buildExperienceMarkers', () => {
  it('builds a marker for every experience, past the hundredth', () => {
    // The regression: `experiences.slice(0, 100)`. Europe carries 200 in the
    // administrative mirror, so half the list hovered to nothing.
    const experiences = Array.from({ length: 200 }, (_, i) => makeExperience(i + 1));

    const markers = buildExperienceMarkers(experiences, {}, new Set());

    expect(markers).toHaveLength(200);
    expect(markers.some(m => m.experienceId === 101)).toBe(true);
    expect(markers.some(m => m.experienceId === 200)).toBe(true);
  });

  it('every experience is reachable by the lookup the hover uses', () => {
    const experiences = Array.from({ length: 150 }, (_, i) => makeExperience(i + 1));
    const markers = buildExperienceMarkers(experiences, {}, new Set());

    const unreachable = experiences
      .filter(exp => !markers.find(m => m.experienceId === exp.id))
      .map(exp => exp.id);

    expect(unreachable).toEqual([]);
  });

  it('places a marker at the first in-region location when locations are loaded', () => {
    const exp = makeExperience(1);
    const locations = {
      1: [
        makeLocation(10, { in_region: false, longitude: 1, latitude: 1 }),
        makeLocation(11, { longitude: 5, latitude: 6, name: 'In region' }),
      ],
    };

    const [marker] = buildExperienceMarkers([exp], locations, new Set());

    expect(marker.locationId).toBe(11);
    expect(marker.longitude).toBe(5);
    expect(marker.latitude).toBe(6);
    expect(marker.isMultiLocation).toBe(true);
  });

  it('falls back to the experience coordinates before locations load', () => {
    const exp = makeExperience(7, { longitude: 20, latitude: 30 });

    const [marker] = buildExperienceMarkers([exp], {}, new Set());

    expect(marker.locationId).toBeNull();
    expect(marker.longitude).toBe(20);
    expect(marker.latitude).toBe(30);
  });

  it('still builds a marker when every location is out of region', () => {
    // What a curator's manual assignment looks like: the experience is in the
    // region because someone put it there, and none of its locations are, which
    // is why they had to. Skipped, the row had no marker — so hovering it
    // painted nothing and left the previously hovered row's ring standing in
    // for it.
    const exp = makeExperience(1);
    const locations = {
      1: [
        makeLocation(10, { in_region: false, longitude: 3, latitude: 4 }),
        makeLocation(11, { in_region: false }),
      ],
    };

    const [marker, ...rest] = buildExperienceMarkers([exp], locations, new Set());

    expect(rest).toHaveLength(0);
    expect(marker.experienceId).toBe(1);
    expect(marker.locationId).toBe(10);
    expect(marker.longitude).toBe(3);
    // Recorded as out of region rather than pretended in.
    expect(marker.inRegion).toBe(false);
  });

  it('prefers an in-region location when there is one', () => {
    const exp = makeExperience(1);
    const locations = {
      1: [makeLocation(10, { in_region: false }), makeLocation(11, { longitude: 9 })],
    };

    const [marker] = buildExperienceMarkers([exp], locations, new Set());

    expect(marker.locationId).toBe(11);
    expect(marker.inRegion).toBe(true);
    expect(marker.locationCount).toBe(1);
  });

  it('falls back to the experience point when the location list is empty', () => {
    // `[]` is not `undefined`. Guarding on `!locations` alone dropped the row
    // with no marker and no error — the same silent shape as the out-of-region
    // skip, reached whenever the batch answers with nothing for an experience.
    const exp = makeExperience(3, { longitude: 12, latitude: 34 });

    const [marker, ...rest] = buildExperienceMarkers([exp], { 3: [] }, new Set());

    expect(rest).toHaveLength(0);
    expect(marker.experienceId).toBe(3);
    expect(marker.locationId).toBeNull();
    expect(marker.longitude).toBe(12);
  });

  it('honours the expanded category filter', () => {
    const shown = makeExperience(1, { category_name: 'Top Museums' });
    const hidden = makeExperience(2, { category_name: 'Public Art' });

    const markers = buildExperienceMarkers([shown, hidden], {}, new Set(['Top Museums']));

    expect(markers.map(m => m.experienceId)).toEqual([1]);
  });

  it('treats a point whose ordinal the payload omitted as unlisted, like the label does', () => {
    // Copilot's suppressed note, and it is a real case: `undefined !== null` is
    // true, so a strict check would read a missing ordinal as a listed component
    // and could hand a held point the hover ring — the thing this preference
    // exists to prevent. `locationLabel` has always used `== null`; this now
    // agrees with it.
    const markers = buildExperienceMarkers(
      [{ id: 1, name: 'Site', category_name: 'UNESCO World Heritage Sites' } as never],
      { 1: [
        { id: 10, experience_id: 1, longitude: 1, latitude: 1 } as never,
        { id: 11, experience_id: 1, ordinal: 2, longitude: 2, latitude: 2 } as never,
      ] },
      new Set(),
    );

    expect(markers.find(m => m.experienceId === 1)?.locationId).toBe(11);
  });
});
