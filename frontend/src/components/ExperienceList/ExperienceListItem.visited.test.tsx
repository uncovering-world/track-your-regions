/**
 * A row's visited checkbox for an edition (ADR-0145 decision 5, #880): every
 * cast is the whole work, so a visit to Maman in Bilbao ticks Maman on
 * Canada's list too, where a serial site's component counts for itself alone.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HoverProvider } from '../../hooks/useHoverContext';
import type { Experience, RegionExperienceLocation } from '../../api/experiences';
import { ExperienceListItem } from './ExperienceListItem';

const BILBAO = 101;
const OTTAWA = 102;

/** Maman's two casts as Canada's list holds them: Ottawa in region, Bilbao outside it. */
const casts = [
  { id: BILBAO, name: 'Bilbao', in_region: false, latitude: 43.27, longitude: -2.93 },
  { id: OTTAWA, name: 'Ottawa', in_region: true, latitude: 45.43, longitude: -75.7 },
] as unknown as RegionExperienceLocation[];

function renderRow(castPoints: boolean, onToggleAllLocations: (id: number, mark: boolean, everywhere?: boolean) => void = () => {}) {
  const experience = {
    id: 1581, name: 'Maman', kind_id: 3, type: 'sculpture', location_count: 2, kinds: [], cast_points: castPoints,
  } as unknown as Experience;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <HoverProvider>
        <ExperienceListItem
          experience={experience}
          locations={casts}
          locationsResolved
          isLocationVisited={(id) => id === BILBAO}
          isSelected={false}
          locationRefs={{ current: new Map() }}
          itemRefs={{ current: new Map() }}
          showCheckbox
          isLoading={false}
          onHover={() => {}}
          onLeave={() => {}}
          onClick={() => {}}
          onLocationVisitedToggle={() => {}}
          onToggleAllLocations={onToggleAllLocations}
          onLocationHover={() => {}}
          isCollapsed={false}
          onToggleCollapse={() => {}}
        />
      </HoverProvider>
    </QueryClientProvider>,
  );
  return screen.getByRole('checkbox') as HTMLInputElement;
}

describe('the visited checkbox of an edition', () => {
  it('ticks the work on a list where the visited cast is outside the region', () => {
    expect(renderRow(true).checked).toBe(true);
  });

  it("leaves a serial site's row unticked by a visit to a part outside the region", () => {
    expect(renderRow(false).checked).toBe(false);
  });

  it('unticks the work everywhere, since a cast outside the region may be what ticked it', () => {
    const toggle = vi.fn();
    fireEvent.click(renderRow(true, toggle));
    expect(toggle).toHaveBeenCalledWith(1581, false, true);
  });

  it("ticks a serial site's in-region parts, and only them", () => {
    const toggle = vi.fn();
    fireEvent.click(renderRow(false, toggle));
    expect(toggle).toHaveBeenCalledWith(1581, true, false);
  });
});
