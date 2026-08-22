/**
 * What the accumulate-and-flush behind New-badge impressions must hold.
 *
 * The server keeps the *first* impression, so the failure being guarded is not
 * recoverable: an id reported for a row nobody was shown spends that reader's
 * personal week, and an id leaked across a region change reports one region's
 * rows against another's list. The flush timer is the other half — windowing
 * made the seen-set change on every scroll, and each change used to be a
 * request against a shared rate limit.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSeenWindowIds } from './useSeenWindowIds';

const FLUSH_MS = 800;

function renderSeen(initialIds: number[], initialKey: string | number | null) {
  return renderHook(
    ({ ids, key }: { ids: number[]; key: string | number | null }) => useSeenWindowIds(ids, key),
    { initialProps: { ids: initialIds, key: initialKey } },
  );
}

describe('useSeenWindowIds', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('accumulates what the window has held, across window movements', () => {
    const { result, rerender } = renderSeen([1, 2], 'region-1');
    act(() => { vi.advanceTimersByTime(FLUSH_MS); });
    expect(result.current).toEqual(new Set([1, 2]));

    // The reader scrolls on; the earlier rows are not unseen by leaving.
    rerender({ ids: [3], key: 'region-1' });
    act(() => { vi.advanceTimersByTime(FLUSH_MS); });
    expect(result.current).toEqual(new Set([1, 2, 3]));
  });

  it('holds new ids back until the flush timer fires', () => {
    // One report per interval, not one per scroll frame: the set feeds a
    // request, and `authenticatedLimiter` counts every one of them.
    const { result } = renderSeen([1, 2], 'region-1');
    expect(result.current).toEqual(new Set());
    act(() => { vi.advanceTimersByTime(FLUSH_MS - 1); });
    expect(result.current).toEqual(new Set());
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current).toEqual(new Set([1, 2]));
  });

  it('resets in the render that changes the key, not an effect later', () => {
    const { result, rerender } = renderSeen([1, 2], 'region-1');
    act(() => { vi.advanceTimersByTime(FLUSH_MS); });

    // The same render that carries region B's rows must carry an empty set: one
    // commit of B's rows against A's seen-set reports rows nobody has seen.
    rerender({ ids: [9], key: 'region-2' });
    expect(result.current).toEqual(new Set());
    act(() => { vi.advanceTimersByTime(FLUSH_MS); });
    expect(result.current).toEqual(new Set([9]));
  });

  it('drops rows still waiting to be flushed when the key changes', () => {
    // Ids pending from region A must not surface once the timer comes round
    // against region B's list.
    const { result, rerender } = renderSeen([1, 2], 'region-1');
    rerender({ ids: [], key: 'region-2' });
    act(() => { vi.advanceTimersByTime(FLUSH_MS * 2); });
    expect(result.current).toEqual(new Set());
  });
});
