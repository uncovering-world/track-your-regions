/**
 * One read of whether any visit write of this traveller is on its way (#2120):
 * every control that writes a visit waits on it.
 */

import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query';
import { queryKeys } from '../api/queryKeys';
import { useVisitWritePending } from './useVisitedExperiences';

describe('useVisitWritePending', () => {
  it('is true while a write carrying the visit key is on its way, and false once it lands', async () => {
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    let land: () => void = () => {};
    const { result } = renderHook(() => ({
      pending: useVisitWritePending(),
      write: useMutation({
        mutationKey: queryKeys.visited.write,
        mutationFn: () => new Promise<void>(resolve => { land = resolve; }),
      }),
    }), { wrapper });

    expect(result.current.pending).toBe(false);
    act(() => { result.current.write.mutate(); });
    await waitFor(() => expect(result.current.pending).toBe(true));
    act(() => { land(); });
    await waitFor(() => expect(result.current.pending).toBe(false));
  });
});
