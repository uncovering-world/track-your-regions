import { describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigationType } from 'react-router';
import type { ReactNode } from 'react';
import { useAppAddress } from './useAppAddress';

function makeWrapper(entry: string) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={[entry]}>{children}</MemoryRouter>;
  };
}

/** The hook beside what the router says, so a write can be checked on both sides. */
function useUnderTest() {
  const { address, go } = useAppAddress();
  const location = useLocation();
  return { address, go, at: `${location.pathname}${location.search}`, key: location.key, type: useNavigationType() };
}

describe('useAppAddress', () => {
  it('reads the address of the page', () => {
    const { result } = renderHook(useUnderTest, { wrapper: makeWrapper('/wv/5/r/6737-europe') });
    expect(result.current.address).toEqual({ mode: 'map', worldViewId: 5, regionId: 6737, experienceId: null, categoryId: null });
  });

  it('answers null on a page that is not a place', () => {
    const { result } = renderHook(useUnderTest, { wrapper: makeWrapper('/account') });
    expect(result.current.address).toBeNull();
  });

  it('rewrites a legacy ?wv= address in place, without a history entry', async () => {
    const { result } = renderHook(useUnderTest, { wrapper: makeWrapper('/discover?wv=5') });
    await waitFor(() => expect(result.current.at).toBe('/discover/wv/5'));
    expect(result.current.type).toBe('REPLACE');
  });

  it('pushes a new address by default', async () => {
    const { result } = renderHook(useUnderTest, { wrapper: makeWrapper('/wv/5') });
    act(() => { result.current.go({ ...result.current.address!, regionId: 9 }); });
    await waitFor(() => expect(result.current.at).toBe('/wv/5/r/9'));
    expect(result.current.type).toBe('PUSH');
  });

  it('replaces when asked', async () => {
    const { result } = renderHook(useUnderTest, { wrapper: makeWrapper('/wv/5/r/424242') });
    act(() => { result.current.go({ ...result.current.address!, regionId: null }, { replace: true }); });
    await waitFor(() => expect(result.current.at).toBe('/wv/5'));
    expect(result.current.type).toBe('REPLACE');
  });

  it('hangs the slugs it is given on the ids', async () => {
    const { result } = renderHook(useUnderTest, { wrapper: makeWrapper('/wv/5') });
    act(() => {
      result.current.go(
        { ...result.current.address!, regionId: 6737, experienceId: 1234 },
        { names: { region: 'Europe', experience: 'Stonehenge' } },
      );
    });
    await waitFor(() => expect(result.current.at).toBe('/wv/5/r/6737-europe/e/1234-stonehenge'));
  });

  it('keeps the slugs already in the address for the ids it does not rename', async () => {
    // Opening a card names the card and not the region; the region's slug must
    // not be lost to a write that had nothing to say about it.
    const { result } = renderHook(useUnderTest, { wrapper: makeWrapper('/wv/5/r/6737-europe') });
    act(() => {
      result.current.go({ ...result.current.address!, experienceId: 1 }, { names: { experience: 'Stonehenge' } });
    });
    await waitFor(() => expect(result.current.at).toBe('/wv/5/r/6737-europe/e/1-stonehenge'));
  });

  it('drops a slug whose id changed', async () => {
    const { result } = renderHook(useUnderTest, { wrapper: makeWrapper('/wv/5/r/6737-europe') });
    act(() => { result.current.go({ ...result.current.address!, regionId: 9 }); });
    await waitFor(() => expect(result.current.at).toBe('/wv/5/r/9'));
  });

  it('builds on what it last wrote, not on a render that has not happened yet', async () => {
    // The window that made this necessary: `navigate` updates the browser's URL
    // through `history.replaceState` at once, while React re-renders through a
    // transition. So the address bar can already read `/wv/5` while every
    // component still holds the address parsed from `/` — and a click landing
    // there would build its next address on the old one and undo the write. The
    // functional form asks for the latest instead.
    const { result } = renderHook(useUnderTest, { wrapper: makeWrapper('/') });

    act(() => {
      result.current.go({ mode: 'map', worldViewId: 5, regionId: null, experienceId: null, categoryId: null }, { replace: true });
      result.current.go(at => ({ ...at, mode: 'discover' }));
    });

    await waitFor(() => expect(result.current.at).toBe('/discover/wv/5'));
  });

  it('follows a navigation made from outside it', async () => {
    // The other half of the write-ahead ref: what `go` wrote is authoritative
    // only until the location moves on its own — Back, a link, the legacy
    // redirect. Then the address is whatever arrived, and a relative write
    // builds on that rather than on the last thing this hook wrote.
    const { result } = renderHook(useUnderTest, { wrapper: makeWrapper('/wv/5') });
    act(() => { result.current.go(at => ({ ...at, regionId: 9 })); });
    await waitFor(() => expect(result.current.at).toBe('/wv/5/r/9'));

    act(() => { result.current.go(at => ({ ...at, regionId: null })); });
    await waitFor(() => expect(result.current.at).toBe('/wv/5'));

    act(() => { result.current.go(at => ({ ...at, mode: 'discover' })); });
    await waitFor(() => expect(result.current.at).toBe('/discover/wv/5'));
  });

  it('does nothing for the address the page is already at', async () => {
    const { result } = renderHook(useUnderTest, { wrapper: makeWrapper('/wv/5/r/6737-europe') });
    const before = result.current.key;
    act(() => { result.current.go(result.current.address!, { names: { region: 'Europe' } }); });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(result.current.key).toBe(before);
  });

  it('keeps one identity for go across navigations, so effects can depend on it', async () => {
    const { result } = renderHook(useUnderTest, { wrapper: makeWrapper('/wv/5') });
    const go = result.current.go;
    act(() => { go({ ...result.current.address!, regionId: 9 }); });
    await waitFor(() => expect(result.current.at).toBe('/wv/5/r/9'));
    expect(result.current.go).toBe(go);
  });
});
