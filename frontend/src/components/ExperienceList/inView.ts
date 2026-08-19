/**
 * Which experiences the map is currently showing (#553).
 *
 * The list answered a different question from the map: it listed the region
 * alphabetically, so a reader zoomed into Prague read a list running from
 * *Historic Centre of Prague* to *Wikipedia Monument* — 661 objects for Europe,
 * ordered by their initials. This is the join that lets it answer "what is here".
 *
 * It asks the same points the map draws, deliberately. `representablePlaces` is
 * the marker builder's own rule (in-region places, or every place when none of
 * them is in this region), and an object whose places this batch does not hold
 * is drawn at its own coordinate — the stand-in pin. Anything else would let the
 * list hide a pin the reader can see, which is the failure this replaces rather
 * than a smaller version of it.
 *
 * No fetch runs here: the region arrives whole and its locations arrive in one
 * batch, so this is a pass over memory — 3725 locations for Europe, on the order
 * of 0.1 ms.
 */

import type { Experience, ExperienceLocation } from '../../api/experiences';
import { representablePlaces } from '../experienceMarkers/buildMarkers';
import { pointInView, type ViewBounds } from '../../utils/viewBounds';

/**
 * The ids of the experiences with at least one drawn point inside the view.
 *
 * Any point, not all of them: a serial nomination — the Rock Art of the
 * Mediterranean Basin draws 734 shelters in Europe — is here as soon as one of
 * them is on screen, which is what a planner looking at a city means by "here". Unless the reader folded it, in which case the map draws that object as
 * one pin and this follows the pin.
 *
 * The three branches are `buildExperienceMarkers`' three, in its order, because
 * agreeing with the map is the whole point of this module.
 */
export function experienceIdsInView(
  experiences: Experience[],
  locationsByExperience: Record<number, ExperienceLocation[]>,
  bounds: ViewBounds,
  /** What this reader folded back into a single pin, at the object's own point. */
  collapsedExperienceIds: ReadonlySet<number> = new Set<number>(),
): Set<number> {
  const ids = new Set<number>();
  for (const exp of experiences) {
    const locations = locationsByExperience[exp.id];
    const places = representablePlaces(locations);
    // Two ways an object is drawn at its own coordinate rather than at its
    // places: the stand-in pin, when this batch holds none of them, and a fold —
    // which the builder honours only where folding is a question at all, since
    // one drawn place is one pin either way.
    const drawnAsOnePin = places.length === 0
      || (collapsedExperienceIds.has(exp.id) && places.length > 1);
    if (drawnAsOnePin) {
      if (pointInView(exp.longitude, exp.latitude, bounds)) ids.add(exp.id);
      continue;
    }
    if (places.some(loc => pointInView(loc.longitude, loc.latitude, bounds))) ids.add(exp.id);
  }
  return ids;
}
