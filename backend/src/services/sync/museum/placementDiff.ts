/**
 * A rule that changes where works live must show what it changed. During design, fixing the
 * statement-rank bug silently admitted a museum nobody visits for the Syndics, and fixing that
 * silently dropped Tate Britain along with Ophelia. Neither was caught by a test; both were
 * caught by this diff.
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
