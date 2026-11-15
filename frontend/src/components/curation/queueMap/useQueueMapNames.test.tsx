/**
 * The names a short list on the review queue's map reads (#2501): every place of
 * the list is named, however long it is, in reads of at most `QUEUE_MAP_NAMES_MAX`.
 */

import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { QUEUE_MAP_NAMES_MAX } from '@tyr/shared/reviewQueue';

const { fetchNames } = vi.hoisted(() => ({ fetchNames: vi.fn() }));
vi.mock('../../../api/reviewQueue', () => ({ fetchQueueMapNames: fetchNames }));

import { useQueueMapNames } from './useQueueMapNames';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useQueueMapNames (#2501)', () => {
  it('names every place of a list longer than one read, in reads of at most the bound', async () => {
    fetchNames.mockImplementation(async (ids: number[]) => ({ names: ids.map(placeId => ({ placeId, name: `Place ${placeId}` })) }));
    const ids = Array.from({ length: QUEUE_MAP_NAMES_MAX + 1 }, (_, n) => n + 1);
    const { result } = renderHook(() => useQueueMapNames(ids), { wrapper });

    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(fetchNames).toHaveBeenCalledTimes(2);
    expect(fetchNames.mock.calls.map(([asked]) => (asked as number[]).length)).toEqual([QUEUE_MAP_NAMES_MAX, 1]);
    expect(result.current.nameOf(1)).toBe('Place 1');
    expect(result.current.nameOf(QUEUE_MAP_NAMES_MAX + 1)).toBe(`Place ${QUEUE_MAP_NAMES_MAX + 1}`);
  });

  it('reads nothing while no list is open', () => {
    fetchNames.mockClear();
    const { result } = renderHook(() => useQueueMapNames([]), { wrapper });
    expect(result.current.pending).toBe(false);
    expect(fetchNames).not.toHaveBeenCalled();
  });
});
