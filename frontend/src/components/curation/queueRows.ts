/**
 * The queue as one list of questions, which is how a curator works it.
 *
 * The response still arrives as one array per kind because each is its own query, but the
 * order a curator meets them in is no longer this file's to decide: `data.order` is the
 * page in the one order the server's keys phase chose — date or class-first, either a
 * complete order across every kind (ADR-0051 decision 2). This file only walks it, picking
 * each entry's hydrated row out of the array (or, for `waiting`, out of the grouped gated
 * kinds — `groupGated` from `WaitingToPublish.tsx`) by kind and id. An entry the keys phase
 * named but the hydrating `WHERE` then rejected — a row answered between the two reads — is
 * skipped rather than thrown on, and logged once so a real gap is not silent.
 */

import type { QueueOrderEntry, ReviewQueue, ReviewQueueItem } from '../../api/reviewQueue';
import { groupGated } from './WaitingToPublish';
import { sectionKind, type GatedGroup } from './gatedGroup';
import type { RowKind } from './queueRowTypes';
import {
  KIND_COLOR, KIND_SHORT, rowSpecific, rowQuestionWord,
} from './feed/rowSpecific';

export type { RowKind } from './queueRowTypes';
export { KIND_COLOR, KIND_SHORT, rowSpecific, rowQuestionWord };

export interface QueueRow {
  /** Stable across refetches: the same object under the same question keeps its place. */
  key: string;
  kind: RowKind;
  id: number;
  name: string;
  /** The kind of place, as the chip beside the name says it — never the row's own `kind`, the question. */
  placeKind: string;
  /** What is being asked, in the words the section heading uses. */
  question: string;
  /** When the run that raised this question completed; `null` for one still in flight. */
  askedAt: string | null;
  runId: number | null;
  /** The text after the row's question word — `rowSpecific`'s own output, carried on the row so it is computed once. */
  specific: string;
  /** The gated sub-kinds a `waiting` row groups (ADR-0025); `[]` for every other kind. */
  subs: string[];
  item?: ReviewQueueItem;
  /**
   * A `refused` row's refusals, one per kind whose rule refused the place, or a `missing`
   * row's kinds whose source stopped listing a place another still lists (#1264); `item` is
   * the first.
   */
  items?: ReviewQueueItem[];
  /** A `waiting` row's questions, a section per kind that asks about the place (#1264). */
  sections?: GatedGroup[];
}

const QUESTION: Record<RowKind, string> = {
  missing: 'gone from the source',
  refused: 'our rule turned it down',
  conflicts: 'the source disagrees with an edit',
  sources: 'two sources disagree',
  waiting: 'waiting to be published',
  withdrawn: 'lost places it is made of',
  'component-items': 'candidate items for its components',
};

/** The server's word for a question kind, mapped to this file's own — only `conflict` differs. */
const ROW_KIND: Record<QueueOrderEntry['kind'], RowKind> = {
  conflict: 'conflicts',
  sources: 'sources',
  waiting: 'waiting',
  withdrawn: 'withdrawn',
  refused: 'refused',
  missing: 'missing',
  'component-items': 'component-items',
};

const warnedKeys = new Set<string>();

/** A key `order` named that no hydrated row answers to — logged once per key, never thrown on. */
function warnSkipped(entry: QueueOrderEntry): void {
  const key = `${entry.kind}:${entry.id}`;
  if (warnedKeys.has(key)) return;
  warnedKeys.add(key);
  // A real gap between the keys phase and the hydrating `WHERE` (a row answered between
  // the two reads) must not read as silence.
  console.warn(`queueRows: no hydrated row for ${key} — skipped`);
}

function waitingRow(entry: QueueOrderEntry, sections: GatedGroup[]): QueueRow {
  return {
    key: `waiting:${entry.id}`,
    kind: 'waiting',
    id: entry.id,
    name: sections[0].name,
    // Every kind that asks, since the row is one place however many of its kinds do.
    placeKind: sections.map(sectionKind).join(', '),
    question: QUESTION.waiting,
    askedAt: entry.askedAt,
    runId: entry.runId,
    specific: rowSpecific({ kind: 'waiting', sections }),
    subs: entry.subs,
    sections,
  };
}

function itemRow(kind: Exclude<RowKind, 'waiting'>, entry: QueueOrderEntry, items: ReviewQueueItem[]): QueueRow {
  const [item] = items;
  return {
    key: `${kind}:${entry.id}`,
    kind,
    id: entry.id,
    name: item.name,
    // Every kind the row asks for: a refusal is a kind's, and a place two rules
    // refused is one row with both (#1264).
    placeKind: items.map(one => one.kind_name).join(', '),
    question: QUESTION[kind],
    askedAt: entry.askedAt,
    runId: entry.runId,
    specific: rowSpecific({ kind, item, items }),
    subs: entry.subs,
    item,
    ...(kind === 'refused' || kind === 'missing' ? { items } : {}),
  };
}

/** The items of one kind of question, by place — several where several memberships ask (#1264). */
function byPlace(items: ReviewQueueItem[] | undefined): Map<number, ReviewQueueItem[]> {
  const map = new Map<number, ReviewQueueItem[]>();
  for (const item of items ?? []) map.set(item.id, [...(map.get(item.id) ?? []), item]);
  return map;
}

/**
 * Every open question, in the order the server's keys phase chose (ADR-0051).
 *
 * `keptOut`, `answeredWithdrawals` and `refusedParts` are absent on purpose, and not merely
 * unread here: all three are answered work, kept collapsed at the page's foot where a
 * mis-click can be undone, and none of them is a kind the keys union ever names —
 * `data.order` cannot mention them.
 */
export function queueRows(data: ReviewQueue | undefined): QueueRow[] {
  if (!data) return [];
  const sectionsById = groupGated(data.arrivals ?? [], data.held ?? [], data.contents ?? []);
  const itemsByKind: Record<Exclude<RowKind, 'waiting'>, Map<number, ReviewQueueItem[]>> = {
    conflicts: byPlace(data.conflicts),
    sources: byPlace(data.sources),
    withdrawn: byPlace(data.withdrawn),
    refused: byPlace(data.refused),
    missing: byPlace(data.missing),
    'component-items': byPlace(data.componentItems),
  };

  const rows: QueueRow[] = [];
  for (const entry of data.order ?? []) {
    const kind = ROW_KIND[entry.kind];
    if (kind === 'waiting') {
      const sections = sectionsById.get(entry.id);
      if (!sections) { warnSkipped(entry); continue; }
      rows.push(waitingRow(entry, sections));
      continue;
    }
    const items = itemsByKind[kind].get(entry.id);
    if (!items) { warnSkipped(entry); continue; }
    rows.push(itemRow(kind, entry, items));
  }
  return rows;
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
