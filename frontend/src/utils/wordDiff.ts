/**
 * Which words differ between two versions of the same text.
 *
 * Written here rather than taken from a library, and the reason is the size of the
 * problem rather than a dislike of dependencies. The only field where a curator needs
 * this is `shortDescription`: nineteen conflicts on the dev database, longest value 1339
 * characters, average 841 — about a hundred and fifty words. `name` runs to 37, and the
 * longest description in the whole catalogue is 1943 characters. Against that, a word
 * table is milliseconds and forty lines, and the frontend keeps seventeen runtime
 * dependencies for a screen a handful of curators open.
 *
 * The property that makes the trade safe: **this decides nothing.** Both values are
 * rendered in full whatever comes back, and every action applies to a whole value, so a
 * mismarked word costs a curator a second of reading — not a wrong decision, and never a
 * wrong write. That is a different class of risk from the code that stores a verdict.
 *
 * Above `MAX_WORDS` the comparison is refused rather than attempted: the table is
 * quadratic, and a pathological value would freeze the tab it is meant to help. The
 * caller renders both values plainly and says why.
 */

/** One run of text, and whether this side is the only one that has it. */
export interface DiffPart {
  text: string;
  /** Present only on a run this side has and the other does not. */
  changed?: true;
}

export interface WordDiff {
  before: DiffPart[];
  after: DiffPart[];
  /** True when the values were too long to compare; both sides come back unmarked. */
  capped?: true;
}

/**
 * About one and a half times the longest value measured, in words — which is thinner
 * headroom than a round number suggests, and worth stating rather than rounding away:
 * 1339 characters of conflicted `shortDescription` is roughly 240 words at the 5.6
 * characters this catalogue averages, and the longest description in it, at 1943, is
 * roughly 350.
 *
 * Not a performance cliff — 400×400 is a 160k-cell table, still under a millisecond — but
 * the point past which a value is no longer the kind of text this screen is for. Past it
 * nothing breaks: both values render in full, unmarked, and the caller says why.
 */
const MAX_WORDS = 400;

/** Words with their trailing space, so joining the parts reproduces the input exactly. */
function tokenize(text: string): string[] {
  return text.match(/\S+\s*|\s+/g) ?? [];
}

function merge(parts: DiffPart[]): DiffPart[] {
  const merged: DiffPart[] = [];
  for (const part of parts) {
    const last = merged[merged.length - 1];
    if (last && !!last.changed === !!part.changed) last.text += part.text;
    else merged.push({ ...part });
  }
  return merged;
}

export function wordDiff(before: string, after: string): WordDiff {
  const a = tokenize(before);
  const b = tokenize(after);
  if (a.length > MAX_WORDS || b.length > MAX_WORDS) {
    return { before: [{ text: before }], after: [{ text: after }], capped: true };
  }

  // Longest common subsequence over words, filled from the end so the walk below reads
  // forwards — which is what keeps the parts in the order a person reads them.
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const beforeParts: DiffPart[] = [];
  const afterParts: DiffPart[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      beforeParts.push({ text: a[i] });
      afterParts.push({ text: b[j] });
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      beforeParts.push({ text: a[i], changed: true });
      i += 1;
    } else {
      afterParts.push({ text: b[j], changed: true });
      j += 1;
    }
  }
  for (; i < a.length; i += 1) beforeParts.push({ text: a[i], changed: true });
  for (; j < b.length; j += 1) afterParts.push({ text: b[j], changed: true });

  return { before: merge(beforeParts), after: merge(afterParts) };
}
