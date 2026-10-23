/**
 * The walk up a containment chain to the nearest place a kind's test passes
 * (#1819), one level at a time. Pure: the chain is handed in, read once by
 * the caller (the museum import's venue graph). Public art lists its chain
 * with `chainOf` (`places/containment.ts`) instead, which keeps how each link
 * was reached.
 */

/** Whether one place passes a kind's test. */
export type PlaceTest = (qid: string) => boolean;

/** The nearest place, or why there is none: two at one level, or nothing that qualifies. */
export type Nearest =
  | { at: string; hops: number }
  | { unresolved: string; why: 'ambiguous' | 'none' };

/** The next level up: every parent of the frontier no earlier level reached. */
function nextLevel(frontier: string[], seen: Set<string>, parentsOf: (qid: string) => readonly string[]): string[] {
  const next: string[] = [];
  for (const qid of frontier) {
    for (const parent of parentsOf(qid)) {
      if (seen.has(parent)) continue;
      seen.add(parent);
      next.push(parent);
    }
  }
  return next;
}

/**
 * The nearest place up the chain from `start` that `isTarget` passes, going
 * up `parentsOf` one level at a time. Two passing at the same level is no
 * answer.
 */
export function nearest(
  start: string, parentsOf: (qid: string) => readonly string[], isTarget: PlaceTest, maxHops: number,
): Nearest {
  const seen = new Set<string>([start]);
  let frontier = [start];
  for (let hop = 1; hop <= maxHops; hop++) {
    frontier = nextLevel(frontier, seen, parentsOf);
    if (!frontier.length) break;
    const passing = frontier.filter(isTarget);
    if (passing.length === 1) return { at: passing[0], hops: hop };
    if (passing.length > 1) return { unresolved: `two qualifying ancestors at hop ${hop}: ${passing.join(', ')}`, why: 'ambiguous' };
  }
  return { unresolved: 'nothing up the chain qualifies', why: 'none' };
}
