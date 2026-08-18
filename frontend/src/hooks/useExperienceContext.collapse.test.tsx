/**
 * The collapse a reader asks for is about one object in one region, and both
 * halves of that sentence are load-bearing.
 *
 * Per object, because a reader looking at the Rock Art of the Mediterranean
 * Basin — 734 rock shelters drawn across Aragón, Valencia and Murcia — may want
 * that site as one pin while the other 660 rows in Europe keep their places.
 *
 * Per region, because the ask answers "this object, here". It is derived from
 * the region it was made in rather than cleared by an effect: an effect runs
 * after render, which leaves a commit where the new region's rows are drawn
 * against the old region's collapses.
 */

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React, { useMemo } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ExperienceProvider, useExperienceContext } from './useExperienceContext';

/**
 * One provider whose `regionId` prop changes, which is what the app does:
 * `MainDisplay` mounts a single `ExperienceProvider` with no `key`, so navigating
 * regions re-renders this instance rather than replacing it. A test that mounted
 * a second provider would find it empty for free and prove nothing about the
 * derivation these tests exist for.
 */
function wrapperFor(regionId: number | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <ExperienceProvider regionId={regionId} isExploring>
          {children}
        </ExperienceProvider>
      </QueryClientProvider>
    );
  };
}

/**
 * A wrapper that reads the region from a variable the test moves, because
 * `renderHook`'s `initialProps` reach the *callback* rather than the wrapper —
 * and it is the provider's prop that has to change for this to be the app's path.
 */
let regionUnderTest: number | null = 1;
function MovingRegionWrapper({ children }: { children: React.ReactNode }) {
  const client = useMemo(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }), []);
  return (
    <QueryClientProvider client={client}>
      <ExperienceProvider regionId={regionUnderTest} isExploring>
        {children}
      </ExperienceProvider>
    </QueryClientProvider>
  );
}

describe('the per-object collapse', () => {
  it('starts with nothing collapsed', () => {
    const { result } = renderHook(() => useExperienceContext(), { wrapper: wrapperFor(1) });

    expect(result.current.collapsedExperienceIds.size).toBe(0);
  });

  it('collapses one object and leaves the rest alone', () => {
    const { result } = renderHook(() => useExperienceContext(), { wrapper: wrapperFor(1) });

    act(() => result.current.toggleCollapsedExperience(1184));

    expect([...result.current.collapsedExperienceIds]).toEqual([1184]);
  });

  it('takes the ask back on a second click', () => {
    const { result } = renderHook(() => useExperienceContext(), { wrapper: wrapperFor(1) });

    act(() => result.current.toggleCollapsedExperience(1184));
    act(() => result.current.toggleCollapsedExperience(1184));

    expect(result.current.collapsedExperienceIds.size).toBe(0);
  });

  it('holds several at once', () => {
    const { result } = renderHook(() => useExperienceContext(), { wrapper: wrapperFor(1) });

    act(() => result.current.toggleCollapsedExperience(1184));
    act(() => result.current.toggleCollapsedExperience(600));

    expect([...result.current.collapsedExperienceIds].sort((a, b) => a - b)).toEqual([600, 1184]);
  });

  it('does not carry a fold into another region, and still has it on return if nothing was folded in between', () => {
    // The real path: one provider, a changed `regionId`. The fold is derived from
    // the region it was made in rather than cleared by an effect — an effect runs
    // after render, which leaves a commit where the new region's rows are drawn
    // against the old region's folds.
    regionUnderTest = 1;
    const { result, rerender } = renderHook(() => useExperienceContext(), {
      wrapper: MovingRegionWrapper,
    });
    act(() => result.current.toggleCollapsedExperience(1184));
    expect([...result.current.collapsedExperienceIds]).toEqual([1184]);

    regionUnderTest = 2;
    rerender();
    expect(result.current.collapsedExperienceIds.size).toBe(0);

    // Back where it was asked for: the ask is about this object *here*, and the
    // reader has not taken it back. This holds only because nothing was folded in
    // region 2 — the hook keeps one region's set, and the next test pins what
    // happens when the reader folds something there.
    regionUnderTest = 1;
    rerender();
    expect([...result.current.collapsedExperienceIds]).toEqual([1184]);
  });

  it('starts a new region with nothing folded even after folding in the old one', () => {
    regionUnderTest = 1;
    const { result, rerender } = renderHook(() => useExperienceContext(), {
      wrapper: MovingRegionWrapper,
    });
    act(() => result.current.toggleCollapsedExperience(1184));
    regionUnderTest = 2;
    rerender();

    act(() => result.current.toggleCollapsedExperience(600));

    expect([...result.current.collapsedExperienceIds]).toEqual([600]);

    // And folding there is what the first region's set costs: one set is kept,
    // for the region it was made in. Coming back finds nothing folded — which is
    // what "lasts as long as you are looking at that region" means, and less than
    // a reader might read into the round trip above.
    regionUnderTest = 1;
    rerender();
    expect(result.current.collapsedExperienceIds.size).toBe(0);
  });

  it('hands out the same empty set every render, so a memo on it holds', () => {
    // The marker builder is memoised on this value. A fresh `new Set()` per
    // render would rebuild 3463 markers on every unrelated state change.
    const { result, rerender } = renderHook(() => useExperienceContext(), {
      wrapper: wrapperFor(1),
    });
    const first = result.current.collapsedExperienceIds;
    rerender();

    expect(result.current.collapsedExperienceIds).toBe(first);
  });
});
