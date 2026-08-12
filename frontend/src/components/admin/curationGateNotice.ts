/**
 * The one line a curator reads after releasing everything a source was holding.
 *
 * Its own module, beside the control rather than inside it, because this is a third
 * question from the two `CurationGateControls.tsx` already answers: that file is about
 * the switch and what it means in each position, and `SyncPanel.tsx` is about *running*
 * syncs. "What the batch did afterwards" grew through review until it was the larger half
 * of the component, and every one of its clauses is a claim about what happened —
 * assembled from separate builders precisely because each had to be corrected once for
 * saying something the response did not support.
 *
 * Pure string assembly, no React: the pluralisation and count defects that kept surviving
 * their tests here were reachable only through a rendered dialog. `curationGateNotice.test.ts`
 * calls `noticeFor` directly for each clause, and the component's suite keeps one
 * end-to-end case for the wiring — the response reaching this function and its line
 * reaching the alert.
 */

import { type publishWaiting } from '../../api/admin';
import { plural } from '../../utils/plural';
import { worldViewList } from '../../utils/worldViewList';

type PublishWaitingResult = Awaited<ReturnType<typeof publishWaiting>>;

/**
 * The opening clause: what happened to the source, not to the request.
 *
 * "Nothing was waiting" is a claim about the source, so it may only be made when the
 * response reports nothing at all — with refusals or out-of-scope rows it would
 * contradict the very next clause, asserting both that there was nothing and that
 * there were two.
 */
function openingClause(result: PublishWaitingResult): string {
  const released = result.published.length;
  if (released > 0) return `${plural(released, 'object')} published.`;
  // Every count the response carries, `heldLeftForReview` included — and that is the
  // one most likely to be non-zero, since held changes are what the batch leaves
  // behind on purpose. Without it the notice reads "Nothing was waiting. 1 held
  // change still waiting on its own card", which denies in one clause what the next
  // one asserts.
  // `=== 0` rather than a falsy test on purpose: `null` means the server could not
  // count what is still held, and "nothing was waiting" is exactly the claim it is
  // then not entitled to make.
  const nothingThere = result.refused.length === 0
    && result.outOfScope === 0
    && result.heldLeftForReview === 0;
  return nothingThere ? 'Nothing was waiting.' : 'Nothing was published.';
}

/**
 * One clause per distinct reason, naming the objects it applies to.
 *
 * The reasons are not interchangeable: the endpoint sends the server's 409 text for a
 * row holding a newer proposal and a generic "failed — open it" for a thrown database
 * error. Naming one of five can therefore explain a deadlock while the other four are
 * stale proposals, and the curator opens the wrong object first. Five names per
 * reason, then a count — safe here because its list is in the same sentence.
 */
function refusalClauses(refused: PublishWaitingResult['refused']): string[] {
  const byReason = new Map<string, string[]>();
  for (const r of refused) byReason.set(r.error, [...(byReason.get(r.error) ?? []), r.name]);
  return [...byReason].map(([reason, names]) => {
    const rest = names.length > 5 ? ` and ${names.length - 5} more` : '';
    const shown = `${names.slice(0, 5).join(', ')}${rest}`;
    // Quoted and attributed rather than spliced in after a count, because every
    // message `publishUnderLock` produces is phrased for one row ("This row is
    // holding a proposal from a different run — reload to see it"). Reading that
    // after "2 objects refused —" makes it a claim about a row that is not named,
    // and the colon it used to sit behind followed a sentence that already ended in
    // an instruction.
    // Terminated here, because `noticeFor` joins clauses with a single space and the
    // server's reason carries no full stop of its own — without these the next clause
    // ran on from "reload to see it 3 objects outside your scope".
    if (names.length === 1) return `${shown} refused — ${reason}.`;
    return `${plural(names.length, 'object')} refused — ${shown}. Each: “${reason}”.`;
  });
}

/**
 * Publications that landed with their regions left stale, named rather than counted.
 *
 * Rebuilding a world view is an admin's job, so the one useful thing a curator can do
 * is say which object and which world views — a bare count reduces them to
 * "something about regions failed".
 */
function stalePlacementClause(published: PublishWaitingResult['published']): string[] {
  const stale = published.filter(o => o.placementFailed);
  if (stale.length === 0) return [];
  // The same sentence the single-object card says, through the same helper: a second
  // implementation of it rendered "world view null" for the shape the server sends
  // when *listing* the world views is what failed, and dropped the id from the shape
  // that works — in the one sentence whose purpose is to be handed to an admin.
  //
  // `in` rather than brackets: `worldViewList` returns `Name (world view N)` and joins
  // several with commas, so wrapping it put a comma-separated list inside parentheses
  // inside a semicolon-separated list — "Prado (GADM (world view 1), Continents (world
  // view 4)); Rijksmuseum (…)" asks the reader which bracket closes what. The card this
  // clause matches keeps it to one level.
  const named = stale.map(o => `${o.name} in ${worldViewList(o.placementFailedWorldViews)}`);
  // Capped like the refusal clause, and this is the list that needs it more: a
  // refusal is per-row and racy, so a run landing mid-batch touches a few, while a
  // placement failure is systemic — one broken world view fails every object the
  // batch releases, so this clause is the one that can reach 1272 names.
  const rest = named.length > 5 ? ` and ${named.length - 5} more` : '';
  return [
    `${plural(stale.length, 'object')} published but could not be re-placed into `
    + `${stale.length === 1 ? 'its' : 'their'} regions — ${named.slice(0, 5).join('; ')}${rest}. `
    + 'Tell an admin.',
  ];
}

