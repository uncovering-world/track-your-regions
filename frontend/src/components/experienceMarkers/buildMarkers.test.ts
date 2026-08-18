import { describe, it, expect } from 'vitest';
import { buildExperienceMarkers, isFoldable } from './buildMarkers';
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

describe('an object the reader asked to see as one pin', () => {
  it('draws one pin, at the coordinate the catalogue answers with', () => {
    // ADR-0028 decision 2: the place nearest the object's own published point,
    // which is what the row and Discover already show. Collapsing must not invent
    // a centre — a centroid of scattered parts can land in open water, which is
    // why `resolveMainPoint` rejected one for the anchor in the first place.
    const exp = makeExperience(1, { longitude: 7.5, latitude: 45.5, location_count: 3 });
    const locations = {
      1: [makeLocation(11, { longitude: 1, latitude: 1 }), makeLocation(12), makeLocation(13)],
    };

    const markers = buildExperienceMarkers([exp], locations, new Set(), new Set([1]));

    expect(markers).toHaveLength(1);
    expect([markers[0].longitude, markers[0].latitude]).toEqual([7.5, 45.5]);
    // The badge, which is the only thing telling this from a single-placed object.
    expect(markers[0].locationCount).toBe(3);
    expect(markers[0].locationId).toBeNull();
  });

  it('leaves every other object alone', () => {
    // Per object, never a mode: a reader looking at forty parts of one site wants
    // that site as one pin and the rest of the region untouched.
    const collapsed = makeExperience(1, { location_count: 2 });
    const other = makeExperience(2, { location_count: 2 });
    const locations = {
      1: [makeLocation(11), makeLocation(12)],
      2: [makeLocation(21), makeLocation(22)],
    };

    const markers = buildExperienceMarkers([collapsed, other], locations, new Set(), new Set([1]));

    expect(markers.filter(m => m.experienceId === 1)).toHaveLength(1);
    expect(markers.filter(m => m.experienceId === 2)).toHaveLength(2);
  });

  it('says so on the pin, rather than leaving it to be inferred', () => {
    // "No locationId and a count above one" also describes a *stand-in* pin — an
    // object whose places the batch does not hold because they are all lost, all
    // pending for a curator, or simply not fetched yet. A surface that counts a
    // different set can put such an object in the folded set, and a click that
    // unfolded it would drop the fold, select nothing and visibly do nothing.
    const folded = buildExperienceMarkers(
      [makeExperience(1, { location_count: 2 })],
      { 1: [makeLocation(11), makeLocation(12)] },
      new Set(), new Set([1]),
    );
    const standIn = buildExperienceMarkers(
      [makeExperience(2, { location_count: 40 })], {}, new Set(), new Set([2]));

    expect(folded[0].folded).toBe(true);
    expect(standIn[0].folded).toBeUndefined();
    // The two are otherwise the same shape, which is the point.
    expect(standIn[0].locationId).toBeNull();
    expect(standIn[0].locationCount).toBe(40);
  });

  it('changes nothing for an object drawing one pin out of several places', () => {
    // The boundary that cost this branch a bug, and it is not "one location": an
    // object with three places of which one is in region *draws* one pin, so
    // folding it can change nothing. When the chip gated on the total and the
    // builder on the drawn count, the chip offered a fold the builder ignored,
    // and a click on the resulting ordinary pin unfolded instead of selecting.
    const exp = makeExperience(1, { location_count: 3 });
    const locations = {
      1: [
        makeLocation(11, { in_region: false, longitude: 1, latitude: 1 }),
        makeLocation(12, { longitude: 5, latitude: 6 }),
        makeLocation(13, { in_region: false, longitude: 7, latitude: 8 }),
      ],
    };

    const markers = buildExperienceMarkers([exp], locations, new Set(), new Set([1]));

    expect(markers).toHaveLength(1);
    expect(markers[0].locationId).toBe(12);
    expect(markers[0].folded).toBeUndefined();
    expect(isFoldable(locations[1])).toBe(false);
  });

  it('changes nothing for an object with a single place', () => {
    // Collapsing one place to one pin would only cost it its own name and hand it
    // a badge saying 1, which the badge layer reads as "there is more here".
    const exp = makeExperience(1);
    const markers = buildExperienceMarkers([exp], { 1: [makeLocation(11, { name: 'The place' })] },
      new Set(), new Set([1]));

    expect(markers).toHaveLength(1);
    expect(markers[0].locationId).toBe(11);
    expect(markers[0].locationCount).toBe(1);
    expect(markers[0].locationName).toBe('The place');
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

    // Every one of them, out of region or not: skipping them left the row with
    // no marker at all, and its hover painting nothing.
    expect(markers.map(m => m.locationId)).toEqual([10, 11]);
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
