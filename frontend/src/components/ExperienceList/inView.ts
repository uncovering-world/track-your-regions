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
 * them is on screen, which is what a planner looking at a city means by "here".
 *
 * The branches are `buildExperienceMarkers`' own, because agreeing with the map
 * is the whole point of this module: a place's own coordinate while the batch
 * holds none of its points, and nothing at all for an object made of parts
 * then (#2122) — which no view can leave out, as a missing view leaves out
 * nothing.
 */
export function experienceIdsInView(
  experiences: Experience[],
  locationsByExperience: Record<number, ExperienceLocation[]>,
  bounds: ViewBounds,
): Set<number> {
  const ids = new Set<number>();
  for (const exp of experiences) {
    const places = representablePlaces(locationsByExperience[exp.id]);
    const inView = places.length > 0
      ? places.some(loc => pointInView(loc.longitude, loc.latitude, bounds))
      : exp.has_parts || pointInView(exp.longitude, exp.latitude, bounds);
    if (inView) ids.add(exp.id);
  }
  return ids;
}
