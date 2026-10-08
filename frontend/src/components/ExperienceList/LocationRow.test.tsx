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
  id: 4418, name: 'See', externalRef: '1363-061', ordinal: 0, isVisited: false, latitude: 47.5, longitude: 9.4,
};

function renderRow(over: Partial<Parameters<typeof LocationRow>[0]> = {}) {
  const onCorrect = vi.fn();
  render(
    <HoverProvider>
      <ul>
        <LocationRow
          location={see}
          objectName="Prehistoric Pile Dwellings around the Alps"
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

  it('copies the full name, object and reference included, in one action (#1268)', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderRow();

    fireEvent.click(screen.getByRole('button', { name: 'Copy the name Prehistoric Pile Dwellings around the Alps — See (1363-061)' }));

    expect(writeText).toHaveBeenCalledWith('Prehistoric Pile Dwellings around the Alps — See (1363-061)');
  });

  it('says so when the browser refuses the clipboard', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    renderRow();

    fireEvent.click(screen.getByRole('button', { name: /^Copy the name/ }));

    expect(await screen.findByTestId('ErrorOutlineIcon')).toBeInTheDocument();
  });

  it('names a part its source left unnamed by its reference', () => {
    // The Via Appia's parts, which UNESCO leaves unnamed.
    renderRow({ location: { ...see, name: null, externalRef: '1708-003' }, objectName: 'Via Appia' });

    expect(screen.getByText('1708-003')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fix 1708-003' })).toBeInTheDocument();
  });

  it('keeps the visited checkbox beside it', () => {
    renderRow({ showCheckbox: true });

    expect(screen.getByRole('button', { name: 'Fix See' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
  });

  it("opens the place's own card from the row or its name, and never from its controls (#1271)", () => {
    const onOpen = vi.fn();
    const { onCorrect } = renderRow({ onOpen });

    // The name is the button a keyboard and a screen reader reach.
    const name = screen.getByRole('button', { name: 'See' });
    fireEvent.keyDown(name, { key: 'Enter' });
    expect(onOpen).toHaveBeenCalledWith(4418, 'See');

    fireEvent.click(screen.getByRole('button', { name: 'Fix See' }));
    expect(onCorrect).toHaveBeenCalled();
    expect(onOpen).toHaveBeenCalledTimes(1);

    fireEvent.click(name);
    expect(onOpen).toHaveBeenCalledTimes(2);
  });
});
