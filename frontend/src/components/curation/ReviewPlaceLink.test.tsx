/**
 * The review page's own link to a place (#2207): an address written whole
 * from the regions the read sends, on the map, pushed. Read back off the
 * router, so what is asserted is the URL a curator lands on.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
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

describe('ReviewPlaceLink', () => {
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
