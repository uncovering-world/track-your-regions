/**
 * Builds the marker set the map renders — one point per experience, at its
 * primary location, in-region when it has one. Below the heatmap threshold the
 * same set is what the density is computed from.
 *
 * A module of its own so it can be exercised without a map. The marker set is a
 * pure function of the experiences, their locations and which category groups
 * are expanded, and it is what the list-to-map hover resolves an experience
 * against — a marker that is not built is a row whose hover does nothing.
 */

import type { Experience, ExperienceLocation } from '../../api/experiences';

export interface MarkerData {
  id: string;
  experienceId: number;
  locationId: number | null;
  experience: Experience;
  longitude: number;
  latitude: number;
  locationName: string | null;
  locationCount: number;
  isMultiLocation: boolean;
  locationOrdinal: number;
  inRegion: boolean;
}

export function buildExperienceMarkers(
  experiences: Experience[],
  locationsByExperience: Record<number, ExperienceLocation[]>,
  expandedCategoryNames: Set<string>,
): MarkerData[] {
  const result: MarkerData[] = [];

  // No cap. A cap silently breaks the list-to-map hover for everything past it:
  // the highlight resolves an experience through this set and returns without a
  // sound when it is absent. A region with 200 experiences had hover working for
  // the first hundred rows and doing nothing at all for the rest.
  //
  // The heatmap is what makes the full set affordable to *render* below its
  // threshold; above it every experience is drawn as its own marker. Hover costs
  // one lookup in this array either way — it resolves the marker directly rather
  // than searching what the map currently draws.
  for (const exp of experiences) {
    const categoryName = exp.category_name || 'Experiences';
    if (expandedCategoryNames.size > 0 && !expandedCategoryNames.has(categoryName)) continue;

    const locations = locationsByExperience[exp.id];

    if (locations && locations.length > 0) {
      // Prefer an in-region location; fall back to any of them when none is.
      // Every location being out of region is what a curator's manual assignment
      // looks like — `assignExperienceToRegion` writes experience_regions and
      // nothing else, and the reason to assign by hand is that spatial
      // containment missed the point. Skipping those left the row with no marker
      // at all, so hovering it painted nothing and left the previous row's ring
      // lit in its place. `ExperienceMarkers` already falls back this way when
      // fitting the map to an experience.
      const inRegionLocations = locations.filter(loc => loc.in_region !== false);
      const representable = inRegionLocations.length > 0 ? inRegionLocations : locations;
      const primaryLoc = representable[0];
      if (primaryLoc) {
        result.push({
          id: `${exp.id}-${primaryLoc.id}`,
          experienceId: exp.id,
          locationId: primaryLoc.id,
          experience: exp,
          longitude: primaryLoc.longitude,
          latitude: primaryLoc.latitude,
          locationName: primaryLoc.name,
          locationCount: representable.length,
          isMultiLocation: locations.length > 1,
          locationOrdinal: primaryLoc.ordinal,
          inRegion: inRegionLocations.length > 0,
        });
      }
    } else {
      // No usable location: either not loaded yet, or loaded and empty. `[]` is
      // not `undefined`, so an `else if (!locations)` here would drop the row
      // silently — the same shape as the out-of-region skip above, and with the
      // same consequence: hover cannot resolve it through markersRef.
      result.push({
        id: String(exp.id),
        experienceId: exp.id,
        locationId: null,
        experience: exp,
        longitude: exp.longitude,
        latitude: exp.latitude,
        locationName: null,
        locationCount: exp.location_count ?? 1,
        isMultiLocation: false,
        locationOrdinal: 0,
        inRegion: true,
      });
    }
  }

  return result;
}
