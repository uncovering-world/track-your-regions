/**
 * Tests for the queue as one list.
 *
 * The order a curator meets the questions in is the server's own now (ADR-0051) — this
 * file's own claim shrinks to: walk `data.order`, draw each entry's row from the right
 * place, skip what the hydration does not answer for rather than throw, and say what each
 * row is asking. `nextSelection` keeps its own claim: where the selection lands when the
 * row a curator just answered disappears, which is still worked out here rather than by
 * the server.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  queueRows, nextSelection, rowQuestionWord, KIND_SHORT,
} from './queueRows';
import type {
  HeldPart, QueueOrderEntry, ReviewQueue, ReviewQueueItem,
} from '../../api/experiences';

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

function orderEntry(over: Partial<QueueOrderEntry> = {}): QueueOrderEntry {
  return {
    kind: 'missing', id: 1, askedAt: null, runId: null, subs: [], ...over,
  };
}

function heldPart(over: Partial<HeldPart> = {}): HeldPart {
  return {
    kind: 'treasures', item: { name: null, ref: null }, fields: [], ...over,
  };
}

function queue(over: Partial<ReviewQueue> = {}): ReviewQueue {
  return {
    missing: [], refused: [], keptOut: [], conflicts: [],
    arrivals: [], held: [], contents: [], withdrawn: [], answeredWithdrawals: [],
    limit: 25,
    order: [],
    total: 0,
    facets: {
      kind: [], source: [], region: [], run: [], setAside: { batches: 0 },
    },
    paging: {} as ReviewQueue['paging'],
    ...over,
  };
}

describe('queueRows', () => {
  it('draws rows in the order the server sent, regardless of the arrays\' own order', () => {
    // The arrays list `conflicts` before `missing`; `order` says the opposite. Only
    // `order` may decide what the curator sees first.
    const rows = queueRows(queue({
      conflicts: [item({ id: 1, name: 'Aksum' })],
      missing: [item({
        id: 4, name: 'Dresden', kind: 'missing',
      })],
      order: [
        orderEntry({
          kind: 'missing', id: 4, askedAt: '2026-09-06T10:00:00Z', runId: 90,
        }),
        orderEntry({
          kind: 'conflict', id: 1, askedAt: '2026-09-07T08:00:00Z', runId: 99,
        }),
      ],
    }));

    expect(rows.map(r => r.kind)).toEqual(['missing', 'conflicts']);
    expect(rows.map(r => r.name)).toEqual(['Dresden', 'Aksum']);
    expect(rows[0]).toMatchObject({ askedAt: '2026-09-06T10:00:00Z', runId: 90, subs: [] });
  });

  it('gives one object one row, however many gated kinds name it', () => {
    const rows = queueRows(queue({
      held: [item({ id: 7, name: 'Museo del Prado', kind: 'held' })],
      contents: [item({ id: 7, name: 'Museo del Prado', kind: 'contents' })],
      order: [orderEntry({ kind: 'waiting', id: 7, subs: ['held', 'contents'] })],
    }));

    expect(rows).toHaveLength(1);
    expect(rows[0].group?.held).toBeDefined();
    expect(rows[0].group?.contents).toBeDefined();
  });

  it('leaves the answered work out of the list of questions', () => {
    // `keptOut` is answered, and the page keeps it collapsed at the foot where a mis-click
    // can be undone — it is not a question, so it can never appear in `order` at all.
    const rows = queueRows(queue({ keptOut: [item({ id: 9, kind: 'kept-out' })] }));

    expect(rows).toHaveLength(0);
  });

  it('keeps a row identifiable across kinds, since one object can raise two questions', () => {
    const rows = queueRows(queue({
      conflicts: [item({ id: 7, name: 'Museo del Prado' })],
      held: [item({ id: 7, name: 'Museo del Prado', kind: 'held' })],
      order: [
        orderEntry({ kind: 'conflict', id: 7 }),
        orderEntry({ kind: 'waiting', id: 7, subs: ['held'] }),
      ],
    }));

    expect(new Set(rows.map(r => r.key)).size).toBe(2);
  });

  it('a waiting row grouping an arrival reads "new arrival", with nothing after it', () => {
    const rows = queueRows(queue({
      arrivals: [item({ id: 2, name: 'Museo Soumaya', kind: 'arrival' })],
      order: [orderEntry({ kind: 'waiting', id: 2, subs: ['arrival'] })],
    }));

    expect(rowQuestionWord(rows[0])).toBe(KIND_SHORT.arrival);
    expect(rows[0].specific).toBe('');
  });

  it('humanises a held field\'s name: a mapped key, a local name, and another mapped key', () => {
    const rows = queueRows(queue({
      held: [item({
        id: 7,
        name: 'Museo del Prado',
        kind: 'held',
        proposed: [
          { field: 'metadata.criteria', old: null, new: 'ii' },
          { field: 'nameLocal.ko', old: null, new: '프라도' },
          { field: 'metadata.imageCredit', old: null, new: 'X' },
        ],
      })],
      order: [orderEntry({ kind: 'waiting', id: 7, subs: ['held'] })],
    }));

    expect(rows[0].specific).toBe('criteria, name (ko), picture credit');
  });

  it('counts a held group\'s parts as work(s)', () => {
    const rows = queueRows(queue({
      held: [item({
        id: 8,
        name: 'Museo del Prado',
        kind: 'held',
        proposed: [],
        proposed_parts: [heldPart(), heldPart(), heldPart()],
      })],
      order: [orderEntry({ kind: 'waiting', id: 8, subs: ['held'] })],
    }));

    expect(rows[0].specific).toBe('3 works');
  });

  it('names the unread contents under a waiting group that has them', () => {
    const rows = queueRows(queue({
      contents: [item({
        id: 10, name: 'Rijksmuseum', kind: 'contents', pending_treasures: 12, pending_locations: 3,
      })],
      order: [orderEntry({ kind: 'waiting', id: 10, subs: ['contents'] })],
    }));

    expect(rows[0].specific).toBe('unread: 12 works, 3 places');
  });

  it('a refused row carries the rule\'s own reason', () => {
    const rows = queueRows(queue({
      refused: [item({
        id: 3, name: 'British Museum', kind: 'refused', admission_reason: 'inside a place of worship',
      })],
      order: [orderEntry({ kind: 'refused', id: 3 })],
    }));

    expect(rows[0].specific).toBe('inside a place of worship');
  });

  it('a conflict row names the field the source disagrees on, humanised', () => {
    const rows = queueRows(queue({
      conflicts: [item({
        id: 1, name: 'Aksum', proposed: [{ field: 'shortDescription', old: 'a', new: 'b' }],
      })],
      order: [orderEntry({ kind: 'conflict', id: 1 })],
    }));

    expect(rows[0].specific).toBe('short description');
  });

  it('a withdrawn row counts its lost places', () => {
    const rows = queueRows(queue({
      withdrawn: [item({
        id: 5,
        name: 'Bilbao Fine Arts Museum',
        kind: 'withdrawn',
        withdrawn_points: [
          {
            id: 1, name: null, externalRef: null, missingSince: '2026-09-01', latitude: null, longitude: null, visited: false, replacedMetres: null,
          },
        ],
      })],
      order: [orderEntry({ kind: 'withdrawn', id: 5 })],
    }));

    expect(rows[0].specific).toBe('1 place');
  });

  describe('a key order names that no hydrated row answers to', () => {
    afterEach(() => vi.restoreAllMocks());

    it('is skipped rather than thrown on, and warned about once', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      const rows = queueRows(queue({
        order: [orderEntry({ kind: 'missing', id: 999 })],
      }));

      expect(rows).toHaveLength(0);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('missing:999');
    });
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
