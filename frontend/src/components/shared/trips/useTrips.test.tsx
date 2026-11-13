/**
 * A place's trip writes (#2120): whether the last one failed, for the
 * section to say so, until the next one starts.
 */
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useTrips } from './useTrips';

const api = vi.hoisted(() => ({ add: vi.fn(), change: vi.fn() }));
vi.mock('../../../hooks/useAuth', () => ({ useAuth: () => ({ isAuthenticated: true, user: { id: 7 } }) }));
vi.mock('../../../api/trips', () => ({
  fetchTrips: async (experienceId: number) => ({ experienceId, visited: true, trips: [] }),
  addTrip: api.add,
  changeTrip: api.change,
  removeTrip: vi.fn(),
  restoreVisits: vi.fn(),
}));

const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
const MARCH_2022 = { year: 2022, month: 3, day: null };

describe("a place's trip writes", () => {
  it('say the last one failed, until the next one starts', async () => {
    const { result } = renderHook(() => useTrips(9461), { wrapper });
    expect(result.current.failed).toBe(false);

    api.add.mockRejectedValue(new Error('Network error'));
    act(() => result.current.add(MARCH_2022));
    await waitFor(() => expect(result.current.failed).toBe(true));

    api.change.mockResolvedValue({ success: true });
    act(() => result.current.change({ tripId: 1, date: MARCH_2022 }));
    await waitFor(() => expect(result.current.failed).toBe(false));
  });
});
