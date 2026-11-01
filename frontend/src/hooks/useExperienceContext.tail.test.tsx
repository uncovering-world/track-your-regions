/**
 * A card the region's list lacks because a crowded city leaves it out
 * (ADR-0172, #2201). Search finds Santa Sabina and lands in Lazio with its card
 * in the address; the list does not hold it, so the provider asks the region's
 * tail before calling the card missing, keeps the card, and opens its kind's
 * tail for it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router';
import type { Experience } from '../api/experiences';
import { ApiError } from '../api/fetchUtils';

const { mockFetchByRegion, mockFetchOne, mockFetchTail } = vi.hoisted(() => ({
  mockFetchByRegion: vi.fn(), mockFetchOne: vi.fn(), mockFetchTail: vi.fn(),
}));
vi.mock('../api/experiences', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/experiences')>();
  return {
    ...actual, fetchExperiencesByRegion: mockFetchByRegion, fetchExperience: mockFetchOne, fetchRegionTail: mockFetchTail,
  };
});

import { ExperienceProvider, useExperienceContext } from './useExperienceContext';

const WORSHIP = 4;
const LAZIO = 7210;
const ST_PETER = { id: 101, name: "St. Peter's Basilica", type: 'cathedral', kind_id: WORSHIP, kind_name: 'Places of worship' } as Experience;
const SANTA_SABINA = { id: 202, name: 'Santa Sabina', type: 'church', kind_id: WORSHIP, kind_name: 'Places of worship' } as Experience;

function wrapperAt(entry: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <MemoryRouter initialEntries={[entry]}>
        <QueryClientProvider client={client}>
          <ExperienceProvider regionId={LAZIO} isExploring>{children}</ExperienceProvider>
        </QueryClientProvider>
      </MemoryRouter>
    );
  };
}

function useUnderTest() {
  const ctx = useExperienceContext();
  const location = useLocation();
  return { ctx, at: `${location.pathname}${location.search}` };
}

const tailOf = (rows: Experience[]) => ({ experiences: rows, total: rows.length, limit: 5000, offset: 0 });

describe('a card only the region\'s tail holds', () => {
  beforeEach(() => {
    mockFetchByRegion.mockReset();
    mockFetchByRegion.mockResolvedValue({
      experiences: [ST_PETER], total: 1, lostHidden: 0, crowdedOut: [{ kindId: WORSHIP, type: 'church', count: 51 }],
    });
    mockFetchOne.mockReset();
    mockFetchOne.mockRejectedValue(new ApiError('Experience not found', 404, 'Experience not found', undefined));
    mockFetchTail.mockReset();
    mockFetchTail.mockResolvedValue(tailOf([SANTA_SABINA]));
  });

  it('keeps the card, resolves its place and opens its kind\'s tail', async () => {
    const { result } = renderHook(useUnderTest, { wrapper: wrapperAt(`/wv/5/r/${LAZIO}/e/${SANTA_SABINA.id}`) });

    await waitFor(() => expect(result.current.ctx.tail.card?.id).toBe(SANTA_SABINA.id));
    expect(mockFetchTail).toHaveBeenCalledWith(LAZIO, null);
    await waitFor(() => expect(result.current.ctx.tail.open.has(WORSHIP)).toBe(true));
    expect(mockFetchTail).toHaveBeenCalledWith(LAZIO, WORSHIP);
    await waitFor(() => expect(result.current.ctx.tail.places.get(WORSHIP)).toEqual([SANTA_SABINA]));

    expect(result.current.ctx.selectedExperienceId).toBe(SANTA_SABINA.id);
    expect(result.current.ctx.getExperienceById(SANTA_SABINA.id)).toBe(SANTA_SABINA);
    // Never added to the list, so it counts toward nothing the list counts.
    expect(result.current.ctx.experiences).toEqual([ST_PETER]);
    await waitFor(() => expect(result.current.at).toBe(`/wv/5/r/${LAZIO}/e/${SANTA_SABINA.id}-santa-sabina`));
  });

  it('lets a reader fold the tail the card opened, without reopening it', async () => {
    const { result } = renderHook(useUnderTest, { wrapper: wrapperAt(`/wv/5/r/${LAZIO}/e/${SANTA_SABINA.id}`) });
    await waitFor(() => expect(result.current.ctx.tail.open.has(WORSHIP)).toBe(true));

    act(() => { result.current.ctx.tail.toggle(WORSHIP); });

    await waitFor(() => expect(result.current.ctx.tail.open.has(WORSHIP)).toBe(false));
    expect(result.current.ctx.tail.card?.id).toBe(SANTA_SABINA.id);
  });

  it('opens the tail again for a card the reader comes back to from another one', async () => {
    const { result } = renderHook(useUnderTest, { wrapper: wrapperAt(`/wv/5/r/${LAZIO}/e/${SANTA_SABINA.id}`) });
    await waitFor(() => expect(result.current.ctx.tail.open.has(WORSHIP)).toBe(true));
    act(() => { result.current.ctx.tail.toggle(WORSHIP); });
    await waitFor(() => expect(result.current.ctx.tail.open.has(WORSHIP)).toBe(false));

    // Another card, then back: the fold was for the first visit, not for ever.
    act(() => { result.current.ctx.setSelectedExperienceId(ST_PETER.id); });
    await waitFor(() => expect(result.current.ctx.selectedExperienceId).toBe(ST_PETER.id));
    act(() => { result.current.ctx.setSelectedExperienceId(SANTA_SABINA.id); });

    await waitFor(() => expect(result.current.ctx.tail.open.has(WORSHIP)).toBe(true));
  });

  it('drops a card neither the list nor the tail holds', async () => {
    mockFetchTail.mockResolvedValue(tailOf([]));
    const { result } = renderHook(useUnderTest, { wrapper: wrapperAt(`/wv/5/r/${LAZIO}/e/999`) });

    await waitFor(() => expect(result.current.at).toBe(`/wv/5/r/${LAZIO}`));
    expect(result.current.ctx.tail.card).toBeNull();
  });

  it('asks no tail where the region leaves nothing out', async () => {
    mockFetchByRegion.mockResolvedValue({ experiences: [ST_PETER], total: 1, lostHidden: 0, crowdedOut: [] });
    const { result } = renderHook(useUnderTest, { wrapper: wrapperAt(`/wv/5/r/${LAZIO}/e/999`) });

    await waitFor(() => expect(result.current.at).toBe(`/wv/5/r/${LAZIO}`));
    expect(mockFetchTail).not.toHaveBeenCalled();
  });

  it('reads a kind\'s tail only when it is opened', async () => {
    const { result } = renderHook(useUnderTest, { wrapper: wrapperAt(`/wv/5/r/${LAZIO}`) });
    await waitFor(() => expect(result.current.ctx.experiences).toHaveLength(1));
    expect(mockFetchTail).not.toHaveBeenCalled();

    act(() => { result.current.ctx.tail.toggle(WORSHIP); });

    await waitFor(() => expect(result.current.ctx.tail.places.get(WORSHIP)).toEqual([SANTA_SABINA]));
    expect(mockFetchTail).toHaveBeenCalledWith(LAZIO, WORSHIP);
  });
});
