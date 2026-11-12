/**
 * The review page's own link to a place (#2207): an address written whole
 * from the regions the read sends, on the map, pushed. Read back off the
 * router, so what is asserted is the URL a curator lands on.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { rememberWorldView } from '../../utils/lastWorldView';
import { ReviewPlaceLink } from './ReviewPlaceLink';

/** The Pergamon Museum, as the arrived row's shownAt names it on dev (2026-11-01). */
const PERGAMON = {
  id: 14539, name: 'Pergamon Museum', kind_id: 5,
  regions: [
    { id: 6901, name: 'Berlin', world_view_id: 5, world_view_name: 'Administrative' },
    { id: 6898, name: 'Germany', world_view_id: 5, world_view_name: 'Administrative' },
    { id: 6737, name: 'Europe', world_view_id: 5, world_view_name: 'Administrative' },
  ],
};

function Location() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}{location.search}</div>;
}

function renderAt(path: string, place = PERGAMON, onRowClick = vi.fn()) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <div onClick={onRowClick}>
        <ReviewPlaceLink place={place} />
      </div>
      <Location />
    </MemoryRouter>,
  );
  return onRowClick;
}

/** The same museum placed by a second world view too, a curator's own (ids made up for the test). */
const PLACED_TWICE = {
  ...PERGAMON,
  regions: [
    ...PERGAMON.regions,
    { id: 9101, name: 'Berlin-Mitte', world_view_id: 9, world_view_name: 'Neighbourhoods' },
  ],
};

afterEach(() => rememberWorldView(null));

describe('ReviewPlaceLink', () => {
  it('opens the card in the world view the curator last had open, where that one places it (#2474)', () => {
    rememberWorldView(9);
    renderAt('/review', PLACED_TWICE);

    expect(screen.getByRole('link', { name: 'Pergamon Museum' }))
      .toHaveAttribute('href', '/wv/9/r/9101-berlin-mitte/e/14539-pergamon-museum');
  });

  it('falls back to the first world view that places it, where the one last open does not', () => {
    rememberWorldView(77);
    renderAt('/review', PLACED_TWICE);

    expect(screen.getByRole('link', { name: 'Pergamon Museum' }))
      .toHaveAttribute('href', '/wv/5/r/6901-berlin/e/14539-pergamon-museum');
  });

  it('opens the card on the map at the smallest region of the first world view that places it, from /review', () => {
    const onRowClick = renderAt('/review?q=altes');

    // A real link, so the address is there to copy or open in another tab.
    const link = screen.getByRole('link', { name: 'Pergamon Museum' });
    expect(link).toHaveAttribute('href', '/wv/5/r/6901-berlin/e/14539-pergamon-museum');
    fireEvent.click(link);

    expect(screen.getByTestId('location')).toHaveTextContent('/wv/5/r/6901-berlin/e/14539-pergamon-museum');
    // The link answers for its own press and not the row it sits on.
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('is the name alone where no world view places the place', () => {
    renderAt('/review', { ...PERGAMON, regions: [] });

    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Pergamon Museum')).toBeInTheDocument();
  });
});
