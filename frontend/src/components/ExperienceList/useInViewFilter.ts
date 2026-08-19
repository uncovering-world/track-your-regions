/**
 * The list's half of #553: which rows the map's view leaves, and the way back.
 *
 * A hook rather than a block inside `ExperienceList` because it carries four
 * decisions of its own — what the view holds, what it hides, whether the counts
 * should say "of N", and whether this reader has asked for the region back — and
 * the component that renders the rows is already at the complexity the linter
 * allows.
 */

import { useMemo, useState } from 'react';
import type { Experience, ExperienceLocation } from '../../api/experiences';
import { experienceIdsInView } from './inView';
import type { ViewBounds } from '../../utils/viewBounds';

export interface InViewFilter {
  /** The rows to render: the view's, or the region's when the reader asked. */
  listedExperiences: Experience[];
  /** How many of the region's the view is hiding — zero when it hides nothing. */
  outsideView: number;
  /** True while the rows are a subset, which is what makes "12 of 47" worth printing. */
  isFiltered: boolean;
  /** Whether this reader has asked for the whole region back, in this region. */
  showWholeRegion: boolean;
  toggleWholeRegion: () => void;
  /** Each category's whole-region count, for the "of N" half of a header. */
  totalByCategory: Map<string, number>;
}

export function useInViewFilter(
  activeExperiences: Experience[],
  locationsByExperience: Record<number, ExperienceLocation[]>,
  viewBounds: ViewBounds | null,
  regionId: number | null,
  /**
   * The open row, which stays listed wherever the camera goes.
   *
   * A reader who opened a row is reading it; a pan that drifts its last pin off
   * screen would close what they are in the middle of, and the row carries the
   * only control that takes them back to it.
   */
  selectedExperienceId: number | null,
  /** What this reader folded: the map draws each of those as one pin. */
  collapsedExperienceIds: ReadonlySet<number>,
): InViewFilter {
  // Stored as *which region* the ask was made in, the same shape as `showLost`
  // in the context and for the same reason: it answers "let me see the rest of
  // this place", a question about this place rather than a standing preference,
  // and an effect-based reset leaves one render where the flag belongs to the
  // region before.
  const [shownFor, setShownFor] = useState<number | null>(null);
  const showWholeRegion = shownFor !== null && shownFor === regionId;

  const idsInView = useMemo(
    () => (viewBounds
      ? experienceIdsInView(activeExperiences, locationsByExperience, viewBounds, collapsedExperienceIds)
      : null),
    [viewBounds, activeExperiences, locationsByExperience, collapsedExperienceIds],
  );

  const totalByCategory = useMemo(() => {
    const totals = new Map<string, number>();
    for (const exp of activeExperiences) {
      const name = exp.category_name || 'Experiences';
      totals.set(name, (totals.get(name) ?? 0) + 1);
    }
    return totals;
  }, [activeExperiences]);

  const isFiltered = idsInView !== null && !showWholeRegion;
  const listedExperiences = useMemo(
    () => (isFiltered && idsInView
      ? activeExperiences.filter(exp => idsInView.has(exp.id) || exp.id === selectedExperienceId)
      : activeExperiences),
    [isFiltered, idsInView, activeExperiences, selectedExperienceId],
  );

  // What the view is hiding, which is not the same as what it does not hold: the
  // open row is listed even when its last pin has drifted off screen, so counting
  // it as hidden would offer to bring back something already on the page — at
  // worst "1 more in this region — show it" above the very row it means.
  //
  // Derived from `idsInView` rather than from `listedExperiences.length`, so it
  // stays true while the reader is looking at the whole region: that is when the
  // notice offers to hide it again, and a zero would take the way back away.
  const exemptedFromView = idsInView !== null
    && selectedExperienceId !== null
    && !idsInView.has(selectedExperienceId)
    && activeExperiences.some(exp => exp.id === selectedExperienceId)
    ? 1 : 0;

  return {
    listedExperiences,
    outsideView: idsInView ? activeExperiences.length - idsInView.size - exemptedFromView : 0,
    isFiltered,
    showWholeRegion,
    toggleWholeRegion: () => setShownFor(showWholeRegion ? null : regionId),
    totalByCategory,
  };
}
