/**
 * A row's visited state is the place's own (#2120), the one read Discover
 * draws from too. A place of no parts is ticked from its row: a visit to
 * *Maman* in Bilbao ticks Maman on Canada's list. A whole is ticked by its
 * parts, so its row shows the state and ticks nothing; its places are marked
 * on its card.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HoverProvider } from '../../hooks/useHoverContext';
import type { Experience, RegionExperienceLocation } from '../../api/experiences';
import type { VisitedStatus } from '../../api/visited';
import { ExperienceListItem } from './ExperienceListItem';

const BILBAO = 101;
const OTTAWA = 102;
const RUDI = 201;
const FUGLENES = 202;

/** Maman's two casts as Canada's list holds them: Ottawa in region, Bilbao outside it. */
const casts = [
  { id: BILBAO, name: 'Bilbao', in_region: false, latitude: 43.27, longitude: -2.93 },
  { id: OTTAWA, name: 'Ottawa', in_region: true, latitude: 45.43, longitude: -75.7 },
] as unknown as RegionExperienceLocation[];

/** Two of the Struve Arc's points as Moldova's list holds them: Rudi in region, Fuglenes in Norway. */
const arc = [
  { id: RUDI, name: 'Rudi', in_region: true, latitude: 48.32, longitude: 27.88 },
  { id: FUGLENES, name: 'Fuglenes', in_region: false, latitude: 70.67, longitude: 23.66 },
] as unknown as RegionExperienceLocation[];

interface RowOptions {
  whole?: boolean;
  visited?: number[];
  onTogglePlace?: (id: number, tick: boolean) => void;
  onClick?: () => void;
}

function renderRow(visitedStatus: VisitedStatus, options: RowOptions = {}) {
  const { whole = false, visited = [BILBAO] } = options;
  const experience = (whole
    ? { id: 1093, name: 'Struve Geodetic Arc', kind_id: 1, type: 'cultural', location_count: 2, kinds: [], cast_points: false, has_parts: true }
    : { id: 1581, name: 'Maman', kind_id: 3, type: 'sculpture', location_count: 2, kinds: [], cast_points: true, has_parts: false }
  ) as unknown as Experience;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <HoverProvider>
        <ExperienceListItem
          experience={experience}
          locations={whole ? arc : casts}
          locationsResolved
          isLocationVisited={(id) => visited.includes(id)}
          visitedStatus={visitedStatus}
          isSelected={false}
          locationRefs={{ current: new Map() }}
          itemRefs={{ current: new Map() }}
          showCheckbox
          isLoading={false}
          onHover={() => {}}
          onLeave={() => {}}
          onClick={options.onClick ?? (() => {})}
          onLocationVisitedToggle={() => {}}
          onToggleAllLocations={() => {}}
          onTogglePlace={options.onTogglePlace ?? (() => {})}
          onLocationHover={() => {}}
          isCollapsed={false}
          onToggleCollapse={() => {}}
        />
      </HoverProvider>
    </QueryClientProvider>,
  );
}

describe("the row of a place of no parts", () => {
  it('ticks a place visited wherever the visit was', () => {
    renderRow('visited');
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
  });

  it('ticks an unvisited place as itself', () => {
    const toggle = vi.fn();
    renderRow('not_visited', { visited: [], onTogglePlace: toggle });
    fireEvent.click(screen.getByRole('checkbox'));
    expect(toggle).toHaveBeenCalledWith(1581, true);
  });

  it('takes its own tick back', () => {
    const toggle = vi.fn();
    renderRow('visited', { onTogglePlace: toggle });
    fireEvent.click(screen.getByRole('checkbox'));
    expect(toggle).toHaveBeenCalledWith(1581, false);
  });
});

describe("the row of a whole", () => {
  it('shows its state by name, with no checkbox to click', () => {
    const toggle = vi.fn();
    const open = vi.fn();
    renderRow('partial', { whole: true, visited: [FUGLENES], onTogglePlace: toggle, onClick: open });

    expect(screen.queryByRole('checkbox')).toBeNull();
    const mark = screen.getByRole('img', { name: 'Partly visited' });
    expect(mark.tabIndex).toBe(-1);
    fireEvent.click(mark);
    expect(toggle).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalled();
  });

  it('names each state', () => {
    renderRow('visited', { whole: true, visited: [RUDI, FUGLENES] });
    expect(screen.getByRole('img', { name: 'Visited' })).toBeTruthy();
  });

  it('offers no button beside the mark: its places are marked on its card', () => {
    renderRow('partial', { whole: true, visited: [FUGLENES] });
    expect(screen.queryAllByRole('button', { name: /all/ })).toHaveLength(0);
  });
});
