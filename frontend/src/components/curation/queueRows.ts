/**
 * The queue as one list of questions, which is how a curator works it.
 *
 * The response arrives as eight arrays because they are eight queries; a curator does not
 * think in arrays. They work down a list, and what they need from each entry before opening
 * it is which object it is about and what is being asked — enough to skip one, which is the
 * whole reason a list beats a stack of cards.
 *
 * Pure and separate from the rendering because the ordering is a product decision and the
 * only thing worth testing here. The three gated kinds arrive already grouped by experience
 * (`groupGated`), so one museum holding a label change *and* twelve new paintings is one
 * row, as it is one decision.
 */

import type { ReviewQueue, ReviewQueueItem, ReviewQueueKind } from '../../api/experiences';
import { groupGated, type GatedGroup } from './WaitingToPublish';

/** Which of the five questions a row asks. `waiting` is the three gated kinds, grouped. */
export type RowKind = 'missing' | 'refused' | 'conflicts' | 'waiting' | 'withdrawn';

export interface QueueRow {
  /** Stable across refetches: the same object under the same question keeps its place. */
  key: string;
  kind: RowKind;
  id: number;
  name: string;
  category: string;
  /** What is being asked, in the words the section heading uses. */
  question: string;
  item?: ReviewQueueItem;
  group?: GatedGroup;
}

const QUESTION: Record<RowKind, string> = {
  missing: 'gone from the source',
  refused: 'our rule turned it down',
  conflicts: 'the source disagrees with an edit',
  waiting: 'waiting to be published',
  withdrawn: 'lost places it is made of',
};

function rowFor(kind: Exclude<RowKind, 'waiting'>, item: ReviewQueueItem): QueueRow {
  return {
    key: `${kind}:${item.id}`,
    kind,
    id: item.id,
    name: item.name,
    category: item.category_name,
    question: QUESTION[kind],
    item,
  };
}

/**
 * Every open question, in the order a curator meets them.
 *
 * Conflicts first, then arrivals, then lost places, then refusals, then the missing —
 * cheapest decision first is the wrong rule here, and this is deliberately not it. A
 * conflict is a curator's own words being argued with, an arrival is a reader seeing nothing
 * at all; both are somebody waiting. A lost place has already *taken* something away — a pin
 * a reader could see, sometimes one they had ticked — which is why it sits above a refusal,
 * where the row was never shown at all and the question is only whether our rule was right.
 * A missing row changes nothing until answered. The list is worked from the top, so the
 * order is the claim about what matters most.
 *
 * `keptOut` is absent on purpose: it is answered work, and the page keeps it collapsed at
 * the foot where a mis-click can be undone.
 */
export function queueRows(data: ReviewQueue | undefined): QueueRow[] {
  if (!data) return [];
  const gated = groupGated(data.arrivals ?? [], data.held ?? [], data.contents ?? []);
  return [
    ...(data.conflicts ?? []).map(item => rowFor('conflicts', item)),
    ...gated.map(group => ({
      key: `waiting:${group.id}`,
      kind: 'waiting' as const,
      id: group.id,
      name: group.name,
      // The group carries no category of its own — it is three kinds about one object, and
      // whichever of them is present names the same category.
      category: (group.arrival ?? group.held ?? group.contents)?.category_name ?? '',
      question: QUESTION.waiting,
      group,
    })),
    ...(data.withdrawn ?? []).map(item => rowFor('withdrawn', item)),
    ...(data.refused ?? []).map(item => rowFor('refused', item)),
    ...(data.missing ?? []).map(item => rowFor('missing', item)),
  ];
}

/**
 * Where the selection goes when the row it was on is answered and disappears.
 *
 * By index and not by key, deliberately: the answered row is gone from the list by the time
 * this is asked, so its key finds nothing and the position is the only thing left to carry.
 * The row that took its place is the next question; the last row when the list just got
 * shorter than the index. Never back to the top — that costs a scroll per card, which is
 * the whole reason a queue stops being worked from the keyboard.
 *
 * Returns undefined only when nothing is left, which is the one time a curator wants to be
 * told rather than moved.
 */
export function nextSelection(rows: QueueRow[], previousIndex: number): string | undefined {
  if (rows.length === 0) return undefined;
  if (previousIndex < 0) return rows[0].key;
  return rows[Math.min(previousIndex, rows.length - 1)].key;
}

/** The kinds a row can belong to, in list order — used by the pagers. */
export const ROW_KINDS: readonly RowKind[] = ['conflicts', 'waiting', 'withdrawn', 'refused', 'missing'];

/** Short enough to sit on a button, in the words the headings use. */
export const KIND_NAME: Record<RowKind, string> = {
  conflicts: 'disagreements',
  waiting: 'waiting to be published',
  withdrawn: 'lost places',
  refused: 'refused',
  missing: 'gone from the source',
};

/** Which queue arrays a row kind pages. `waiting` is three of them. */
export const KINDS_BEHIND: Record<RowKind, readonly ReviewQueueKind[]> = {
  conflicts: ['conflicts'],
  waiting: ['arrivals', 'held', 'contents'],
  withdrawn: ['withdrawn'],
  refused: ['refused'],
  missing: ['missing'],
};