/**
 * Old pins this release took off the map, which nothing else in the reply mentions.
 *
 * Publishing a visible object's unread points releases the withdrawals deferred
 * behind them, so a point a reader could see yesterday stops being shown at this
 * moment and nowhere else records when. The single-object notice has said this since
 * the publish endpoint landed; the batch is the form where it matters more, because
 * the alternative to this sentence is opening forty objects' histories.
 *
 * Both units are named, and that is not decoration: the points are what changed and the
 * objects are where to look, so a sentence carrying a point count over a truncated
 * object list would leave "and 3 more" ambiguous between the two — which is exactly
 * what the sibling clauses avoid by counting objects and listing objects.
 */
function withdrawalClause(published: PublishWaitingResult['published']): string[] {
  const withObjects = published.filter(o => o.withdrawalsReleased > 0);
  if (withObjects.length === 0) return [];
  const total = withObjects.reduce((n, o) => n + o.withdrawalsReleased, 0);
  if (withObjects.length === 1) {
    return [`${plural(total, 'replaced point')} in ${withObjects[0].name} no longer shown.`];
  }
  const names = withObjects.map(o => o.name);
  const rest = names.length > 5 ? ` and ${names.length - 5} more` : '';
  return [`${plural(total, 'replaced point')} in ${plural(names.length, 'object')} `
    + `no longer shown — ${names.slice(0, 5).join(', ')}${rest}.`];
}

/**
 * What became visible, in the terms a reader would notice it in.
 *
 * "40 objects published" is a count of acts, not of what a visitor gains: a museum
 * released with three points and twelve works is a different day's release from one
 * with none. The single-object notice has always said this line, which is what makes
 * its absence here a gap rather than a choice — the batch would otherwise be the form
 * of the same act that reports the least.
 *
 * Works taken as `Math.max` per object, exactly as the card takes them: the link and the
 * row are two axes over the same works, so adding them would double-count a work passed
 * in this venue for the first time, and picking one reads zero for a work whose row was
 * already verified elsewhere.
 */
function releasedClause(published: PublishWaitingResult['published']): string[] {
  const points = published.reduce((n, o) => n + o.locationsPublished, 0);
  const works = published.reduce(
    (n, o) => n + Math.max(o.treasureLinksPublished, o.treasuresPublished), 0,
  );
  const released: string[] = [];
  if (points > 0) released.push(plural(points, 'point'));
  if (works > 0) released.push(plural(works, 'work'));
  return released.length === 0 ? [] : [`${released.join(' and ')} now visible.`];
}

/**
 * What to tell the curator afterward, in one line.
 *
 * Assembled from clauses rather than built inline, because every one of them is a
 * claim about what happened and each had to be corrected once during review for
 * saying something the response did not support. Split this small also keeps each
 * clause testable on its own and the whole under the complexity limit.
 *
 * The order is the single-object notice's, for the reader who sees both: what became
 * visible, then what stopped being shown, then everything that did not happen. A batch
 * has clauses no single publish has — a refusal there *is* the outcome rather than a
 * clause of one — and they all belong in that last group: put anywhere earlier they
 * interleave a failure between the two halves of what the release actually did.
 */
export function noticeFor(result: PublishWaitingResult): string {
  const parts = [
    openingClause(result),
    ...releasedClause(result.published),
    ...withdrawalClause(result.published),
    ...refusalClauses(result.refused),
  ];
  // Through `plural` like every sibling clause: this is the one sentence whose only
  // reader is a region-scoped curator, so it is the one that most needs to say *what*
  // was left alone rather than handing them a bare number between two other counts.
  if (result.outOfScope > 0) {
    parts.push(`${plural(result.outOfScope, 'object')} outside your scope, left alone.`);
  }
  parts.push(...stalePlacementClause(result.published));
  if (result.heldLeftForReview === null) {
    // The count failed after the publications committed, so the reply arrived without
    // it. Points at where the number lives rather than promising one will be there: the
    // panel's count is a separate, *wider* query — every category rather than this one —
    // and it fails for the same class of cause, so "the panel will show it" could be read
    // three lines under the panel saying it could not count either.
    parts.push('How much this source is still holding could not be counted — the panel '
      + 'counts it separately.');
  } else if (result.heldLeftForReview > 0) {
    // One card per held change: the queue groups its `held` rows per experience.
    parts.push(
      `${plural(result.heldLeftForReview, 'held change')} still waiting on `
      + `${result.heldLeftForReview === 1 ? 'its own card' : 'their own cards'}.`,
    );
  }
  return parts.join(' ');
}
