import { describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate, useNavigationType } from 'react-router';
import type { ReactNode } from 'react';
import { useReviewAddress } from './useReviewAddress';
import { EMPTY_REVIEW } from '../utils/appUrl';

function makeWrapper(entry: string) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={[entry]}>{children}</MemoryRouter>;
  };
}

/** The hook beside what the router says, so a write can be checked on both sides. */
function useUnderTest() {
  const { address, go } = useReviewAddress();
  const location = useLocation();
  return { address, go, at: `${location.pathname}${location.search}`, key: location.key, type: useNavigationType() };
}

/** `useUnderTest` plus a raw `navigate`, for a write made from *outside* `go`. */
function useUnderTestWithNavigate() {
  const under = useUnderTest();
  const navigate = useNavigate();
  return { ...under, navigate };
}

describe('useReviewAddress', () => {
  it('reads the address of the page', () => {
    const { result } = renderHook(useUnderTest, { wrapper: makeWrapper('/review?run=98&row=waiting:600') });
    expect(result.current.address).toEqual({ ...EMPTY_REVIEW, runId: 98, row: 'waiting:600' });
  });

  it('pushes a filter the curator set', async () => {
    const { result } = renderHook(useUnderTest, { wrapper: makeWrapper('/review?run=98&row=waiting:600') });
    act(() => { result.current.go({ q: 'memorial' }); });
    await waitFor(() => expect(result.current.at).toBe('/review?q=memorial&run=98&row=waiting:600'));
    expect(result.current.type).toBe('PUSH');
  });

  it('replaces a selection the page moves on its own', async () => {
    const { result } = renderHook(useUnderTest, { wrapper: makeWrapper('/review?run=98&row=waiting:600') });
    act(() => { result.current.go({ row: 'waiting:601' }, { replace: true }); });
    await waitFor(() => expect(result.current.at).toBe('/review?run=98&row=waiting:601'));
    expect(result.current.type).toBe('REPLACE');
  });

  it('does nothing for the address the page is already at', () => {
    // Navigation inside `MemoryRouter` is synchronous, so a no-op needs no
    // wait — an unchanged `key` right after `act()` is the proof.
    const { result } = renderHook(useUnderTest, { wrapper: makeWrapper('/review?run=98&row=waiting:600') });
    const before = result.current.key;
    act(() => { result.current.go({}); });
    expect(result.current.key).toBe(before);
  });

  it('clears a field set to its empty value', async () => {
    const { result } = renderHook(useUnderTest, { wrapper: makeWrapper('/review?run=98&row=waiting:600') });
    act(() => { result.current.go({ runId: null }); });
    await waitFor(() => expect(result.current.at).toBe('/review?row=waiting:600'));
  });

  it('lands both writes when two go calls happen in one gesture', async () => {
    // The bug this guards: without a ref ahead of the render, the second call
    // would merge onto the same stale `location.search` the first one read,
    // and undo it — `/review?sort=question` with `q` dropped.
    const { result } = renderHook(useUnderTest, { wrapper: makeWrapper('/review') });
    act(() => {
      result.current.go({ q: 'first' });
      result.current.go({ sort: 'question' });
    });
    await waitFor(() => expect(result.current.at).toBe('/review?sort=question&q=first'));
  });

  it('builds a relative write on the write before it, not on the render behind both', async () => {
    // A filter chip's own shape: its menu stays open, so the second tick is computed
    // before React has re-rendered at the first one's address — react-router defers the
    // location update in a transition. Reading `address` there gives `[]` both times and
    // `/review?source=2` replaces the source the curator had just picked; resolving the
    // function against the same ref `go` merges onto keeps both.
    const { result } = renderHook(useUnderTest, { wrapper: makeWrapper('/review') });
    act(() => {
      result.current.go(cur => ({ sourceIds: [...cur.sourceIds, 1] }));
      result.current.go(cur => ({ sourceIds: [...cur.sourceIds, 2] }));
    });
    await waitFor(() => expect(result.current.at).toBe('/review?source=1,2'));
  });

  it('mixes a relative write with an absolute one in the same gesture', async () => {
    const { result } = renderHook(useUnderTest, { wrapper: makeWrapper('/review?source=1') });
    act(() => {
      result.current.go(cur => ({ sourceIds: cur.sourceIds.filter(id => id !== 1) }));
      result.current.go({ q: 'memorial' });
    });
    await waitFor(() => expect(result.current.at).toBe('/review?q=memorial'));
  });

  it('follows a navigation made from outside go, not the ref it last wrote', async () => {
    const { result } = renderHook(useUnderTestWithNavigate, { wrapper: makeWrapper('/review?run=98') });
    act(() => { result.current.navigate('/review?run=99'); });
    await waitFor(() => expect(result.current.at).toBe('/review?run=99'));

    act(() => { result.current.go({ row: 'waiting:1' }); });
    await waitFor(() => expect(result.current.at).toBe('/review?run=99&row=waiting:1'));
  });
});
