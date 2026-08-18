/**
 * Builds the marker set the map renders — one point per place a reader may go
 * to, in-region when the object has any there. Below the heatmap threshold the
 * same set is what the density is computed from, so the heat now says where the
 * *places* are rather than where their objects were pinned.
 *
 * A module of its own so it can be exercised without a map. The marker set is a
 * pure function of the experiences, their locations, which category groups are
 * expanded and which objects this reader folded, and it is what the list-to-map
 * hover resolves an experience against — a marker that is not built is a row
 * whose hover does nothing.
 */

import type { Experience, ExperienceLocation } from '../../api/experiences';

/** Shared empty set, so a caller with nothing collapsed allocates nothing. */
const EMPTY_COLLAPSED: ReadonlySet<number> = new Set<number>();

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
  /**
   * This pin is one the reader folded, and a click on it unfolds.
   *
   * Stated rather than inferred. "No `locationId` and a count above one" also
   * describes a stand-in pin — an object whose places the batch does not hold,
   * because they are all lost, all pending for a curator, or simply not fetched
   * yet — and a surface that counts a different set can put such an object in the
   * folded set. A click would then unfold something that was never drawn folded:
   * the fold drops, nothing is selected, and the click visibly does nothing.
   */
  folded?: boolean;
}

/**
 * One pin for an object whose places the region's batch does not hold — not
 * loaded yet, or loaded and empty for this row. `[]` is not `undefined`, so a
 * guard on `!locations` alone dropped such a row with no marker and no error,
 * which is a row whose hover does nothing. It carries the object's own count
 * because it genuinely stands in for places it is not drawing.
 */
function standInMarker(exp: Experience): MarkerData {
  return {
    id: String(exp.id),
    experienceId: exp.id,
    locationId: null,
    experience: exp,
    longitude: exp.longitude,
    latitude: exp.latitude,
    locationName: null,
    locationCount: exp.location_count ?? 1,
  };
}

/**
 * One pin for an object this reader asked to see as one, at the coordinate the
 * catalogue answers with — the place nearest the object's own published point
 * (ADR-0028 decision 2), which is what the row, the card and Discover already
 * use. Collapsing therefore moves the object to a place it is already said to be
 * at rather than inventing a centre for it, and the badge is what tells this pin
 * apart from an object that simply has one place.
 */
function collapsedMarker(exp: Experience, places: number): MarkerData {
  return {
    id: `${exp.id}-collapsed`,
    experienceId: exp.id,
    locationId: null,
    experience: exp,
    longitude: exp.longitude,
    latitude: exp.latitude,
    locationName: null,
    locationCount: places,
    folded: true,
  };
}

/**
 * A pin per place, which is what an object is (ADR-0028 decision 1). Drawing one
 * of them made Gondwana's forty components a single dot a reader had to click to
 * learn anything from, and which dot that was — the lowest-ordinal in-region
 * place — was a question the builder had to answer and nobody could see. Each
 * pin stands for itself alone, so none carries a count.
 */
function placeMarkers(exp: Experience, places: ExperienceLocation[]): MarkerData[] {
  return places.map(loc => ({
    id: `${exp.id}-${loc.id}`,
    experienceId: exp.id,
    locationId: loc.id,
    experience: exp,
    longitude: loc.longitude,
    latitude: loc.latitude,
    locationName: loc.name,
    locationCount: 1,
  }));
}

export function buildExperienceMarkers(
  experiences: Experience[],
  locationsByExperience: Record<number, ExperienceLocation[]>,
  expandedCategoryNames: Set<string>,
  collapsedExperienceIds: ReadonlySet<number> = EMPTY_COLLAPSED,
): MarkerData[] {
  const result: MarkerData[] = [];

  // No cap. A cap silently breaks the list-to-map hover for everything past it:
  // the highlight resolves an experience through this set and returns without a
  // sound when it is absent. A region with 200 experiences had hover working for
  // the first hundred rows and doing nothing at all for the rest.
  //
  // The heatmap is what makes the full set affordable to *render* below its
  // threshold; above it every place is drawn as its own marker. Hover costs one
  // scan of this array either way — it resolves markers directly rather than
  // searching what the map currently draws.
  for (const exp of experiences) {
    const categoryName = exp.category_name || 'Experiences';
    if (expandedCategoryNames.size > 0 && !expandedCategoryNames.has(categoryName)) continue;

    const locations = locationsByExperience[exp.id];
    if (!locations || locations.length === 0) {
      result.push(standInMarker(exp));
      continue;
    }

    const representable = representablePlaces(locations);

    if (collapsedExperienceIds.has(exp.id) && representable.length > 1) {
      result.push(collapsedMarker(exp, representable.length));
    } else {
      result.push(...placeMarkers(exp, representable));
    }
  }

  return result;
}
