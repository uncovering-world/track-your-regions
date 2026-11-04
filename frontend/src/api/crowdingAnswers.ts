/**
 * The crowded-city window's own calls (ADR-0180, #2282, #2358): a region's
 * places of a kind and type as its page shows them, one place in its own
 * circle, and a curator's answers, applied together
 * (`POST /api/experiences/review/crowding/answers`). Its own module so that
 * only the window's chunk carries them; the review page's read, the arrivals
 * a crowded city would shadow, is `crowding.ts`.
 */

import {
  getExperiencesReviewCrowdingGroup, getExperiencesReviewCrowdingPlaceByMembershipId,
  postExperiencesReviewCrowdingAnswers,
  type CrowdingAnswered, type CrowdingGroup, type CrowdingPlaceView,
} from './client.generated';
import type { CrowdingAnswerRow } from './crowding';
import type { CrowdGroupRef } from '../utils/appUrl';

/**
 * Every place of the group's kind and type in its region and under it, best
 * known first: shown, shadowed and new. A kind with no display rule answers 409.
 */
export function fetchCrowdingGroup(group: CrowdGroupRef): Promise<CrowdingGroup> {
  return getExperiencesReviewCrowdingGroup({
    region: group.regionId ?? 'none', kind: group.kindId, ...(group.type ? { type: group.type } : {}),
  });
}

/** A place in its own circle: the places of its type within the radius, and those it is compared with. */
export function fetchCrowdingPlace(membershipId: number): Promise<CrowdingPlaceView> {
  return getExperiencesReviewCrowdingPlaceByMembershipId(membershipId);
}

/** The most answers one request takes: a bigger staging is sent a page at a time. */
const CROWDING_ANSWERS_MAX = 100;

/**
 * A page of answers failed after the pages before it applied: what those did,
 * and why the rest did not go.
 */
export class CrowdingPartlyApplied extends Error {
  constructor(readonly applied: CrowdingAnswered, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = 'CrowdingPartlyApplied';
  }
}

/**
 * The answers, applied a page at a time, and their reports merged into one:
 * each place is its own act on the server, so a page that fails leaves the
 * pages before it applied, and the error carries what they did.
 */
export async function answerCrowding(answers: readonly CrowdingAnswerRow[], note?: string): Promise<CrowdingAnswered> {
  const merged: CrowdingAnswered = { answered: [], refused: [], outOfScope: 0, placementFailed: [] };
  for (let at = 0; at < answers.length; at += CROWDING_ANSWERS_MAX) {
    let page: CrowdingAnswered;
    try {
      page = await postExperiencesReviewCrowdingAnswers({
        answers: answers.slice(at, at + CROWDING_ANSWERS_MAX), note: note || undefined,
      });
    } catch (error) {
      if (at === 0) throw error;
      throw new CrowdingPartlyApplied(merged, error);
    }
    merged.answered.push(...page.answered);
    merged.refused.push(...page.refused);
    merged.outOfScope += page.outOfScope;
    merged.placementFailed.push(...page.placementFailed);
  }
  return merged;
}
