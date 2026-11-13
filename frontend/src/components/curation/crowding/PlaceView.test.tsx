/**
 * A place's circle as one table (#2486): the open place marked at its own
 * rank, and opening a neighbour that keeps the table where it is, scrolling to
 * the newly marked row only where it is out of view.
 */

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CrowdingPlaceView } from '../../../api/crowding';
import { figureColumns } from './FigureTable';
import { PlaceView } from './PlaceView';
import { ALEXANDERPLATZ, berlinCircle, berlinGroup, GENDARMENMARKT, POTSDAMER_PLATZ } from './crowdingFixtures';

const rule = {
  kindId: berlinGroup.kind.id, kindName: berlinGroup.kind.name, type: berlinGroup.group.type,
  limit: berlinGroup.kind.limit, radiusKm: berlinGroup.kind.radiusKm,
};
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function placeView(view: CrowdingPlaceView) {
  return (
    <QueryClientProvider client={client}>
      <PlaceView view={view} rule={rule} staging={new Map()} columns={figureColumns(berlinGroup.kind)}
        hovered={null} onHover={vi.fn()} onOpen={vi.fn()} onAnswer={vi.fn()} />
    </QueryClientProvider>
  );
}

/** The table's rows below its headings, by the name that heads each. */
function rowNames() {
  const table = within(screen.getByRole('table', { name: 'Its figures and the places around it' }));
  return table.getAllByRole('rowheader').map(header => header.firstChild?.textContent);
}

const scrollIntoView = vi.fn();

beforeEach(() => {
  // jsdom lays nothing out and has no scrollIntoView.
  scrollIntoView.mockReset();
  Element.prototype.scrollIntoView = scrollIntoView;
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (Element.prototype as Partial<Element>).scrollIntoView;
});

describe("a place's circle as one table (#2486)", () => {
  it('marks Gendarmenmarkt at its own rank, third, and opens no circle from its own name', () => {
    render(placeView(berlinCircle(GENDARMENMARKT)));

    expect(rowNames().slice(0, 4)).toEqual(['Alexanderplatz', 'Potsdamer Platz', 'Gendarmenmarkt', 'Pariser Platz']);
    const own = screen.getByRole('row', { name: 'Gendarmenmarkt, this place' });
    expect(own.firstChild).toHaveTextContent('3');
    expect(within(own).getByText('this place')).toBeInTheDocument();
    expect(within(own).queryByRole('button')).toBeNull();
    expect(screen.getByRole('button', { name: 'Alexanderplatz' })).toBeInTheDocument();
  });

  it('moves only the mark when Alexanderplatz opens after Gendarmenmarkt, and scrolls to nothing in view', () => {
    const { rerender } = render(placeView(berlinCircle(GENDARMENMARKT)));
    const before = rowNames();

    rerender(placeView(berlinCircle(ALEXANDERPLATZ)));
    expect(rowNames()).toEqual(before);
    expect(screen.getByRole('row', { name: 'Alexanderplatz, this place' })).toBeInTheDocument();
    expect(screen.queryByRole('row', { name: 'Gendarmenmarkt, this place' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Gendarmenmarkt' })).toBeInTheDocument();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('scrolls the newly marked row into view, to its nearest edge, only where it is out of view', () => {
    const { rerender } = render(placeView(berlinCircle(GENDARMENMARKT)));
    // Every row below the screen's bottom: the card above it grew when the next place opened.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const below = this.getAttribute('role') === 'row';
      return { top: below ? 2000 : 0, bottom: below ? 2040 : 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) };
    });

    rerender(placeView(berlinCircle(POTSDAMER_PLATZ)));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
    expect(scrollIntoView.mock.contexts[0]).toBe(screen.getByRole('row', { name: 'Potsdamer Platz, this place' }));
  });

  it('scrolls nothing when the circle first opens, or reads its own place again', () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(
      { top: 2000, bottom: 2040, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) },
    );
    const { rerender } = render(placeView(berlinCircle(GENDARMENMARKT)));
    rerender(placeView(berlinCircle(GENDARMENMARKT)));
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
