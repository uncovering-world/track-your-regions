/**
 * Where a find comes from, asked of a site's curator (#2242): the finds a run
 * proposed from their own coordinate, the links already confirmed, and the
 * curator's answer on one of them.
 */

import type { FindSiteCandidates, FindSiteLinkAnswerResult, FindSiteLinks } from './client.generated';
import {
  getExperiencesByIdFindLinks, getExperiencesByIdFindLinksCandidates, putExperiencesByIdFindLinksByTreasureId,
} from './client.generated';

export type {
  FindSiteCandidate, FindSiteCandidates, FindSiteLink, FindSiteLinkAnswerResult, FindSiteLinks,
} from './client.generated';

/** What a curator may answer: the find comes from this site, or it does not. */
export type FindSiteAnswer = FindSiteLinkAnswerResult['answer'];

/** The proposals still open on a site, then the links confirmed. */
export async function fetchFindSiteLinks(siteId: number): Promise<FindSiteLinks> {
  return getExperiencesByIdFindLinks(siteId);
}

/** The finds named like `words` a curator may link to the site by hand, the best known first. */
export async function searchFindSiteCandidates(siteId: number, words: string): Promise<FindSiteCandidates> {
  return getExperiencesByIdFindLinksCandidates(siteId, { q: words });
}

/**
 * Say whether the find `treasureId` comes from the site `siteId`; a no also
 * takes a confirmed link back, and a yes on a find the site has no link to
 * links it by hand.
 */
export async function answerFindSiteLink(
  siteId: number, treasureId: number, answer: FindSiteAnswer,
): Promise<FindSiteLinkAnswerResult> {
  return putExperiencesByIdFindLinksByTreasureId(siteId, treasureId, { answer });
}
