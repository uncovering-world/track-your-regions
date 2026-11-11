/**
 * The groups a place's circle lists its neighbours in (#2420), with the words
 * the list, the map's legend and each dot's hover share. The button on the
 * card counts every place of the type within the radius, so the circle names
 * every one of them:
 * - **better known**: what the rule compares the place with (`compared`),
 *   whatever the place's own score, so a neighbour a curator keeps on the
 *   list counts above a place not measured yet too;
 * - **better known, not counted**: measured above it, and left out of the
 *   comparison because it holds works a reader is shown (ADR-0173) or a
 *   curator keeps it in the shadow;
 * - **less known**: measured at or below it, so not counted against it;
 * - **not measured yet**: arrived after the last run measured fame.
 *
 * A place not measured yet is compared only with what a curator keeps on the
 * list, so its other measured neighbours are listed as measured, not as less
 * known. A type the kind exempts is never compared, and its neighbours are
 * listed the same way.
 */

import type { CrowdingPlaceView } from '../../../api/crowding';
import { notMeasuredLine } from './crowdingWords';
import { nounOf, type RuleWords } from './rowWords';

type Neighbour = CrowdingPlaceView['around'][number];

export type CircleGroup = 'compared' | 'uncounted' | 'less' | 'measured' | 'unmeasured';

/** The order the groups are listed in. */
export const CIRCLE_GROUPS: readonly CircleGroup[] = ['compared', 'uncounted', 'less', 'measured', 'unmeasured'];

/** What each group is called, in the list, the legend and a dot's hover. */
export const GROUP_WORDS: Record<CircleGroup, string> = {
  compared: 'better known, compared with it',
  uncounted: 'better known, not counted against it',
  less: 'less known, not counted against it',
  measured: 'measured, not compared with it',
  unmeasured: 'not measured yet',
};

/** The group a neighbour is listed in. */
export function groupOf(entry: Pick<Neighbour, 'score' | 'compared'>, view: Pick<CrowdingPlaceView, 'place' | 'typeExempt'>): CircleGroup {
  if (entry.compared) return 'compared';
  if (entry.score === null) return 'unmeasured';
  if (view.place.score === null || view.typeExempt) return 'measured';
  return entry.score > view.place.score ? 'uncounted' : 'less';
}

/** Why a better-known neighbour is not counted against the place, in words for its row. */
export function uncountedReason(entry: Pick<Neighbour, 'holdsWorks' | 'pin'>): string {
  if (entry.holdsWorks) return 'It holds works readers are shown.';
  return entry.pin === 'shadow' ? 'A curator keeps it in the shadow.' : 'The rule leaves it out.';
}

/** The neighbours by group, each in the circle's order: best known first. */
export function circleGroups(view: CrowdingPlaceView): Record<CircleGroup, Neighbour[]> {
  const groups: Record<CircleGroup, Neighbour[]> = { compared: [], uncounted: [], less: [], measured: [], unmeasured: [] };
  for (const entry of view.around) groups[groupOf(entry, view)].push(entry);
  return groups;
}

/**
 * What the circle's heading says the rule found, in a sentence or two:
 * "3 better-known churches within 10 km." or "The best-known church within
 * 10 km. 14 others are less known." A place not measured yet is never
 * said to have nothing above it.
 */
export function circleHeading(view: CrowdingPlaceView, rule: RuleWords): string {
  const groups = circleGroups(view);
  const within = `within ${rule.radiusKm} km`;
  if (view.typeExempt) return `${view.around.length + 1} ${nounOf(rule, view.around.length + 1)} ${within}`;
  if (view.place.score === null) return notMeasuredLine(view.measurable, view.measuringRun, groups.compared.length + view.comparedUnlisted);
  const counted = view.place.outrankedBy ?? groups.compared.length + view.comparedUnlisted;
  const less = groups.less.length;
  const others = less === 1 ? 'One other is' : `${less} others are`;
  const lessSentence = less === 0 ? '' : ` ${others} less known.`;
  // A better-known neighbour the rule leaves out (its works, a curator's shadow) is said apart, never hidden.
  const uncounted = groups.uncounted.length;
  const more = uncounted === 1 ? 'One more better known is' : `${uncounted} more better known are`;
  const uncountedSentence = uncounted === 0 ? '' : ` ${more} not counted.`;
  if (counted === 0 && uncounted === 0) return `The best-known ${nounOf(rule, 1)} ${within}.${lessSentence}`;
  if (counted === 0) return `No better-known ${nounOf(rule, 1)} ${within} counts against it.${uncountedSentence}${lessSentence}`;
  return `${counted} better-known ${nounOf(rule, counted)} ${within}.${uncountedSentence}${lessSentence}`;
}
