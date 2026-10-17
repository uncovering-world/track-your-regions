/**
 * The pairing of incoming points with stored rows, made complete (#549).
 *
 * `writeExperienceLocations` builds `paired_rows` with two greedy passes
 * (ADR-0027 decision 5a): every incoming point takes its best stored row, then
 * a row two of them chose keeps the lower ordinal. The second pass drops the
 * loser rather than sending it to its next candidate, so a one-to-one pairing
 * of every point can exist inside the tolerance and go unfound: two points of
 * one Wikidata item 15 m apart, stored rows 7.5 m from both and 7.6 m from the
 * second, pair once where they could pair twice, and the run inserts a point
 * that is not new and withdraws one that did not leave. The dev catalogue holds
 * six such places on 2026-10-17 — the Bronze Horseman's two points are 17.4 m
 * apart, Nidaros Cathedral's 10.3 m.
 *
 * What is decided here is only what the greedy passes could not: starting from
 * their pairing, an incoming point left without a row looks for an augmenting
 * path (Kuhn's algorithm) through the candidates, in the same preference order
 * the passes read. A path that exists is taken; every pair the greedy passes
 * made stays unless moving it to its next candidate is what lets one more point
 * pair. The result has as many pairs as any one-to-one pairing of these
 * candidates can (ADR-0117).
 *
 * Pure, so the unit lane reads it; the writer hands it the candidates and the
 * greedy pairing and writes back what it returns.
 */

/** One stored row an incoming point may be, as `candidate` in the writer lists it. */
export interface PairCandidate {
  ordinal: number;
  locationId: number;
  metres: number;
}

/** One decided pair, as `paired_rows` holds it. */
export interface Pair {
  ordinal: number;
  locationId: number;
  metres: number;
}

/**
 * The complete pairing, or null where the greedy one already pairs every
 * point that can be paired — the common case, which then costs no write.
 *
 * `candidates` must come in the writer's preference order within each ordinal
 * (exact reference, then an unmarked row, then nearer, then the lower id): the
 * order an augmenting path tries rows in is that order, so a point moved to make
 * room takes its next-best row and not an arbitrary one. Within a search, a row
 * nobody holds is tried before a row another point would have to give up.
 */
export function completePairing(candidates: PairCandidate[], greedy: Pair[]): Pair[] | null {
  const choices = new Map<number, PairCandidate[]>();
  for (const candidate of candidates) {
    const list = choices.get(candidate.ordinal) ?? [];
    list.push(candidate);
    choices.set(candidate.ordinal, list);
  }

  // Both directions of the pairing as it stands: the row each point holds, and
  // the point each row is held by.
  const rowOf = new Map<number, PairCandidate>();
  const holderOf = new Map<number, number>();
  for (const pair of greedy) {
    rowOf.set(pair.ordinal, pair);
    holderOf.set(pair.locationId, pair.ordinal);
  }

  const assign = (candidate: PairCandidate) => {
    rowOf.set(candidate.ordinal, candidate);
    holderOf.set(candidate.locationId, candidate.ordinal);
  };

  /** Find a row for `ordinal`, moving other points along a path if that is what it takes. */
  const augment = (ordinal: number, visited: Set<number>): boolean => {
    const options = choices.get(ordinal) ?? [];
    for (const candidate of options) {
      if (!holderOf.has(candidate.locationId) && !visited.has(candidate.locationId)) {
        visited.add(candidate.locationId);
        assign(candidate);
        return true;
      }
    }
    for (const candidate of options) {
      if (visited.has(candidate.locationId)) continue;
      visited.add(candidate.locationId);
      const holder = holderOf.get(candidate.locationId);
      if (holder !== undefined && holder !== ordinal && augment(holder, visited)) {
        assign(candidate);
        return true;
      }
    }
    return false;
  };

  let grew = false;
  for (const ordinal of [...choices.keys()].sort((a, b) => a - b)) {
    if (rowOf.has(ordinal)) continue;
    if (augment(ordinal, new Set())) grew = true;
  }
  if (!grew) return null;
  return [...rowOf.values()]
    .map(({ ordinal, locationId, metres }) => ({ ordinal, locationId, metres }))
    .sort((a, b) => a.ordinal - b.ordinal);
}
