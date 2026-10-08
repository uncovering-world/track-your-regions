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
