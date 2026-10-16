import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useDocumentTitle } from './useDocumentTitle';

describe('useDocumentTitle', () => {
  afterEach(() => { document.title = 'Track Your Regions'; });

  it('names the page after the place, and restores the bare title on unmount', () => {
    const { rerender, unmount } = renderHook(({ title }) => useDocumentTitle(title), {
      initialProps: { title: 'Europe' as string | null },
    });
    expect(document.title).toBe('Europe · Track Your Regions');

    rerender({ title: 'Stonehenge · Europe' });
    expect(document.title).toBe('Stonehenge · Europe · Track Your Regions');

    rerender({ title: null });
    expect(document.title).toBe('Track Your Regions');

    rerender({ title: 'Europe' });
    unmount();
    expect(document.title).toBe('Track Your Regions');
  });
});

describe("useDocumentTitle on the dev server's document (#1549)", () => {
  afterEach(() => { document.title = 'Track Your Regions'; vi.resetModules(); });

  it("keeps the served document's mark when it names a place", async () => {
    document.title = 'Track Your Regions (dev server)';
    vi.resetModules();
    const { useDocumentTitle: fresh } = await import('./useDocumentTitle');

    const { rerender, unmount } = renderHook(({ title }) => fresh(title), {
      initialProps: { title: 'Europe' as string | null },
    });
    expect(document.title).toBe('Europe · Track Your Regions (dev server)');

    rerender({ title: null });
    expect(document.title).toBe('Track Your Regions (dev server)');
    unmount();
    expect(document.title).toBe('Track Your Regions (dev server)');
  });
});
