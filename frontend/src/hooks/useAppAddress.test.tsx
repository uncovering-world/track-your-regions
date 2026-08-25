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
