/**
 * What each answer does for each kind of row, in the words the row's own card
 * uses (#852).
 *
 * Every row in the review feed is a change the source proposes, and a
 * proposal has two answers — accept it or reject it — whatever the kind. The
 * cards keep the verbs they had, because each names the *consequence* ("The
 * rule was wrong — put it back"), and a batch offering two bare words over
 * seven kinds would be asking a curator to translate. So the bar and the
 * summary quote these, per kind, and the single-row cards say the same.
 *
 * The keys are the row's own kind, with `waiting` split by the sub-kind the
 * row carries, since an arrival, a held change and unread contents are three
 * different proposals under one row (ADR-0025).
 */

import type { RowKind } from '../queueRowTypes';

/**
 * What this module reads off a row: its kind and, for `waiting`, the
 * sub-kinds it holds. A `QueueRow` satisfies it; the type is narrower so the
 * cards can import these words without a cycle through `queueRows.ts`.
 */
export interface AnswerableRow {
  kind: RowKind;
  subs: string[];
}

export type AnswerableKind =
  | 'arrival' | 'held' | 'contents' | 'conflicts' | 'refused' | 'missing' | 'withdrawn';

export interface AnswerWords {
  /** What the row proposes, as the bar's expansion states it. */
  proposes: string;
  accept: string;
  reject: string;
  /** Only the two kinds that have a third answer carry it. */
  lost?: string;
}

export const ANSWER_WORDS: Record<AnswerableKind, AnswerWords> = {
  arrival: {
    proposes: 'add this object',
    accept: 'Publish — readers may see it',
    reject: 'Keep it out',
  },
  held: {
    proposes: 'change fields of an object readers see',
    accept: 'Publish the change',
    reject: 'Not this — refuse every held field',
  },
  contents: {
    proposes: 'add points and works under an object readers see',
    accept: 'Publish what has arrived',
    reject: 'Turn them down — they stay unread',
  },
  conflicts: {
    proposes: 'change a field over your edit',
    accept: 'Take the source’s',
    reject: 'Keep ours',
  },
  refused: {
    proposes: 'add this object, which our rule turned down',
    accept: 'The rule was wrong — put it back',
    reject: 'The rule was right — keep it out',
  },
  missing: {
    proposes: 'delist this object',
    accept: 'Former — delisted, still there',
    reject: 'False alarm — it stays',
    lost: 'Lost — no longer exists',
  },
  withdrawn: {
    proposes: 'remove the places it is made of',
    accept: 'The source dropped them',
    reject: 'False alarm — they stay',
    lost: 'They no longer exist',
  },
};

/** The plural noun the bar counts a kind by. */
export const KIND_NOUN: Record<AnswerableKind, [string, string]> = {
  arrival: ['arrival', 'arrivals'],
  held: ['held change', 'held changes'],
  contents: ['object with unread contents', 'objects with unread contents'],
  conflicts: ['disagreement', 'disagreements'],
  refused: ['refusal', 'refusals'],
  missing: ['object gone from the source', 'objects gone from the source'],
  withdrawn: ['object with lost places', 'objects with lost places'],
};

/**
 * The answerable kinds a row is about — one for every kind but `waiting`,
 * whose row carries up to three.
 */
export function kindsOf(row: AnswerableRow): AnswerableKind[] {
  if (row.kind !== 'waiting') return [row.kind];
  const subs = row.subs.filter((s): s is 'arrival' | 'held' | 'contents' =>
    s === 'arrival' || s === 'held' || s === 'contents');
  return subs.length > 0 ? subs : ['arrival'];
}

