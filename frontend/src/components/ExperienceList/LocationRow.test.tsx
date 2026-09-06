/**
 * One place's row on an open card, and the way a curator gets from it to the
 * correction.
 *
 * The memo that keeps a hover from re-rendering the region is pinned in
 * `hoverIsolation.test.tsx`; what this pins is the affordance: offered only where
 * the card hands in `onCorrect`, named for the place so a list of thirty is usable
 * by ear, and present on a place outside the region too — it is still a place a
 * curator is looking at.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HoverProvider } from '../../hooks/useHoverContext';
import { LocationRow, type LocationRowData } from './LocationRow';

/** One of the pile dwellings around the Alps, as the card lists it. */
const see: LocationRowData = {
  id: 4418, name: 'See', ordinal: 0, isVisited: false, latitude: 47.5, longitude: 9.4,
};

function renderRow(over: Partial<Parameters<typeof LocationRow>[0]> = {}) {
  const onCorrect = vi.fn();
  render(
    <HoverProvider>
      <ul>
        <LocationRow
          location={see}
          showCheckbox={false}
          onHover={() => {}}
          onVisitedToggle={() => {}}
          registerRef={() => {}}
          onCorrect={onCorrect}
          {...over}
        />
      </ul>
    </HoverProvider>,
  );
  return { onCorrect };
}

describe('LocationRow', () => {
  it('offers the correction, named for the place, and hands the row back', () => {
    const { onCorrect } = renderRow();

    fireEvent.click(screen.getByRole('button', { name: 'Fix See' }));

    expect(onCorrect).toHaveBeenCalledWith(see);
  });

  it('offers nothing where the card hands in no way to correct', () => {
    renderRow({ onCorrect: undefined });

    expect(screen.queryByRole('button', { name: /^Fix/ })).toBeNull();
  });

  it('offers it on a place outside the region as well', () => {
    const { onCorrect } = renderRow({ outOfRegion: true, regionPath: 'Switzerland › Thurgau' });

    fireEvent.click(screen.getByRole('button', { name: 'Fix See' }));

    expect(onCorrect).toHaveBeenCalledWith(see);
  });

  it('says under the name when a curator has moved the pin', () => {
    // The batch now carries the place's claims; without the word, a pin somebody
    // put there reads as the source's on the map's own list.
    renderRow({ location: { ...see, curatedFields: ['location'] } });

    expect(screen.getByText('pin corrected')).toBeInTheDocument();
  });

  it('keeps the visited checkbox beside it', () => {
    renderRow({ showCheckbox: true });

    expect(screen.getByRole('button', { name: 'Fix See' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
  });
});
