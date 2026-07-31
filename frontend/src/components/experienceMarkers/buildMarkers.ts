/**
 * Builds the marker set the clustered source renders — one point per experience,
 * at its primary in-region location.
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
  // Clustering is what makes the full set affordable to *render* — it does not
  // bound the hover path, which walks every leaf of every rendered cluster
  // (`paintClusterRingForExperience`). That scan used to be capped at a hundred
  // points and is now proportional to the region. Fine at 200; the thing to
  // watch if a region grows an order of magnitude.
  for (const exp of experiences) {
    const categoryName = exp.category_name || 'Experiences';
    if (expandedCategoryNames.size > 0 && !expandedCategoryNames.has(categoryName)) continue;

    const locations = locationsByExperience[exp.id];

    if (locations && locations.length > 0) {
      // Use the first in-region location as the representative point
      const inRegionLocations = locations.filter(loc => loc.in_region !== false);
      const primaryLoc = inRegionLocations[0];
      if (primaryLoc) {
        result.push({
          id: `${exp.id}-${primaryLoc.id}`,
          experienceId: exp.id,
          locationId: primaryLoc.id,
          experience: exp,
          longitude: primaryLoc.longitude,
          latitude: primaryLoc.latitude,
          locationName: primaryLoc.name,
          locationCount: inRegionLocations.length,
          isMultiLocation: locations.length > 1,
          locationOrdinal: primaryLoc.ordinal,
          inRegion: true,
        });
      }
    } else if (!locations) {
      // Locations not yet loaded — use experience's own coordinates
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
