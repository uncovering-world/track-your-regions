/**
 * A long serial site's places on an open card (#1271): Prehistoric Pile
 * Dwellings around the Alps in Aargau — two parts in the region, the rest
 * folded by country with counts, a search and a "with a photo" filter.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HoverProvider } from '../../hooks/useHoverContext';
import { CardLocationList } from './CardLocationList';

const place = (id: number, name: string, regionPath: string | null, hasPicture = false) => ({
  id, name, externalRef: null, ordinal: id, isVisited: false, latitude: 47, longitude: 8, hasPicture, regionPath,
});

function renderList() {
  render(
    <HoverProvider>
      <CardLocationList
        objectName="Prehistoric Pile Dwellings around the Alps"
        inRegionLocs={[place(1, 'Riesi', null, true), place(2, 'Ägelmoos', null, true)]}
        outOfRegionLocs={[
          ...Array.from({ length: 6 }, (_, i) => place(10 + i, `Lake Zurich ${i + 1}`, 'Europe > Switzerland > Zürich', i === 0)),
          ...Array.from({ length: 4 }, (_, i) => place(20 + i, `Lake Garda ${i + 1}`, 'Europe > Italy > Lombardia')),
          place(30, 'Bled', 'Europe > Slovenia > Gorenjska'),
        ]}
        showCheckbox={false}
        isAuthenticated={false}
        inRegionVisitedCount={0}
        onLocationHover={vi.fn()}
        onLocationVisitedToggle={vi.fn()}
        registerRef={vi.fn()}
      />
    </HoverProvider>,
  );
}

const shown = (name: string) => screen.queryAllByText(name).length > 0;

describe('CardLocationList for a long serial site', () => {
  it('shows the parts in the region and folds the rest by country, with counts', () => {
    renderList();
    expect(shown('Riesi')).toBe(true);
    expect(screen.getByRole('button', { name: /Switzerland\s*6 · 1 with a photo/ })).toHaveAttribute('aria-expanded', 'false');
    expect(shown('Lake Zurich 1')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /Italy/ }));
    expect(shown('Lake Garda 1')).toBe(true);
  });

  it('finds a part by name in every group', () => {
    renderList();
    fireEvent.change(screen.getByRole('textbox', { name: 'Find a place' }), { target: { value: 'bled' } });
    expect(shown('Bled')).toBe(true);
    expect(shown('Riesi')).toBe(false);
  });

  it('keeps only the parts with a photo of their own when asked', () => {
    renderList();
    fireEvent.click(screen.getByRole('button', { name: 'With a photo · 3' }));
    expect(shown('Riesi')).toBe(true);
    expect(shown('Lake Zurich 1')).toBe(true);
    expect(shown('Lake Zurich 2')).toBe(false);
  });
});

/**
 * A whole's places in the region, marked or unmarked together from its card
 * (#2120), in words: the Struve Arc in Moldova's list reaches Rudi and none
 * of its points in other countries.
 */
describe("a whole's places in the region", () => {
  function renderArc(
    visited: number,
    actions: { mark?: () => void; unmark?: () => void },
    extra: { pending?: boolean; onHeightChange?: () => void } = {},
  ) {
    return render(
      <HoverProvider>
        <CardLocationList
          objectName="Struve Geodetic Arc"
          inRegionLocs={[{ ...place(1, 'Rudi', null), isVisited: visited > 0 }]}
          outOfRegionLocs={[place(10, 'Fuglenes', 'Europe > Norway > Finnmark')]}
          showCheckbox
          isAuthenticated
          inRegionVisitedCount={visited}
          onMarkAllInRegion={actions.mark}
          onUnmarkAllInRegion={actions.unmark}
          visitWritePending={extra.pending}
          onHeightChange={extra.onHeightChange}
          onLocationHover={vi.fn()}
          onLocationVisitedToggle={vi.fn()}
          registerRef={vi.fn()}
        />
      </HoverProvider>,
    );
  }

  it('offers to mark them in words while one is unticked, and nothing to unmark', () => {
    const mark = vi.fn();
    renderArc(0, { mark, unmark: vi.fn() });

    expect(screen.getByText('In this region: 0/1 visited')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Unmark all in region/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Mark all in region: Struve Geodetic Arc' }));
    expect(mark).toHaveBeenCalledTimes(1);
  });

  it('offers to unmark them once they are all ticked, and nothing to mark', () => {
    const unmark = vi.fn();
    renderArc(1, { mark: vi.fn(), unmark });

    expect(screen.queryByRole('button', { name: /^Mark all in region/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Unmark all in region: Struve Geodetic Arc' }));
    expect(unmark).toHaveBeenCalledTimes(1);
  });

  it('holds both, and the places, while a visit write is on its way, so a second click never races the first', () => {
    renderArc(0, { mark: vi.fn(), unmark: vi.fn() }, { pending: true });
    expect(screen.getByRole('button', { name: 'Mark all in region: Struve Geodetic Arc' })).toBeDisabled();
    // And the places' own checkboxes, so a tick never races a bulk write.
    expect(screen.getByRole('checkbox')).toBeDisabled();
  });

  it('reports its height when the visited count changes, since a button may come or go', () => {
    const onHeightChange = vi.fn();
    const view = renderArc(0, { mark: vi.fn(), unmark: vi.fn() }, { onHeightChange });
    onHeightChange.mockClear();
    view.rerender(
      <HoverProvider>
        <CardLocationList
          objectName="Struve Geodetic Arc"
          inRegionLocs={[{ ...place(1, 'Rudi', null), isVisited: true }]}
          outOfRegionLocs={[place(10, 'Fuglenes', 'Europe > Norway > Finnmark')]}
          showCheckbox
          isAuthenticated
          inRegionVisitedCount={1}
          onMarkAllInRegion={vi.fn()}
          onUnmarkAllInRegion={vi.fn()}
          onHeightChange={onHeightChange}
          onLocationHover={vi.fn()}
          onLocationVisitedToggle={vi.fn()}
          registerRef={vi.fn()}
        />
      </HoverProvider>,
    );
    expect(onHeightChange).toHaveBeenCalled();
  });

  it('offers neither for a place of no parts, which is ticked from its row', () => {
    renderArc(0, {});
    expect(screen.queryByRole('button', { name: /all in region/ })).toBeNull();
  });
});
