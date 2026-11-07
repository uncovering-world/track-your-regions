/**
 * A crowded city, as a curator reads it (ADR-0180, #2282, #2358): the types of
 * the window over a region's places of a kind and type and of one place in its
 * own circle, and the read the review page makes itself, the new arrivals the
 * display would shadow. The window's own calls, its reads and the answers, are
 * `crowdingAnswers.ts`, which only the window's chunk loads.
 */

import {
  getExperiencesReviewCrowdingArrivals,
  type CrowdingAnswersBodyAnswersItem, type ShadowedArrivals,
} from './client.generated';

// What every call here answers is declared once, as a backend schema (ADR-0066).
export type {
  CrowdingAnswered, CrowdingGroup, CrowdingGroupPlace, CrowdingPlaceView,
  CrowdingPlaceViewAroundItem as CrowdingAroundPlace, ShadowedArrivals,
  ShadowedArrivalsGroupsItem as ShadowedArrivalsGroup,
} from './client.generated';

/** One place's answer: keep it in the list or the shadow, publish it to the rule, refuse it, or hand it back to the rule. */
export type CrowdingAnswer = CrowdingAnswersBodyAnswersItem['answer'];
export type CrowdingAnswerRow = CrowdingAnswersBodyAnswersItem;

/**
 * The new arrivals a crowded city would shadow, which the queue's sections do
 * not ask about; within a region where one is named (#2349), or the arrivals
 * no region places for `none`.
 */
export function fetchShadowedArrivals(region?: number | 'none'): Promise<ShadowedArrivals> {
  return getExperiencesReviewCrowdingArrivals(region === undefined ? undefined : { region });
}
