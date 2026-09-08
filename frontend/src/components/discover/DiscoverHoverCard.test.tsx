/**
 * The treasures-inside chip on Discover's own hover card.
 *
 * `DiscoverHoverCard` renders the same shared `hoverPreview` object as map
 * mode's `HoverPreviewCard` (`useHoverContext.tsx`), so the chip answers to
 * the same rule here: a real count on an ordinary place shows it, and a
 * museum stays silent even with a real count, because every museum row
 * already carries works.
 */

import { describe, it, expect } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { HoverProvider, useHoverActions } from '../../hooks/useHoverContext';
import { DiscoverHoverCard } from './DiscoverHoverCard';

const ART_MUSEUMS = 2;
const PLACES_OF_WORSHIP = 4;

let actions: ReturnType<typeof useHoverActions>;
function GrabActions() {
  actions = useHoverActions();
  return null;
}

function renderCard() {
  return render(
    <HoverProvider>
      <GrabActions />
      <DiscoverHoverCard />
    </HoverProvider>,
  );
}

const basePreview = {
  experienceId: 1,
  experienceName: 'Uffizi Gallery',
  locationId: null,
  locationName: null,
  categoryName: 'Art Museums',
  imageUrl: null,
  imageCredit: null,
  longitude: 11.26,
  latitude: 43.77,
};

describe('DiscoverHoverCard treasures-inside chip', () => {
  it('renders nothing at all with no hover', () => {
    const { container } = renderCard();

    expect(container).toBeEmptyDOMElement();
  });

  it('says how many treasures are inside for an ordinary place', () => {
    renderCard();

    act(() => {
      actions.setHoverPreview({ ...basePreview, categoryId: PLACES_OF_WORSHIP, treasureCount: 3 });
    });

    expect(screen.getByText('3 treasures inside')).toBeInTheDocument();
  });

  it('stays silent for a museum, even with a real count', () => {
    renderCard();

    act(() => {
      actions.setHoverPreview({ ...basePreview, categoryId: ART_MUSEUMS, treasureCount: 55 });
    });

    expect(screen.getByText('Uffizi Gallery')).toBeInTheDocument();
    expect(screen.queryByText(/treasures inside/)).not.toBeInTheDocument();
  });
});
