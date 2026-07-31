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

  it('honours the expanded category filter', () => {
    const shown = makeExperience(1, { category_name: 'Top Museums' });
    const hidden = makeExperience(2, { category_name: 'Public Art' });

    const markers = buildExperienceMarkers([shown, hidden], {}, new Set(['Top Museums']));

    expect(markers.map(m => m.experienceId)).toEqual([1]);
  });
});
