/**
 * A place rejected from the region, on its open card in the region's list
 * (#863): taking it out of the region says why, from the region act's
 * reasons, and the pick does not toggle the card it sits on. The Groeningemuseum
 * in Bruges, rejected from a region it does not stand in.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Experience } from '../../api/experiences';
import { ExperienceExpandedDetails } from './ExperienceExpandedDetails';

vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ isAuthenticated: false, user: null }) }));

const groeningemuseum = {
  id: 6237, name: 'Groeningemuseum', kind_id: 2, type: 'museum', location_count: 1, kinds: [], is_rejected: true,
} as unknown as Experience;

describe('taking a rejected place out of the region', () => {
  it('offers the region act\'s reasons and hands on the one picked, the card left as it is', async () => {
    const onRemove = vi.fn();
    const onCardClick = vi.fn();
    render(
      <MemoryRouter>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <div onClick={onCardClick}>
            <ExperienceExpandedDetails
              experience={groeningemuseum}
              locations={[]}
              locationsResolved
              isLocationVisited={() => false}
              locationRefs={{ current: new Map() }}
              showCheckbox={false}
              onTogglePlace={() => {}}
              onToggleAllLocations={() => {}}
              onLocationVisitedToggle={() => {}}
              onLocationHover={() => {}}
              onUnreject={() => {}}
              onRemoveFromRegion={onRemove}
              isRejected
            />
          </div>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    // The menu is a curator's chunk, fetched when the rejected row is drawn.
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    expect(screen.getByText('Remove from this region entirely')).toBeTruthy();
    expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual([
      'Wrong place', 'Nothing to see', 'Same as another', 'Gone or not built', 'Other…',
    ]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Wrong place' }));

    expect(onRemove).toHaveBeenCalledWith({ reasonCode: 'wrong-place' });
    expect(onCardClick).not.toHaveBeenCalled();
  });
});
