/**
 * The rule this hook has to keep: it may only say a card can be opened when the
 * card's size is actually decided. Saying yes early is not a small error — the
 * card opens on the stale answer, closes when the hook corrects itself, and opens
 * again when the picture lands, which is three movements of every row below it
 * where the point was to have one.
 *
 * The case worth guarding is the one a warm cache creates: the two queries resolve
 * in the first render — a card being re-opened, or one whose queries were quick —
 * while the picture is still coming. Measured live, the queries answer in about
 * 150 ms and the picture took 1.3 s, so the picture outlasting them is the normal
 * shape rather than the tail. A hover does not produce this state: it warms the
 * picture alone.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

let preloadResolvers: Array<(ok: boolean) => void> = [];
let preloaded = new Set<string>();
let refused = new Set<string>();

vi.mock('../utils/imagePreload', () => ({
  cardImageUrl: (raw: string | null | undefined) => (raw ? `thumb:${raw}` : ''),
  isImagePreloaded: (url: string) => preloaded.has(url),
  isImageSettled: (url: string) => preloaded.has(url) || refused.has(url),
  preloadImage: () => new Promise<boolean>((resolve) => { preloadResolvers.push(resolve); }),
}));

import { useExperienceCardReady } from './useExperienceCardReady';

const EXPERIENCE_ID = 7;

function harness(client: QueryClient) {
  const Harness = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
  Harness.displayName = 'CardReadyHarness';
  return Harness;
}

/**
 * A client whose card queries are already answered — the state a second opening
 * of the same card finds, or a first one whose queries were quick. Not something
 * a hover produces: hovering warms the picture alone.
 */
function clientWithCachedQueries() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['experience', EXPERIENCE_ID], { id: EXPERIENCE_ID, name: 'X' });
  client.setQueryData(['experience-contents', EXPERIENCE_ID], { treasures: [], total: 0 });
  return client;
}

describe('useExperienceCardReady', () => {
  beforeEach(() => {
    preloadResolvers = [];
    preloaded = new Set();
    refused = new Set();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not report ready while the picture is still coming', () => {
    // The regression: readiness must not be inherited from "nobody asked yet".
    const { result } = renderHook(
      () => useExperienceCardReady(EXPERIENCE_ID, 'pic.jpg', true),
      { wrapper: harness(clientWithCachedQueries()) },
    );

    expect(result.current).toBe(false);
  });

  it('reports ready once the picture settles', async () => {
    const { result } = renderHook(
      () => useExperienceCardReady(EXPERIENCE_ID, 'pic.jpg', true),
      { wrapper: harness(clientWithCachedQueries()) },
    );

    await act(async () => { preloadResolvers.forEach(resolve => resolve(true)); });

    expect(result.current).toBe(true);
  });

  it('reports ready when the picture has failed, not only when it has loaded', async () => {
    // A card with nothing to show must not wait forever for nothing: of 1604
    // experiences, 1260 carry a url that answers 404 (#557), and a refusal
    // arrives as fast as an image.
    const { result } = renderHook(
      () => useExperienceCardReady(EXPERIENCE_ID, 'pic.jpg', true),
      { wrapper: harness(clientWithCachedQueries()) },
    );

    await act(async () => { preloadResolvers.forEach(resolve => resolve(false)); });

    expect(result.current).toBe(true);
  });

  it('is ready in the first render when everything is already here', () => {
    // Everything already answered — a re-opened card — opens in one frame, with
    // no spinner at all. A hover alone does not reach here; it warms the picture.
    preloaded.add('thumb:pic.jpg');
    const { result } = renderHook(
      () => useExperienceCardReady(EXPERIENCE_ID, 'pic.jpg', true),
      { wrapper: harness(clientWithCachedQueries()) },
    );

    expect(result.current).toBe(true);
  });

  it('is ready for an experience with no picture at all', () => {
    const { result } = renderHook(
      () => useExperienceCardReady(EXPERIENCE_ID, null, true),
      { wrapper: harness(clientWithCachedQueries()) },
    );

    expect(result.current).toBe(true);
  });

  it('says no while the card is closed, whatever else is true', () => {
    preloaded.add('thumb:pic.jpg');
    const { result } = renderHook(
      () => useExperienceCardReady(EXPERIENCE_ID, 'pic.jpg', false),
      { wrapper: harness(clientWithCachedQueries()) },
    );

    expect(result.current).toBe(false);
  });

  it('is ready at once for a picture already known to have failed', () => {
    // Four of these urls in five never resolve (#557), and windowing mounts a row
    // afresh every time a reader scrolls back to it. Treating a known refusal as
    // pending would close the card for a commit, let its collapsed height be
    // measured, and move every row below it twice on the way back.
    refused.add('thumb:pic.jpg');
    const { result } = renderHook(
      () => useExperienceCardReady(EXPERIENCE_ID, 'pic.jpg', true),
      { wrapper: harness(clientWithCachedQueries()) },
    );

    expect(result.current).toBe(true);
  });

  it('does not hand one card\u2019s expired patience to the next', () => {
    // Not reachable through the app as it stands: rows carry a stable `e:<id>`
    // identity, so one instance never serves two experiences. It was reachable
    // when a second instance was kept for "the selection", and a cap belonging to
    // "a card is open" rather than to *this* card reported the next one ready in
    // its first render. Kept as a guard on the hook's own contract, which is that
    // every answer belongs to the experience it was asked about.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['experience', 1], { id: 1 });
    client.setQueryData(['experience-contents', 1], { treasures: [], total: 0 });
    client.setQueryData(['experience', 2], { id: 2 });
    client.setQueryData(['experience-contents', 2], { treasures: [], total: 0 });

    const { result, rerender } = renderHook(
      ({ id }: { id: number }) => useExperienceCardReady(id, `pic-${id}.jpg`, true),
      { wrapper: harness(client), initialProps: { id: 1 } },
    );
    act(() => { vi.advanceTimersByTime(1500); });
    expect(result.current).toBe(true);

    rerender({ id: 2 });

    expect(result.current).toBe(false);
  });

  it('opens anyway once the cap runs out, so a hung request cannot trap a row', () => {
    const { result } = renderHook(
      () => useExperienceCardReady(EXPERIENCE_ID, 'pic.jpg', true),
      { wrapper: harness(clientWithCachedQueries()) },
    );
    expect(result.current).toBe(false);

    act(() => { vi.advanceTimersByTime(1500); });

    expect(result.current).toBe(true);
  });
});
