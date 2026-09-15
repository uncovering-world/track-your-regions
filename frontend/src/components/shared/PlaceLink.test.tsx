/**
 * A place one card names on another, as a way there or as its name (#894).
 *
 * The rule is the search's (ADR-0042): a link only where the world view already
 * open places the object, at the smallest region that holds it, in the reader's
 * own mode. The address is written through the real `useAppAddress` and read
 * back off the router, so what these assert is the URL a reader lands on.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';

const { navState } = vi.hoisted(() => ({
  navState: {
    selectedWorldView: { id: 5, name: 'Administrative', isDefault: false } as
      { id: number; name: string; isDefault: boolean } | null,
    isCustomWorldView: true,
  },
}));

vi.mock('../../hooks/useNavigation', () => ({ useNavigation: () => navState }));

import { PlaceLink } from './PlaceLink';

/** The museum that shows the Mask of Agamemnon, as the finds read names it. */
const ATHENS_MUSEUM = {
  id: 14551,
  name: 'National Archaeological Museum of Athens',
  kind_id: 5,
  regions: [
    { id: 6918, name: 'Attica', world_view_id: 5, world_view_name: 'Administrative' },
    { id: 6915, name: 'Greece', world_view_id: 5, world_view_name: 'Administrative' },
    { id: 6737, name: 'Europe', world_view_id: 5, world_view_name: 'Administrative' },
  ],
};

function Location() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}{location.search}</div>;
}

function renderAt(path: string, onRowClick = vi.fn()) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <div onClick={onRowClick}>
        <PlaceLink place={ATHENS_MUSEUM} />
      </div>
      <Location />
    </MemoryRouter>,
  );
  return onRowClick;
}

describe('PlaceLink', () => {
  beforeEach(() => {
    navState.selectedWorldView = { id: 5, name: 'Administrative', isDefault: false };
    navState.isCustomWorldView = true;
  });

  it('opens the card at the smallest region holding the place, in the reader\'s world view, on the map', () => {
    // From Mycenae's card in the Peloponnese to the museum in Attica: one
    // address, written whole and named, and pushed so Back returns here.
    renderAt('/wv/5/r/6922-peloponnese/e/14730-mycenae');

    fireEvent.click(screen.getByRole('button', { name: 'National Archaeological Museum of Athens' }));

    expect(screen.getByTestId('location')).toHaveTextContent(
      '/wv/5/r/6918-attica/e/14551-national-archaeological-museum-of-athens',
    );
  });

  it('carries the place\'s kind in Discover, where a card opens inside its kind\'s list', () => {
    renderAt('/discover/wv/5/r/6922-peloponnese/e/14730-mycenae?kind=5');

    fireEvent.click(screen.getByRole('button', { name: 'National Archaeological Museum of Athens' }));

    expect(screen.getByTestId('location')).toHaveTextContent(
      '/discover/wv/5/r/6918-attica/e/14551-national-archaeological-museum-of-athens?kind=5',
    );
  });

  it('answers for its own press and not the row it sits on', () => {
    // A find's row sits inside a card whose own row opens on click; the link
    // must not close the card it was pressed on.
    const onRowClick = renderAt('/wv/5/r/6922-peloponnese/e/14730-mycenae');

    fireEvent.click(screen.getByRole('button', { name: 'National Archaeological Museum of Athens' }));

    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('is the name, and not a link, where the reader\'s world view does not place it', () => {
    // ADR-0042 decision 2: a link never moves the reader to another world view.
    navState.selectedWorldView = { id: 2, name: 'Wikivoyage Regions', isDefault: false };
    renderAt('/wv/2/r/9001-benelux');

    expect(screen.getByText('National Archaeological Museum of Athens')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('is the name under the default world view, which owns no regions', () => {
    navState.selectedWorldView = { id: 1, name: 'GADM', isDefault: true };
    navState.isCustomWorldView = false;
    renderAt('/');

    expect(screen.getByText('National Archaeological Museum of Athens')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
