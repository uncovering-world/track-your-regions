/**
 * The open card is in the address (#644): `/wv/5/r/6737-europe/e/1234-stonehenge`.
 *
 * The address is the source of truth for which card is open; the provider
 * derives the selection from it and writes it on a click. A card the region's
 * list does not hold — hidden, rejected, elsewhere, or simply not there — is
 * dropped from the address once the list has answered, in place and in
 * silence.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation, useNavigationType } from 'react-router';
import type { Experience } from '../api/experiences';

const { mockFetchByRegion } = vi.hoisted(() => ({ mockFetchByRegion: vi.fn() }));
vi.mock('../api/experiences', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/experiences')>();
  return { ...actual, fetchExperiencesByRegion: mockFetchByRegion };
});

import { ExperienceProvider, useExperienceContext } from './useExperienceContext';

const STONEHENGE = { id: 1234, name: 'Stonehenge', type: 'cultural', category_name: 'UNESCO World Heritage Sites' } as Experience;

function wrapperAt(entry: string, regionId: number | null = 6737) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <MemoryRouter initialEntries={[entry]}>
        <QueryClientProvider client={client}>
          <ExperienceProvider regionId={regionId} isExploring>{children}</ExperienceProvider>
        </QueryClientProvider>
      </MemoryRouter>
    );
  };
}

function useUnderTest() {
  const ctx = useExperienceContext();
  const location = useLocation();
  return { ctx, at: `${location.pathname}${location.search}`, type: useNavigationType() };
}

describe('the open card is in the address', () => {
  beforeEach(() => {
    mockFetchByRegion.mockReset();
    mockFetchByRegion.mockResolvedValue({ experiences: [STONEHENGE], total: 1, lostHidden: 0 });
  });

  it('reads the open card from the address', () => {
    const { result } = renderHook(useUnderTest, { wrapper: wrapperAt('/wv/5/r/6737/e/1234') });
    expect(result.current.ctx.selectedExperienceId).toBe(1234);
  });

  it('opens a card by writing it into the address, pushed, with its slug', async () => {
    const { result } = renderHook(useUnderTest, { wrapper: wrapperAt('/wv/5/r/6737-europe') });
    await waitFor(() => expect(result.current.ctx.experiences).toHaveLength(1));

    act(() => { result.current.ctx.toggleSelectedExperience(1234); });

    await waitFor(() => expect(result.current.at).toBe('/wv/5/r/6737-europe/e/1234-stonehenge'));
    expect(result.current.type).toBe('PUSH');
    expect(result.current.ctx.selectedExperienceId).toBe(1234);
  });

  it('closes a card by taking it out of the address, pushed', async () => {
    const { result } = renderHook(useUnderTest, { wrapper: wrapperAt('/wv/5/r/6737-europe/e/1234-stonehenge') });

    act(() => { result.current.ctx.toggleSelectedExperience(1234); });

    await waitFor(() => expect(result.current.at).toBe('/wv/5/r/6737-europe'));
    expect(result.current.type).toBe('PUSH');
    expect(result.current.ctx.selectedExperienceId).toBeNull();
  });

  it('brings the card\'s slug up to date in place once the list names it', async () => {
    // A deep link carries whatever slug it was made with — or none at all, the
    // shape the region's own canonicalisation leaves behind, since that write
    // knows the region's name and not the card's.
    const { result } = renderHook(useUnderTest, { wrapper: wrapperAt('/wv/5/r/6737-europe/e/1234') });

    await waitFor(() => expect(result.current.at).toBe('/wv/5/r/6737-europe/e/1234-stonehenge'));
    expect(result.current.type).toBe('REPLACE');
    expect(result.current.ctx.selectedExperienceId).toBe(1234);
  });

  it('keeps the region\'s slug while it corrects the card\'s', async () => {
    const { result } = renderHook(useUnderTest, { wrapper: wrapperAt('/wv/5/r/6737-europe/e/1234-old-name') });

    await waitFor(() => expect(result.current.at).toBe('/wv/5/r/6737-europe/e/1234-stonehenge'));
  });

  it('drops a card the region does not hold, once the list has answered', async () => {
    const { result } = renderHook(useUnderTest, { wrapper: wrapperAt('/wv/5/r/6737-europe/e/999-nowhere') });

    await waitFor(() => expect(result.current.at).toBe('/wv/5/r/6737-europe'));
    expect(result.current.type).toBe('REPLACE');
    expect(result.current.ctx.selectedExperienceId).toBeNull();
  });

  it('keeps the card when the list fails, rather than spending the link on a hiccup', async () => {
    // A failed read is not an answer about what the region holds. Dropping the
    // card on it would let one 500 rewrite a shared address, and the card would
    // not come back when the API did.
    mockFetchByRegion.mockRejectedValue(new Error('HTTP 500'));
    const { result } = renderHook(useUnderTest, { wrapper: wrapperAt('/wv/5/r/6737-europe/e/1234-stonehenge') });

    await new Promise(resolve => setTimeout(resolve, 60));
    expect(result.current.at).toBe('/wv/5/r/6737-europe/e/1234-stonehenge');
    expect(result.current.ctx.selectedExperienceId).toBe(1234);
  });

  it('keeps the card while the list is still on its way', async () => {
    mockFetchByRegion.mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(useUnderTest, { wrapper: wrapperAt('/wv/5/r/6737/e/1234') });

    await new Promise(resolve => setTimeout(resolve, 30));
    expect(result.current.ctx.selectedExperienceId).toBe(1234);
    expect(result.current.at).toBe('/wv/5/r/6737/e/1234');
  });

  it('reads no card while the provider shows another region than the address names', () => {
    // During a restore the region arrives after the address, and the provider
    // is still on the previous one (or none): its list must not be asked about
    // a card of the region that is on its way.
    const { result } = renderHook(useUnderTest, { wrapper: wrapperAt('/wv/5/r/6737/e/1234', null) });
    expect(result.current.ctx.selectedExperienceId).toBeNull();
  });

  it('remembers the card the page arrived with, until it is settled', () => {
    const { result } = renderHook(useUnderTest, { wrapper: wrapperAt('/wv/5/r/6737/e/1234', null) });
    expect(result.current.ctx.arrivedAtExperienceId).toBe(1234);

    act(() => { result.current.ctx.settleArrival(); });
    expect(result.current.ctx.arrivedAtExperienceId).toBeNull();
  });

  it('forgets the arrival once the reader has moved to another card', async () => {
    const { result } = renderHook(useUnderTest, { wrapper: wrapperAt('/wv/5/r/6737/e/1234') });
    await waitFor(() => expect(result.current.ctx.experiences).toHaveLength(1));

    act(() => { result.current.ctx.setSelectedExperienceId(null); });

    await waitFor(() => expect(result.current.ctx.arrivedAtExperienceId).toBeNull());
  });

  it('arrives at no card from a region address', () => {
    const { result } = renderHook(useUnderTest, { wrapper: wrapperAt('/wv/5/r/6737') });
    expect(result.current.ctx.arrivedAtExperienceId).toBeNull();
  });
});
