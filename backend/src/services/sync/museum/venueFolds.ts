/**
 * The venue test admits any entity with a museum class and its own coordinates, so a museum
 * inside a museum produces two pins: Palazzo Pitti and the Galleria Palatina, the Met and "The
 * Met Fifth Avenue", the Uffizi twice under two QIDs.
 *
 * Distance is what separates "inside" from "next door", and it is a semantic signal rather
 * than a fudge: Galleria Palatina is in Palazzo Pitti, the Czartoryski Museum is a branch of
 * the National Museum in Kraków 500 m away, and the Van Gogh Museum merely stands beside the
 * Stedelijk.
 */
export interface FoldCandidate { qid: string; lat: number; lon: number; works: number; sitelinks: number; }
/** `into` is the immediate fold target, not necessarily the final survivor — it can itself be a
 *  key of the map computeFolds returns. See computeFolds for why, and how a consumer resolves it. */
export interface Fold { into: string; metres: number; why: string; }

const CONTAINER_RADIUS_M = 250;
const SAME_SPOT_M = 40;

export function metresBetween(a: FoldCandidate, b: FoldCandidate): number {
  const dx = (a.lon - b.lon) * Math.cos((a.lat * Math.PI) / 180) * 111320;
  const dy = (a.lat - b.lat) * 110540;
  return Math.hypot(dx, dy);
}

// A P361 container on the same site is the ticket.
function applyContainerFolds(
  venues: FoldCandidate[],
  parentsOf: (qid: string) => string[],
  byQid: Map<string, FoldCandidate>,
  folds: Record<string, Fold>,
): void {
  for (const v of venues) {
    for (const p of parentsOf(v.qid)) {
      const parent = byQid.get(p);
      if (!parent || folds[v.qid]) continue;
      const d = metresBetween(v, parent);
      if (d <= CONTAINER_RADIUS_M) {
        folds[v.qid] = { into: p, metres: Math.round(d), why: 'inside its P361 container' };
      }
    }
  }
}

/**
 * Which of two records for one institution survives: the row carrying the collection, then the
 * better-known one, then the qid.
 *
 * The qid is a last resort, not a preference, and it is not decoration: two duplicate records of
 * one building are routinely equal on both counts — nought works and nought sitelinks apiece is
 * ordinary for a duplicate — and without it neither loses in either direction, so nothing merges
 * and the duplicate pin this module exists to remove survives. It also makes the answer
 * independent of the order venues arrived in.
 */
function survivesOver(x: FoldCandidate, y: FoldCandidate): boolean {
  if (x.works !== y.works) return x.works > y.works;
  if (x.sitelinks !== y.sitelinks) return x.sitelinks > y.sitelinks;
  return x.qid > y.qid;
}

// Two rows at one spot with no edge between them are one institution recorded twice; the row
// carrying the collection survives.
function applySameSpotFolds(venues: FoldCandidate[], folds: Record<string, Fold>): void {
  for (const a of venues) {
    for (const b of venues) {
      if (a.qid === b.qid || folds[a.qid] || folds[b.qid]) continue;
      const d = metresBetween(a, b);
      if (d >= SAME_SPOT_M) continue;
      if (survivesOver(b, a)) {
        folds[a.qid] = { into: b.qid, metres: Math.round(d), why: 'same spot, recorded twice' };
      }
    }
  }
}

/**
 * A fold map must be a forest, and `P361` does not guarantee one.
 *
 * Wikidata contains reciprocal `P361` pairs — `venueGraph.survivorOf` says so in its own comment,
 * where the cycle is caught as a *termination* problem. It is a correctness problem here first.
 * Two venues 11 m apart that each name the other as their container produce `{A: {into: B},
 * B: {into: A}}`, and every consumer then reads that as: neither merges, so the duplicate pin the
 * fold rule exists to remove survives; each one's works are written to the other, so both museum
 * cards list the wrong holdings; and both are named as folded, which the pipeline reports as
 * filtered and the run then refuses — visible to nobody until the next successful run puts them
 * back.
 *
 * Broken by keeping the strongest member of each cycle: delete its outgoing fold and the rest of
 * the cycle chains into it. The strength order is the one `applySameSpotFolds` already uses —
 * the row carrying the collection survives — with the qid as a last resort so the answer does not
 * depend on the order venues arrived in.
 */
function breakFoldCycles(folds: Record<string, Fold>, byQid: Map<string, FoldCandidate>): void {
  // The same order the same-spot rule uses, so the two cannot drift apart.
  const survivesByQid = (a: string, b: string): boolean => {
    const x = byQid.get(a);
    const y = byQid.get(b);
    return x && y ? survivesOver(x, y) : a > b;
  };

  for (const start of Object.keys(folds)) {
    const walked: string[] = [];
    const onPath = new Set<string>();
    let current = start;
    while (folds[current] && !onPath.has(current)) {
      walked.push(current);
      onPath.add(current);
      current = folds[current].into;
    }
    if (!onPath.has(current)) continue;

    // `current` is the first node met twice, so the cycle is the walk from it onwards.
    const cycle = walked.slice(walked.indexOf(current));
    let keeper = cycle[0];
    for (const q of cycle) if (survivesByQid(q, keeper)) keeper = q;
    delete folds[keeper];
  }
}

/**
 * Each entry records only the *immediate* relationship a row was measured against, one hop at a
 * time — it is never chased further. `into` can therefore itself be a key of the map this
 * function returns: a room folds into the gallery around it and, separately, that gallery folds
 * into the palace around it, giving `{room: {into: 'gallery'}, gallery: {into: 'palace'}}` rather
 * than pointing the room straight at the palace. The same shape appears with no nesting at all
 * when a container is itself a same-spot duplicate of a third record. A consumer that wants the
 * eventual survivor must follow `into` until it names a qid absent from the map; that walk is the
 * caller's job (composing this with placement's output), not this function's.
 */
export function computeFolds(
  venues: FoldCandidate[],
  parentsOf: (qid: string) => string[],
): Record<string, Fold> {
  const byQid = new Map(venues.map((v) => [v.qid, v]));
  const folds: Record<string, Fold> = {};
  applyContainerFolds(venues, parentsOf, byQid, folds);
  applySameSpotFolds(venues, folds);
  breakFoldCycles(folds, byQid);
  return folds;
}
