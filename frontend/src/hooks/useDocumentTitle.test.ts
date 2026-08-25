import { afterEach, describe, expect, it } from 'vitest';
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
