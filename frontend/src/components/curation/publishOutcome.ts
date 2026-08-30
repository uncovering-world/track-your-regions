/**
 * What an answer to a held card did, in one line above the queue.
 *
 * The refetch takes the card away, so this is the only place a publication's
 * released withdrawal, its skipped claim, its failed re-placement — or a
 * refusal's "and four things are still waiting" — can be said at all.
 *
 * Its own module because two screens read it: the gated card writes it, and
 * `ReviewQueue.tsx` says the same sentence after an admission override that
 * publishes. It used to be exported from the card, which made one screen import
 * from another for a string.
 */

import { type PublishResult } from '../../api/experiences';
import { plural } from '../../utils/plural';
import { worldViewList } from '../../utils/worldViewList';
import { fieldLabel } from './fieldMeaning';

/**
 * What the publication did to the object's parts, one clause per part.
 *
 * Each part written to is named as the card's group named it, with its fields in
 * the same words (ADR-0037) and the ones left as the curator wrote them, singular
 * where there is one. A part the proposal named that the source has since
 * withdrawn is said rather than dropped: nothing was written and nothing readers
 * see changed, and a line that omitted it would read as though it had been.
 */
function partOutcomes(data: PublishResult): string[] {
  const said: string[] = [];
  for (const part of data.appliedParts ?? []) {
    const clauses: string[] = [];
    if (part.fields.length > 0) clauses.push(`${part.fields.map(fieldLabel).join(', ')} applied`);
    if (part.claimedFieldsSkipped.length > 0) {
      const them = part.claimedFieldsSkipped.length === 1 ? 'it' : 'them';
      clauses.push(`${part.claimedFieldsSkipped.map(fieldLabel).join(', ')} left as you wrote ${them}`);
    }
    if (clauses.length > 0) said.push(`${part.name}: ${clauses.join(', ')}`);
  }
  for (const part of data.partsNotFound ?? []) {
    said.push(`${part.name} is no longer offered, so nothing was written to it`);
  }
  return said;
}

/**
 * What the publication did, in one sentence, plus a second when it went wrong
 * halfway.
 *
 * `withdrawalsReleased` and `placementFailed` are the two the response carries
 * that nothing would otherwise say: a point the source replaced stops being
 * shown at this moment and nowhere else records when, and a publication that
 * landed while re-placing the object failed is a success with stale regions —
 * which must not read as an unqualified one.
 */
export function publishOutcomeFor(
  item: { name: string }, data?: PublishResult,
): string | undefined {
  if (!data) return undefined;
  const parts: string[] = [];
  // Field names in the reader's words here too — this line answers the same card whose
  // rows are labelled through `fieldLabel`.
  if (data.appliedFields.length > 0) {
    parts.push(`${data.appliedFields.map(fieldLabel).join(', ')} applied`);
  }
  if (data.claimedFieldsSkipped.length > 0) {
    parts.push(`${data.claimedFieldsSkipped.map(fieldLabel).join(', ')} left as you wrote them`);
  }
  parts.push(...partOutcomes(data));
  const released: string[] = [];
  if (data.locationsPublished > 0) released.push(plural(data.locationsPublished, 'point'));
  // The same works counted from two axes — the link says a work has been passed
  // *here*, the work says it has been passed at all — so this is one number for
  // a curator, not two.
  const worksPublished = Math.max(data.treasureLinksPublished, data.treasuresPublished);
  if (worksPublished > 0) released.push(plural(worksPublished, 'work'));
  if (released.length > 0) parts.push(`${released.join(' and ')} now visible`);
  if (data.withdrawalsReleased > 0) {
    parts.push(`${plural(data.withdrawalsReleased, 'replaced point')} no longer shown`);
  }
  if (parts.length === 0) parts.push('published');

  const outcome = `${item.name}: ${parts.join('; ')}.`;
  if (!data.placementFailed) return outcome;
  // Named, and addressed to someone who cannot fix it. Re-assigning regions is
  // admin-only end to end, and this page's ordinary reader is a region- or
  // category-scoped curator — so the actionable step is to hand an admin the
  // object and the world views, which means the sentence has to contain them.
  // Ids come along with the names because that is what an admin works from.
  // Bent by what the same sentence just printed, and keyed on a *named* world view
  // rather than on the array's length: `worldViewList` joins several — one failure per
  // world view is its ordinary shape — and the two shapes that name none are `[]` and
  // the single `{id: null}` the server sends when listing the world views is itself what
  // failed, which renders "every world view — they could not even be listed". Counting
  // that one as length 1 put "that world view" under a plural sentence, in the line
  // written to be handed to an admin word for word.
  const failed = data.placementFailedWorldViews;
  const failedOne = failed?.length === 1 && failed[0].id !== null;
  return `${outcome} Its regions were not recomputed in ${worldViewList(data.placementFailedWorldViews)} — only an admin can `
    + `run a re-assignment, so tell one this object and ${failedOne ? 'that world view' : 'those world views'}; `
    // Counted rather than left singular: one publish can release several withdrawals — the
    // same number this sentence has already printed as "no longer shown" — and placement is
    // reached only when at least one was, so there is always a number to give.
    + `until then it is placed by ${plural(data.withdrawalsReleased, 'point')} it no longer has.`;
}
