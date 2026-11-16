/**
 * A curator's word on a place in a whole (#2118): a place's parts and wholes,
 * the places a curator may add, and the add and the take-out. Imported only by
 * the card's lazy *Parts* section, so none of it reaches a visitor's bundle.
 */

import {
  getExperiencesByIdPartCandidates, getExperiencesByIdParts, postExperiencesByIdParts, postExperiencesByIdPartsReplace,
  postExperiencesByIdPartsTakeOut,
} from './client.generated';
import type {
  PartCandidates, PartLineMoved, PartWordAnswered, PartWordBody, PlaceParts, ReplacePartBody, TakeOutPartBody,
} from './client.generated';

export type { PartCandidates, PartLineMoved, PartWordAnswered, PlaceParts };
/** One row of either section: a part of the place, or a whole it is a part of. */
export type PartRow = PlaceParts['parts'][number];
/** One place the search offers. */
export type PartCandidate = PartCandidates['candidates'][number];

/** The place's parts and the wholes it is a part of, with whose word makes each one. */
export async function fetchPlaceParts(experienceId: number): Promise<PlaceParts> {
  return getExperiencesByIdParts(experienceId);
}

/** What a part search looks for: parts to add, wholes to add the place to, or the place a list line moves to (#2527). */
export type PartSearchRole = PartCandidates['role'];

/**
 * Places to add as parts of the place (`part`), wholes to add it to (`whole`),
 * or places a list line of it may move to (`line`); near it when `q` is empty.
 */
export async function findPartCandidates(
  experienceId: number, role: PartSearchRole, q: string,
): Promise<PartCandidates> {
  return getExperiencesByIdPartCandidates(experienceId, q.trim().length >= 2 ? { role, q: q.trim() } : { role });
}

/** Make `partId` a part of the whole, or put back one a curator kept out. */
export async function addPart(wholeId: number, body: PartWordBody): Promise<PartWordAnswered> {
  return postExperiencesByIdParts(wholeId, body);
}

/** Take `partId` out of the whole; one a source still names is kept out until put back. */
export async function takeOutPart(wholeId: number, body: TakeOutPartBody): Promise<PartWordAnswered> {
  return postExperiencesByIdPartsTakeOut(wholeId, body);
}

/**
 * Move a list line of the whole from `partId`, the place that holds it, to
 * `withId`, the place it names (#2527); moving it back is the Undo.
 */
export async function replacePartLine(wholeId: number, body: ReplacePartBody): Promise<PartLineMoved> {
  return postExperiencesByIdPartsReplace(wholeId, body);
}
