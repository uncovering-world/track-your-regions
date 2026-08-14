/**
 * Tests for the queue as one list.
 *
 * Two properties, and both are product decisions rather than mechanics: the order a curator
 * meets the questions in, and where the selection lands when the row they just answered
 * disappears. The second is what makes the list answerable without the mouse — a selection
 * that jumps to the top after every answer costs a scroll per card.
 */

import { describe, it, expect } from 'vitest';
import { queueRows, nextSelection } from './queueRows';
import type { ReviewQueue, ReviewQueueItem } from '../../api/experiences';

function item(over: Partial<ReviewQueueItem> = {}): ReviewQueueItem {
  return {
    id: 1,
    external_id: 'Q1',
    name: 'Aksum',
    category_id: 1,
    category_name: 'UNESCO World Heritage Sites',
    missing_since: null,
    source_membership: 'present',
    existence: 'extant',
    kind: 'conflict',
    proposed: null,
    ...over,
  } as ReviewQueueItem;
}

function queue(over: Partial<ReviewQueue> = {}): ReviewQueue {
  return {
    missing: [], refused: [], keptOut: [], conflicts: [],
    arrivals: [], held: [], contents: [],
    limit: 25,
    paging: {} as ReviewQueue['paging'],
    ...over,
  };
}

describe('queueRows', () => {
  it('puts somebody waiting before something already settled', () => {
    // A conflict argues with a curator's own words and an arrival leaves a reader seeing
    // nothing; a refusal is already settled for the reader and asks only whether we were
    // right. The list is worked from the top, so this order is the claim about that.
    const rows = queueRows(queue({
      missing: [item({ id: 4, name: 'Dresden' })],
      refused: [item({ id: 3, name: 'British Museum' })],
      conflicts: [item({ id: 1, name: 'Aksum' })],
      arrivals: [item({ id: 2, name: 'Museo Soumaya', kind: 'arrival' })],
    }));

    expect(rows.map(r => r.name)).toEqual(['Aksum', 'Museo Soumaya', 'British Museum', 'Dresden']);
  });

  it('gives one object one row, however many gated kinds name it', () => {
    const rows = queueRows(queue({
      held: [item({ id: 7, name: 'Museo del Prado', kind: 'held' })],
      contents: [item({ id: 7, name: 'Museo del Prado', kind: 'contents' })],
    }));

    expect(rows).toHaveLength(1);
    expect(rows[0].group?.held).toBeDefined();
    expect(rows[0].group?.contents).toBeDefined();
  });

  it('leaves the answered work out of the list of questions', () => {
    // `keptOut` is answered, and the page keeps it collapsed at the foot where a mis-click
    // can be undone — it is not work, so it must not sit among the work.
    const rows = queueRows(queue({ keptOut: [item({ id: 9, kind: 'kept-out' })] }));

    expect(rows).toHaveLength(0);
  });

  it('keeps a row identifiable across kinds, since one object can raise two questions', () => {
    // The same museum can be in `conflicts` for a curator's wording and in `waiting` for a
    // gated change — two questions, two rows, and a key on the id alone would collide.
    const rows = queueRows(queue({
      conflicts: [item({ id: 7, name: 'Museo del Prado' })],
      held: [item({ id: 7, name: 'Museo del Prado', kind: 'held' })],
    }));

    expect(new Set(rows.map(r => r.key)).size).toBe(2);
  });
});

describe('nextSelection', () => {
  const rows = ['a', 'b', 'c'].map(k => ({ key: k })) as ReturnType<typeof queueRows>;

  it('stays at the same place in the list when a row is answered away', () => {
    // The answered row is gone from `rows` by the time this is asked, so the index is the
    // row that took its place — the next question, not the top of the list. By index and
    // not by key for exactly that reason: the key of an answered row finds nothing.
    expect(nextSelection(rows.slice(1), 0)).toBe('b');
  });

  it('steps back when the answered row was the last one', () => {
    expect(nextSelection(rows.slice(0, 2), 2)).toBe('b');
  });

  it('says there is nothing left rather than picking something', () => {
    expect(nextSelection([], 0)).toBeUndefined();
  });

  it('starts at the top when nothing was selected', () => {
    expect(nextSelection(rows, -1)).toBe('a');
  });
});
