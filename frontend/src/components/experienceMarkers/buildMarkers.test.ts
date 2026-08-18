import { describe, it, expect } from 'vitest';
import { buildExperienceMarkers } from './buildMarkers';
import type { Experience, ExperienceLocation } from '../../api/experiences';

/**
 * The marker set is what the list-to-map hover resolves an experience against:
 * `markersRef.current.filter(m => m.experienceId === expId)` returns nothing for
 * anything not built, and the hover handler then returns silently. So a marker
 * missing is not a marker missing — it is a row whose hover does nothing, with
 * no error and no clue.
 *
 * Since #558 the set holds one marker per *place* rather than one per object.
 * Measured on Europe with the UNESCO category expanded, the set both surfaces
 * were reading: its 467 objects drew 467 markers and now draw 3463. The region as
 * a whole holds 661 offered objects over 3725 visible places in the database, of
 * which 3531 are UNESCO's — the app draws fewer than the raw count because an
 * object with any in-region place draws only those. The Rock Art of the
 * Mediterranean Basin contributes 734 of the 3463 and the Frontiers of the Roman
 * Empire 420: the two rows the per-object fold exists for.
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

describe('an object made of several places', () => {
  it('draws every one of them', () => {
    // ADR-0028 decision 1: a surface that can draw more than one point draws the
    // object's places. Before this, forty components of Gondwana were one dot a
    // reader had to click to learn there was anything else.
    const exp = makeExperience(1, { location_count: 3 });
    const locations = {
      1: [
        makeLocation(11, { longitude: 1, latitude: 1 }),
        makeLocation(12, { longitude: 2, latitude: 2 }),
        makeLocation(13, { longitude: 3, latitude: 3 }),
      ],
    };

    const markers = buildExperienceMarkers([exp], locations, new Set());

    expect(markers.map(m => m.locationId)).toEqual([11, 12, 13]);
    expect(markers.map(m => m.longitude)).toEqual([1, 2, 3]);
    // Every marker still names its object, which is what the hover resolves and
    // what makes forty pins one row rather than forty.
    expect(markers.every(m => m.experienceId === 1)).toBe(true);
  });

  it('gives each place its own identity, so no two features share an id', () => {
    // The map keys features by this: two markers carrying one id is a source
    // whose points cannot be told apart by anything reading a rendered feature.
    const exp = makeExperience(1);
    const markers = buildExperienceMarkers(
      [exp], { 1: [makeLocation(11), makeLocation(12)] }, new Set());

    expect(new Set(markers.map(m => m.id)).size).toBe(2);
  });

  it('draws a point waiting to be replaced beside the one that will replace it', () => {
    // A point whose replacement is waiting to be published keeps its row and
    // loses its `ordinal` (ADR-0025 decision 5), and readers still see it. It
    // used to be *excluded* from standing for the row, because one dot could only
    // be one place and a dot about to disappear was the wrong one. Drawing every
    // place removes that choice: both are shown, each as itself.
    const exp = makeExperience(1, { location_count: 2 });
    const held = makeLocation(11, { ordinal: null, longitude: 1, latitude: 1 });
    const listed = makeLocation(12, { ordinal: 1, longitude: 2, latitude: 2 });

    const markers = buildExperienceMarkers([exp], { 1: [held, listed] }, new Set());

    expect(markers.map(m => m.locationId)).toEqual([11, 12]);
    expect(markers.map(m => m.locationOrdinal)).toEqual([null, 1]);
  });

  it('carries no count on a place drawn as itself, and the count on a pin standing in', () => {
    // What the badge means, and it is the one thing that tells a collapsed object
    // from a single-placed one: this pin stands for more than the dot you see.
    const drawn = buildExperienceMarkers(
      [makeExperience(1, { location_count: 2 })],
      { 1: [makeLocation(11), makeLocation(12)] },
      new Set(),
    );
    const standingIn = buildExperienceMarkers(
      [makeExperience(2, { location_count: 40 })], {}, new Set());

    expect(drawn.map(m => m.locationCount)).toEqual([1, 1]);
    expect(standingIn[0].locationCount).toBe(40);
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

  it('draws the places in this region and leaves the ones outside it out', () => {
    const exp = makeExperience(1, { location_count: 2 });
    const locations = {
      1: [
        makeLocation(10, { in_region: false, longitude: 1, latitude: 1 }),
        makeLocation(11, { longitude: 5, latitude: 6, name: 'In region' }),
      ],
    };

    const markers = buildExperienceMarkers([exp], locations, new Set());

    expect(markers.map(m => m.locationId)).toEqual([11]);
    expect(markers[0].longitude).toBe(5);
    expect(markers[0].inRegion).toBe(true);
  });

  it('falls back to the experience coordinates before locations load', () => {
    const exp = makeExperience(7, { longitude: 20, latitude: 30 });

    const [marker] = buildExperienceMarkers([exp], {}, new Set());

    expect(marker.locationId).toBeNull();
    expect(marker.longitude).toBe(20);
    expect(marker.latitude).toBe(30);
  });

  it('still draws an experience whose every place is out of region', () => {
    // What a curator's manual assignment looks like: the experience is in the
    // region because someone put it there, and none of its locations are, which
    // is why they had to. Skipped, the row had no marker — so hovering it
    // painted nothing and left the previously hovered row's ring standing in
    // for it.
    const exp = makeExperience(1, { location_count: 2 });
    const locations = {
      1: [
        makeLocation(10, { in_region: false, longitude: 3, latitude: 4 }),
        makeLocation(11, { in_region: false, longitude: 7, latitude: 8 }),
      ],
    };

    const markers = buildExperienceMarkers([exp], locations, new Set());

    expect(markers.map(m => m.locationId)).toEqual([10, 11]);
    // Recorded as out of region rather than pretended in.
    expect(markers.every(m => m.inRegion === false)).toBe(true);
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

    const markers = buildExperienceMarkers([shown, hidden], {}, new Set());
    const filtered = buildExperienceMarkers([shown, hidden], {}, new Set(['Top Museums']));

    expect(markers.map(m => m.experienceId)).toEqual([1, 2]);
    expect(filtered.map(m => m.experienceId)).toEqual([1]);
  });
});
