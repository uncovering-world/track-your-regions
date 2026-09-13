/**
 * Tests for the ticks (#852): one row, a shift-click range over the loaded
 * rows, the whole page, all matching — and the two ways a tick goes away,
 * a filter change with a notice, and a row that left the list.
 */

import { describe, it, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useRowSelection } from './useRowSelection';
import type { QueueRow } from '../queueRows';

function row(key: string): QueueRow {
  const [kind, id] = key.split(':');
  return {
    key, kind: kind as QueueRow['kind'], id: Number(id), name: key, placeKind: 'c',
    question: '', askedAt: null, runId: null, specific: '', subs: [],
  };
}

const ROWS = ['waiting:1', 'waiting:2', 'waiting:3', 'refused:4'].map(row);

function renderSelection(rows = ROWS, filterKey = 'a') {
  const onCleared = vi.fn();
  const hook = renderHook(
    ({ rows: r, filterKey: f }) => useRowSelection(r, f, onCleared),
    { initialProps: { rows, filterKey } },
  );
  return { ...hook, onCleared };
}

describe('useRowSelection', () => {
  it('toggles one row, and a second click on it clears the tick', () => {
    const { result } = renderSelection();
    act(() => result.current.toggle('waiting:2'));
    expect([...result.current.keys]).toEqual(['waiting:2']);
    act(() => result.current.toggle('waiting:2'));
    expect(result.current.keys.size).toBe(0);
  });

  it('ticks the range from the last row clicked on a shift-click, over the rows as loaded', () => {
    const { result } = renderSelection();
    act(() => result.current.toggle('waiting:1'));
    act(() => result.current.toggle('refused:4', true));
    expect([...result.current.keys].sort()).toEqual(['refused:4', 'waiting:1', 'waiting:2', 'waiting:3']);
  });

  it('ticks and clears the loaded rows from the header, and narrows all-matching back to ticks', () => {
    const { result } = renderSelection();
    act(() => result.current.selectAllMatching());
    expect(result.current.allMatching).toBe(true);
    expect(result.current.keys.size).toBe(4);

    // A tick by hand is a narrower statement than "all matching".
    act(() => result.current.toggle('waiting:1'));
    expect(result.current.allMatching).toBe(false);
    expect(result.current.keys.size).toBe(3);

    act(() => result.current.setLoaded(false));
    expect(result.current.keys.size).toBe(0);
  });

  it('clears the ticks with a notice when the filters change', () => {
    const { result, rerender, onCleared } = renderSelection();
    act(() => result.current.setLoaded(true));
    rerender({ rows: ROWS.slice(0, 2), filterKey: 'b' });
    expect(result.current.keys.size).toBe(0);
    expect(onCleared).toHaveBeenCalledWith(4);
  });

  it('says nothing when the filters change with nothing ticked', () => {
    const { rerender, onCleared } = renderSelection();
    rerender({ rows: ROWS, filterKey: 'b' });
    expect(onCleared).not.toHaveBeenCalled();
  });

  it('ticks a row Show more brings in while all matching is selected', () => {
    const { result, rerender } = renderSelection();
    act(() => result.current.selectAllMatching());
    rerender({ rows: [...ROWS, row('missing:5')], filterKey: 'a' });
    expect(result.current.allMatching).toBe(true);
    expect(result.current.keys.has('missing:5')).toBe(true);
  });

  it('does not re-tick the new list when a filter change out of all matching lands with its rows', () => {
    // A filter visited in the last minute answers from the cache in the same
    // render as the key change, so the rows and the filter move in one commit;
    // the prune effect must not read the render-time all-matching flag and
    // tick the new list right after the notice said the ticks were cleared.
    const { result, rerender, onCleared } = renderSelection();
    act(() => result.current.selectAllMatching());
    rerender({ rows: [row('refused:9'), row('refused:10')], filterKey: 'b' });
    expect(onCleared).toHaveBeenCalledWith(4);
    expect(result.current.allMatching).toBe(false);
    expect(result.current.keys.size).toBe(0);
  });

  it('drops a tick whose row left the list, and keeps the rest through Show more', () => {
    const { result, rerender } = renderSelection();
    act(() => result.current.toggle('waiting:1'));
    act(() => result.current.toggle('waiting:2'));
    // Row 1 answered away; a fifth row loaded.
    rerender({ rows: [...ROWS.slice(1), row('missing:5')], filterKey: 'a' });
    expect([...result.current.keys]).toEqual(['waiting:2']);
  });
});
