/**
 * A card's title can be selected without the card closing (#1190).
 *
 * Dragging across "Groeningemuseum" on its row selected the name and toggled
 * the card in the same gesture, since a click that ends a selection is still a
 * click on the row. The row now leaves the card as it is when the click ends a
 * selection inside it, and the chevron is the row's named toggle.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HoverProvider } from '../../hooks/useHoverContext';
import type { Experience } from '../../api/experiences';
import { ExperienceListItem } from './ExperienceListItem';

/** Groeningemuseum in Bruges, as the region list carries it. */
const groeningemuseum = {
  id: 6237, name: 'Groeningemuseum', kind_id: 2, type: 'museum', location_count: 1, kinds: [],
} as unknown as Experience;

function renderRow(isSelected = false) {
  const onClick = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <HoverProvider>
        <ExperienceListItem
          experience={groeningemuseum}
          locations={[]}
          locationsResolved
          isLocationVisited={() => false}
          isSelected={isSelected}
          locationRefs={{ current: new Map() }}
          itemRefs={{ current: new Map() }}
          showCheckbox={false}
          isLoading={false}
          onHover={() => {}}
          onLeave={() => {}}
          onClick={onClick}
          onLocationVisitedToggle={() => {}}
          onToggleAllLocations={() => {}}
          onLocationHover={() => {}}
          isCollapsed={false}
          onToggleCollapse={() => {}}
        />
      </HoverProvider>
    </QueryClientProvider>,
  );
  return { onClick };
}

afterEach(() => window.getSelection()?.removeAllRanges());

describe('the title row of a card', () => {
  it('leaves the card as it is when a drag selected the name', () => {
    const { onClick } = renderRow();
    const title = screen.getByText('Groeningemuseum');
    const range = document.createRange();
    range.selectNodeContents(title);
    window.getSelection()!.addRange(range);

    fireEvent.click(title);

    expect(window.getSelection()!.toString()).toBe('Groeningemuseum');
    expect(onClick).not.toHaveBeenCalled();
  });

  it('still toggles on a plain click', () => {
    const { onClick } = renderRow();

    fireEvent.click(screen.getByText('Groeningemuseum'));

    expect(onClick).toHaveBeenCalledWith(groeningemuseum);
  });

  it('toggles on a selection elsewhere on the page', () => {
    const { onClick } = renderRow();
    const elsewhere = document.body.appendChild(document.createElement('p'));
    elsewhere.textContent = 'Dijver 12';
    const range = document.createRange();
    range.selectNodeContents(elsewhere);
    window.getSelection()!.addRange(range);

    fireEvent.click(screen.getByText('Groeningemuseum'));

    expect(onClick).toHaveBeenCalledTimes(1);
    elsewhere.remove();
  });

  it('names its chevron as the toggle, and says whether the card is open', () => {
    const { onClick } = renderRow();
    const toggle = screen.getByRole('button', { name: 'Open Groeningemuseum' });

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
