import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { mockFetchTail } = vi.hoisted(() => ({ mockFetchTail: vi.fn() }));
vi.mock('../api/experiences', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/experiences')>()),
  fetchRegionTail: mockFetchTail,
}));

import { useRegionTail } from './useRegionTail';

const LAZIO = 6967;
// Santa Sabina, shadowed under Places of worship (kind 4).
const SANTA_SABINA = { id: 13500, name: 'Santa Sabina', kind_id: 4 };

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  mockFetchTail.mockReset();
  mockFetchTail.mockImplementation(async (_region: number, kindId: number | null) => ({
    experiences: kindId === 4 || kindId === null ? [SANTA_SABINA] : [],
  }));
});

describe('useRegionTail — a list of one kind (#2224)', () => {
  it('looks for a card in that kind\'s tail only, even where another kind\'s tail is open', async () => {
    const { result, rerender } = renderHook((props: { selected: number | null; kind: number }) => useRegionTail({
      regionId: LAZIO,
      counts: [{ kindId: 4, type: 'church', count: 37 }, { kindId: 3, type: 'statue', count: 2 }],
      selectedExperienceId: props.selected,
      listHoldsSelected: false,
      includeChildren: true,
      lookupKindId: props.kind,
    }), { wrapper, initialProps: { selected: null as number | null, kind: 4 } });

    // The places of worship's tail is open, and holds Santa Sabina.
    act(() => { result.current.toggle(4); });
    await waitFor(() => expect(result.current.places.get(4)).toHaveLength(1));

    // The address names Santa Sabina under Public art (kind 3): not that list's card.
    rerender({ selected: SANTA_SABINA.id, kind: 3 });
    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(result.current.card).toBeNull();
    expect(result.current.find(SANTA_SABINA.id)).toBeUndefined();
    expect(mockFetchTail).toHaveBeenCalledWith(LAZIO, 3, true);
  });
});
