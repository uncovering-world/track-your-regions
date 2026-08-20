/**
 * A rule that changes where works live must show what it changed. During design, fixing the
 * statement-rank bug silently admitted a museum nobody visits for the Syndics, and fixing that
 * silently dropped Tate Britain along with Ophelia. Neither was caught by a test; both were
 * caught by this diff.
 *
 * **Both sides are placements, and anything that later diffs contents for a curator must be too.**
 * Measured 2026-08-20: read as raw statements, this source has withdrawn 138 links, 113 of them the
 * Louvre's — because Wikidata now files those works under curatorial departments and rooms rather
 * than under the museum. Resolved, the number is zero and nothing has moved. A queue card built on
 * the first number tells a curator the Louvre has lost the Venus de Milo and offers them a button
 * that acts on it. `placement.test.ts` § "a work filed under a department and a room" pins both
 * halves.
 */
export interface PlacementDiff {
  moved: { work: string; from: string[]; to: string[] }[];
  gained: string[];
  /** Still in the pool, placed nowhere — accuses a placement rule. */
  lost: string[];
  /** Not in the pool at all — accuses the fetch. */
  dropped: string[];
}

export function diffPlacements(
  previous: Record<string, string[]>,
  current: Record<string, string[]>,
): PlacementDiff {
  const diff: PlacementDiff = { moved: [], gained: [], lost: [], dropped: [] };
  const key = (v: string[]) => [...v].sort().join('|');
  for (const [work, now] of Object.entries(current)) {
    const before = previous[work];
    if (before === undefined || key(before) === key(now)) continue;
    if (!before.length && now.length) { diff.gained.push(work); continue; }
    if (before.length && !now.length) { diff.lost.push(work); continue; }
    diff.moved.push({ work, from: before, to: now });
  }
  for (const work of Object.keys(previous)) {
    if (current[work] === undefined) diff.dropped.push(work);
  }
  return diff;
}
