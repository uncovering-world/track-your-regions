/**
 * Builds the marker set the map renders — one point per place a reader may go
 * to, in-region when the object has any there. Below the heatmap threshold the
 * same set is what the density is computed from, so the heat now says where the
 * *places* are rather than where their objects were pinned.
 *
 * A module of its own so it can be exercised without a map. The marker set is a
 * pure function of the experiences, their locations and which kind groups are
 * expanded, and it is what the list-to-map hover resolves an experience against
 * — a marker that is not built is a row whose hover does nothing.
 */

import type { Experience, ExperienceLocation } from '../../api/experiences';
import { experienceColor } from '../../utils/kindColors';
import { pinLabel } from '../../utils/locationLabel';

const NO_KIND_TYPES: ReadonlyMap<string, string> = new Map();

/**
 * The places an object is drawn as: the ones in this region, or all of them when
 * none is.
 *
 * Every surface asks this — the builder, the highlight layer, the fly-to, the
 * list's view filter — and each answering it privately is how they drift apart:
 * an object with five places of which one is in region draws one pin, and a
 * fly-to that framed all five would take the reader away from it.
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
  const inRegion = locations.filter(loc => loc.in_region);
  return inRegion.length > 0 ? inRegion : locations;
}

export interface MarkerData {
  id: string;
  experienceId: number;
  locationId: number | null;
  experience: Experience;
  longitude: number;
  latitude: number;
  locationName: string | null;
  /** The point a pin draws as itself, for its own picture (#1270); null for a pin at a place's own coordinate. */
  location?: ExperienceLocation | null;
  /**
   * The colour of each kind this pin shows, in the kinds' display order: the
   * place's kinds among those the surface is showing (#1262). One colour is a
   * plain pin; two or more different ones draw a disc split into one slice per
   * kind (`scene.ts`, `splitPinIconFor`).
   */
  kindColors?: string[];
}

/**
 * The kinds of a place a pin shows, in display order: those among the kinds the
 * surface is showing — one kind where it shows one (Discover's `?kind=`), the
 * open groups' where some are open (Map mode), and every kind of the place
 * otherwise. A row with no `kinds` field, cached from before the field, shows
 * its own; one with an empty list is on no map (#1275) and shows none.
 */
function shownKinds(
  exp: Experience,
  shownKindNames: Set<string>,
  onlyKindId: number | null,
  kindTypes: ReadonlyMap<string, string>,
): Array<{ kind_id: number; type: string | null }> {
  const kinds = exp.kinds ?? [{ kind_id: exp.kind_id, kind_name: exp.kind_name || 'Experiences', type: exp.type }];
  if (onlyKindId !== null) return kinds.filter(kind => kind.kind_id === onlyKindId);
  // A kind narrowed to one type in the list (#589) shows the place only as that type.
  const ofItsType = (kind: { kind_name: string; type: string | null }) =>
    !kindTypes.has(kind.kind_name) || kindTypes.get(kind.kind_name) === kind.type;
  if (shownKindNames.size > 0) return kinds.filter(kind => shownKindNames.has(kind.kind_name) && ofItsType(kind));
  return kinds.filter(ofItsType);
}

/**
 * The pin of a place whose points the region's batch does not hold — not loaded
 * yet, or loaded and empty for this row — at the place's own coordinate. `[]`
 * is not `undefined`, so a guard on `!locations` alone dropped such a row with
 * no marker and no error, which is a row whose hover does nothing.
 *
 * None for an object made of parts: it has no coordinate a traveller can go to
 * (#2122), only its parts, and they are drawn once the batch holds them.
 */
function standInMarkers(exp: Experience): Omit<MarkerData, 'kindColors'>[] {
  if (exp.has_parts) return [];
  return [{
    id: String(exp.id),
    experienceId: exp.id,
    locationId: null,
    experience: exp,
    longitude: exp.longitude,
    latitude: exp.latitude,
    locationName: null,
  }];
}

/**
 * A pin per place, which is what an object is (ADR-0028 decision 1). Drawing one
 * of them made Gondwana's forty components a single dot a reader had to click to
 * learn anything from, and which dot that was — the lowest-ordinal in-region
 * place — was a question the builder had to answer and nobody could see.
 */
function placeMarkers(exp: Experience, places: ExperienceLocation[], objectPoints: number): Omit<MarkerData, 'kindColors'>[] {
  return places.map(loc => ({
    id: `${exp.id}-${loc.id}`,
    experienceId: exp.id,
    locationId: loc.id,
    experience: exp,
    longitude: loc.longitude,
    latitude: loc.latitude,
    // The one rule a pin and a highlight dot share (#1268).
    locationName: pinLabel(loc, objectPoints),
    location: loc,
  }));
}

export function buildExperienceMarkers(
  experiences: Experience[],
  locationsByExperience: Record<number, ExperienceLocation[]>,
  expandedKindNames: Set<string>,
  onlyKindId: number | null = null,
  kindTypes: ReadonlyMap<string, string> = NO_KIND_TYPES,
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
    // One pin per place, drawn while any of its kinds is shown, in the colours
    // of the kinds it shows (#1245, #1262).
    const kinds = shownKinds(exp, expandedKindNames, onlyKindId, kindTypes);
    if (kinds.length === 0) continue;
    const kindColors = kinds.map(kind => experienceColor(kind.kind_id, kind.type));

    const locations = locationsByExperience[exp.id];
    const pins = locations?.length
      ? placeMarkers(exp, representablePlaces(locations), locations.length)
      : standInMarkers(exp);
    for (const pin of pins) result.push({ ...pin, kindColors });
  }

  return result;
}
