/**
 * Door two's own rules over the works: which of the collected works are this
 * kind's at all, why one is not, and which places a fold took out of the run.
 *
 * Split out of `pipeline.ts` at the seam the review of #890 named, the way
 * `archaeology/museumHoldings.ts` was: the pipeline is the wiring and the
 * union — the two doors, in what order, and how their answers are joined —
 * and this is what door two decides about a work once it is placed. Nothing
 * here reads Wikidata.
 */

import { placeArtwork } from '../museum/placement.js';
import { museumRule } from '../museum/venueTest.js';
import { makeResolver } from '../museum/venueGraph.js';
import type { PoolWork } from '../museum/queries.js';
import type { WorksCollection } from '../museum/worksCollector.js';
import type { WorshipTrees } from './classes.js';
import type { FilteredEntity } from '../syncContract.js';

const LOG_PREFIX = '[Worship Sync]';

/**
 * The works this kind may open a door with: the placed ones that still exist
 * and that no museum claims.
 *
 * **Museum wins.** Both rules read the same statements, and a work whose owner
 * or location the museum rule resolves is one the museum import already writes
 * — the Creation of Adam (P195 Vatican Museums, P276 Sistine Chapel) among
 * them. Asked of the raw statements rather than of this run's placements,
 * because the question is what the museum rule *would* make of the work, not
 * what the worship rule made of it.
 *
 * **A lost work opens nothing.** The Statue of Zeus at Olympia is one of the
 * seven wonders and has not existed for sixteen centuries; its temple stands on
 * its own fame or not at all. The shared collector already placed it nowhere
 * (`unseen`), so it never reaches this loop; the count is for the log line.
 */
export function ourWorks(
  works: WorksCollection,
  museumClasses: ReadonlySet<string>,
  trees: WorshipTrees,
  placeClasses: Map<string, string[]>,
  /** Which collection the log line is about: asked twice, before and after the venue-side read (#890). */
  stage: string,
): Record<string, string[]> {
  const museums = makeResolver(works.graph, museumRule(museumClasses));
  const ours: Record<string, string[]> = {};
  const lost = Object.keys(works.unseen).length;
  let places = 0;
  let museumsWon = 0;
  for (const [qid, venues] of Object.entries(works.afterFolds)) {
    if (!venues.length) continue;
    const work = works.pool.get(qid);
    if (!work) continue;
    if (isItselfAPlace(qid, work, trees, placeClasses)) { places++; continue; }
    const atAMuseum = placeArtwork(
      works.statements.get(qid) ?? [], museums.resolve, works.graph.ancestors,
    );
    if (atAMuseum.length) { museumsWon++; continue; }
    ours[qid] = venues;
  }
  console.log(
    `${LOG_PREFIX} Works placed in a place of worship (${stage}): ${Object.keys(ours).length}; `
    + `${museumsWon} left to the museum that holds them, ${places} places in their own right, `
    + `${lost} that nobody can see`,
  );
  return ours;
}

/**
 * A work that is itself a place of worship is a place, never a treasure.
 *
 * The two doors read overlapping class lists: 13 classes lie in both the
 * treasure trees and the worship tree (measured on the run's own cached trees,
 * 2026-09-09 — imamzadeh, chapel tomb, temple-tomb, heroön, Keramat and the
 * Japanese memorial towers, kuyō-tō and banreitō among them). Without this, the
 * Cavern of the Patriarchs — a mosque and a synagogue that the tomb tree also
 * collects — would be admitted as a place at one door and written as somebody's
 * treasure at the other.
 *
 * Two sources for what the row is. The works pool carries one class — the one
 * the work was collected under — and the Cavern arrives there as a tomb; the
 * places pool carries every `P31` of every entity it named, which is where its
 * mosque class is. A row too obscure for the places pool (below its floor, or
 * named by no class question) is judged on its collected class alone — unless
 * the venue-side read brought it (#890), in which case the caller merges every
 * class the by-id answer carried into `placeClasses`, so a chapel tomb at 12
 * sitelinks is a chapel here too.
 */
export function isItselfAPlace(
  qid: string,
  work: PoolWork,
  trees: WorshipTrees,
  placeClasses: Map<string, string[]>,
): boolean {
  const own = [...(placeClasses.get(qid) ?? []), ...(work.typeQid ? [work.typeQid] : [])];
  return own.some((cls) => trees.worship.has(cls));
}

/**
 * Why a work the venue-side read kept by class is nobody's treasure here, in
 * the words of the rule that turned it away: this door's three rules, and
 * the placement's own silence.
 */
export function whyNotOurs(
  qid: string,
  works: WorksCollection,
  ours: Record<string, string[]>,
  trees: WorshipTrees,
  placeClasses: Map<string, string[]>,
): string {
  const unseen = works.unseen[qid];
  if (unseen) return `nobody can see it: ${unseen.reason}`;
  const work = works.pool.get(qid);
  if (work && isItselfAPlace(qid, work, trees, placeClasses)) {
    return 'a place of worship itself, not a treasure';
  }
  // A museum won only where `ourWorks` left the work out: a work it kept can
  // still be written nowhere, when the placement — the owner before the
  // location — put it at a place the run admits by neither door.
  if ((works.afterFolds[qid] ?? []).length && !ours[qid]) return 'the museum that holds it wins';
  return 'its own statements place it at no admitted place';
}

/**
 * A venue that received a work of ours and then folded into another is a place
 * the run proposed and no longer does, so it is reported as a loss with the
 * reason the fold rule gave. A fold of a venue that held nothing is not
 * reported — a line about it would count a loss the catalogue did not have.
 */
export function foldLosses(works: WorksCollection, ours: Record<string, string[]>): FilteredEntity[] {
  // Measured on the works that are still ours after the museum, the lost and
  // the place filters: a venue whose only work went to the museum that owns it
  // lost this run nothing, and a line about it would count a loss that is not
  // one. Their pre-fold placements, because the question is which venue
  // received a work and then folded away.
  const received = new Set(Object.keys(ours).flatMap((qid) => works.placed[qid] ?? []));
  const nameOf = (qid: string) => works.graph.details.get(qid)?.label ?? qid;
  return Object.entries(works.folds)
    .filter(([qid]) => received.has(qid))
    .map(([qid, fold]) => ({
      externalId: qid,
      name: nameOf(qid),
      reason: `folded into ${nameOf(fold.into)} — ${fold.why}, ${fold.metres} m away`,
    }));
}
