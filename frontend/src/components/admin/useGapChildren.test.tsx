import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const { fetchSubdivisions } = vi.hoisted(() => ({ fetchSubdivisions: vi.fn() }));
vi.mock('../../api/divisions', () => ({ fetchSubdivisions }));

import { useGapChildren } from './useGapChildren';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

const SYDNEY = { id: 6, name: 'Sydney', parentId: 4, hasChildren: false, focusBbox: null, anchorPoint: null };

/** A level of the gap tree is read when it is first expanded, once (#1030). */
describe('useGapChildren', () => {
  beforeEach(() => fetchSubdivisions.mockReset());

  it('reads a level once, from GADM, a whole page of it', async () => {
    fetchSubdivisions.mockResolvedValue([SYDNEY]);
    const { result } = renderHook(() => useGapChildren(), { wrapper });

    act(() => result.current.ensureLoaded(4));
    await waitFor(() => expect(result.current.loaded.get(4)).toEqual([{ id: 6, name: 'Sydney', hasChildren: false }]));
    act(() => result.current.ensureLoaded(4));

    expect(fetchSubdivisions).toHaveBeenCalledTimes(1);
    expect(fetchSubdivisions).toHaveBeenCalledWith(4, 1, { limit: 1000 });
  });

  it('asks again after a read that failed', async () => {
    fetchSubdivisions.mockRejectedValueOnce(new Error('offline')).mockResolvedValue([SYDNEY]);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { result } = renderHook(() => useGapChildren(), { wrapper });

    act(() => result.current.ensureLoaded(4));
    await waitFor(() => expect(result.current.failed.has(4)).toBe(true));
    act(() => result.current.ensureLoaded(4));
    // The retry is loading, not failed, while it runs.
    expect(result.current.failed.has(4)).toBe(false);

    await waitFor(() => expect(result.current.loaded.get(4)).toHaveLength(1));
    expect(result.current.failed.has(4)).toBe(false);
    expect(fetchSubdivisions).toHaveBeenCalledTimes(2);
  });
});
