/**
 * A crowded city, as a curator reads it (ADR-0180, #2282): the types of the
 * window over every place of a kind and type around a place, and the read the
 * review page makes itself, the new arrivals the display would shadow. The
 * window's own calls, its read and the answers, are `crowdingAnswers.ts`,
 * which only the window's chunk loads.
 */

import {
  getExperiencesReviewCrowdingArrivals,
  type CrowdingAnswersBodyAnswersItem, type ShadowedArrivals,
} from './client.generated';

// What every call here answers is declared once, as a backend schema (ADR-0066).
export type {
  CrowdingAnswered, CrowdingWindow, CrowdingWindowRow, ShadowedArrivals,
  ShadowedArrivalsGroupsItem as ShadowedArrivalsGroup,
} from './client.generated';

/** One row's answer: keep it in the list or the shadow, refuse it, or hand it back to the rule. */
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