/** How many of the selection are about each kind, in the table's order. */
export function countByKind(rows: AnswerableRow[]): Array<{ kind: AnswerableKind; count: number }> {
  const counts = new Map<AnswerableKind, number>();
  for (const row of rows) {
    for (const kind of kindsOf(row)) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return (Object.keys(ANSWER_WORDS) as AnswerableKind[])
    .filter(kind => counts.has(kind))
    .map(kind => ({ kind, count: counts.get(kind)! }));
}

/**
 * Whether *Lost* is on offer: only for a selection wholly of one of the two
 * kinds that have it. Lost is the curator's own claim about the world, not an
 * answer to the proposal, so a mixed selection cannot carry it.
 */
export function lostOffered(rows: AnswerableRow[]): boolean {
  if (rows.length === 0) return false;
  return rows.every(r => r.kind === 'missing') || rows.every(r => r.kind === 'withdrawn');
}

/**
 * *Lost* for a selection that reaches past the ticks. An all-matching
 * selection is every row the filters match, which the ticks do not show, so
 * the ticks alone cannot say the selection is wholly of one verdict kind —
 * only a kind filter pinning the list to exactly that kind can. Without it,
 * *Lost* would go to every arrival and conflict the walk meets, each refused,
 * and a page of refusals is where the walk stops.
 */
export function lostOfferedFor(
  rows: AnswerableRow[], allMatching: boolean, kinds: readonly string[],
): boolean {
  if (!lostOffered(rows)) return false;
  if (!allMatching) return true;
  return kinds.length === 1 && (kinds[0] === 'missing' || kinds[0] === 'withdrawn');
}

/**
 * How many of the rows the filters match are about each kind, from the
 * queue's own facet counts — what an all-matching confirmation has to name,
 * since the loaded rows are one page of a list that may hold every kind.
 *
 * The kind facet is counted under every filter *but* the kind filter
 * (ADR-0051 decision 3), so where a kind filter is set only its kinds are
 * taken; `waiting` itself is skipped, since its three sub-kinds are listed
 * beside it and are what the answer words are about.
 */
export function matchingKindCounts(
  facets: { kind: Array<{ kind: string; count: number }> } | undefined,
  kinds: readonly string[],
): Array<{ kind: AnswerableKind; count: number }> {
  if (!facets) return [];
  const chosen = new Set(kinds);
  return facets.kind
    .filter(f => f.kind !== 'waiting' && f.count > 0 && (chosen.size === 0 || chosen.has(f.kind)))
    .map(f => ({ kind: f.kind === 'conflict' ? 'conflicts' : f.kind, count: f.count }))
    // Only the kinds the table knows: a facet word a newer server sends must
    // not reach `ANSWER_WORDS[kind]` as a key the table has no row for.
    .filter((f): f is { kind: AnswerableKind; count: number } => f.kind in ANSWER_WORDS);
}

/**
 * The gated sub-kinds an all-matching answer reaches *beyond* what a kind
 * filter names. The queue's kind filter lists a `waiting` row by any sub-kind
 * it holds, and the answer reaches every sub-kind the row holds — so under a
 * *holds a change* filter the rows' unread contents are answered too, and
 * under an *unread* filter their held changes. Not countable from the
 * facets, which are counted without the kind filter; named, not counted. An
 * arrival is always alone (`held` and `contents` fire only on a passed row).
 */
export function gatedKindsAlsoReached(kinds: readonly string[]): AnswerableKind[] {
  const reached: AnswerableKind[] = [];
  if (kinds.includes('held') && !kinds.includes('contents')) reached.push('contents');
  if (kinds.includes('contents') && !kinds.includes('held')) reached.push('held');
  return reached;
}

/** The verb a confirmation is headed and pressed with. */
export function answerVerb(answer: 'accept' | 'reject' | 'lost' | null): string {
  if (answer === 'lost') return 'Record as lost';
  if (answer === 'reject') return 'Reject';
  return 'Accept';
}

/** The count line the bar shows: "40 arrivals, 3 refusals, 12 objects gone from the source". */
export function countLine(rows: AnswerableRow[]): string {
  return countByKind(rows)
    .map(({ kind, count }) => `${count.toLocaleString('en')} ${KIND_NOUN[kind][count === 1 ? 0 : 1]}`)
    .join(', ');
}
