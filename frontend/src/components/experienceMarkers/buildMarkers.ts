/**
 * Builds the marker set the map renders — one point per place a reader may go
 * to, in-region when the object has any there. Below the heatmap threshold the
 * same set is what the density is computed from, so the heat now says where the
 * *places* are rather than where their objects were pinned.
 *
 * A module of its own so it can be exercised without a map. The marker set is a
 * pure function of the experiences, their locations and which category groups
 * are expanded, and it is what the list-to-map hover resolves an experience
 * against — a marker that is not built is a row whose hover does nothing.
 */

import type { Experience, ExperienceLocation } from '../../api/experiences';

/**
 * The places an object is drawn as: the ones in this region, or all of them when
 * none is.
 *
 * Every surface asks this — the builder, the highlight layer, the fold control,
 * the list's chip — and each answering it privately is how they drift apart. An
 * object with five places of which one is in region draws one pin; a chip that
 * counted five would offer to fold a single pin into a single pin, and the
 * builder would ignore the fold while the highlight honoured it.
 *
 * Everything out of region is what a curator's hand assignment looks like:
 * `assignExperienceToRegion` writes `experience_regions` and nothing else, and
 * the reason to assign by hand is that spatial containment missed the point.
 * Drawing nothing for those left the row without a marker, so hovering it painted
 * nothing and left the previous row's ring standing in for it.
 */
export function representablePlaces(
  locations: ExperienceLocation[] | undefined,
): ExperienceLocation[] {
  if (!locations || locations.length === 0) return [];
  const inRegion = locations.filter(loc => loc.in_region !== false);
  return inRegion.length > 0 ? inRegion : locations;
}

/**
 * Whether folding is a question for this object at all. One drawn place folds to
 * one pin, which is the pin it already is — offering it would be a control that
 * does nothing, and a click on the resulting ordinary pin would unfold rather
 * than select.
 */
export function isFoldable(locations: ExperienceLocation[] | undefined): boolean {
  return representablePlaces(locations).length > 1;
}

export interface MarkerData {
  id: string;
  experienceId: number;
  locationId: number | null;
  experience: Experience;
  longitude: number;
  latitude: number;
  locationName: string | null;
  /**
   * How many places this pin stands for — 1 for a place drawn as itself, and the
   * whole count only for a pin standing in for places it does not draw. That is
   * what the count badge is filtered on (`locationCount > 1`), so the badge says
   * "there is more here than this dot" rather than repeating an object's total
   * on every one of its parts.
   */
  locationCount: number;
  /** Null where the source no longer lists this point — see `locationLabel`. */
  locationOrdinal: number | null;
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
      const representable = representablePlaces(locations);
      const inRegion = locations.some(loc => loc.in_region !== false);
      // Every one of them, not the first: a serial site *is* its parts (ADR-0028
      // decision 1), and drawing one of them made Gondwana's forty components a
      // single dot the reader had to click to learn anything from. Which one that
      // dot was is no longer a question anybody has to answer, so the ordinal
      // preference this used to carry — a held point sorts last, so it was picked
      // only when alone — has nothing left to decide.
      for (const loc of representable) {
        result.push({
          id: `${exp.id}-${loc.id}`,
          experienceId: exp.id,
          locationId: loc.id,
          experience: exp,
          longitude: loc.longitude,
          latitude: loc.latitude,
          locationName: loc.name,
          // A place drawn as itself stands for itself alone, so no badge.
          locationCount: 1,
          locationOrdinal: loc.ordinal,
          inRegion,
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
        // This one *is* standing in for places it does not draw — the region's
        // batch holds none of them — so it keeps the badge saying how many.
        locationCount: exp.location_count ?? 1,
        locationOrdinal: 0,
        inRegion: true,
      });
    }
  }

  return result;
}
