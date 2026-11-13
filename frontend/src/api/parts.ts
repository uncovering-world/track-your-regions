/**
 * A curator's word on a place in a whole (#2118): a place's parts and wholes,
 * the places a curator may add, and the add and the take-out. Imported only by
 * the card's lazy *Parts* section, so none of it reaches a visitor's bundle.
 */

import {
  getExperiencesByIdPartCandidates, getExperiencesByIdParts, postExperiencesByIdParts, postExperiencesByIdPartsTakeOut,
} from './client.generated';
import type {
  PartCandidates, PartWordAnswered, PartWordBody, PlaceParts, TakeOutPartBody,
} from './client.generated';

export type { PartCandidates, PartWordAnswered, PlaceParts };
/** One row of either section: a part of the place, or a whole it is a part of. */
export type PartRow = PlaceParts['parts'][number];
/** One place the search offers. */
export type PartCandidate = PartCandidates['candidates'][number];

/** The place's parts and the wholes it is a part of, with whose word makes each one. */
export async function fetchPlaceParts(experienceId: number): Promise<PlaceParts> {
  return getExperiencesByIdParts(experienceId);
}

/** Places to add as parts of the place (`part`), or wholes to add it to (`whole`); near it when `q` is empty. */
export async function findPartCandidates(
  experienceId: number, role: 'part' | 'whole', q: string,
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
