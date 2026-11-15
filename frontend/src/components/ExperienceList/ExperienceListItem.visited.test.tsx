/**
 * A row's visited state is the place's own (#2120), the one read Discover
 * draws from too. A place of no parts is ticked from its row: a visit to
 * *Maman* in Bilbao ticks Maman on Canada's list. A whole is ticked by its
 * parts, so its row shows the state and ticks nothing; its places are marked
 * on its card.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HoverProvider } from '../../hooks/useHoverContext';
import type { Experience, RegionExperienceLocation } from '../../api/experiences';
import type { VisitedStatus } from '../../api/visited';
import type { WholeProgress } from '@tyr/shared/visits';
import { ExperienceListItem } from './ExperienceListItem';
import { askWhichPlaces, forgetWholeAsks } from '../shared/wholeAsk';

// The date line under a row reads who is signed in: no one, here.
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ isAuthenticated: false, user: null }) }));
// The question under a whole's row reads the visit read: the Arc ticked as a whole, "? of 34".
vi.mock('../../hooks/useVisitedExperiences', () => ({
  useVisitedExperiences: () => ({
    isWholeTicked: () => true,
    progressOf: () => ({ visited: null, total: 34 }),
  }),
}));

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
  /** The whole's offered leaves, the N of its count. */
  leafCount?: number;
  progress?: WholeProgress;
  signedIn?: boolean;
  /** A whole whose points are casts of one work. */
  castPoints?: boolean;
  visited?: number[];
  onTogglePlace?: (id: number, tick: boolean) => void;
  onClick?: () => void;
}

function renderRow(visitedStatus: VisitedStatus, options: RowOptions = {}) {
  const { whole = false, leafCount = 34, visited = [BILBAO] } = options;
  const experience = (whole
    ? { id: 1093, name: 'Struve Geodetic Arc', kind_id: 1, type: 'cultural', location_count: 2, kinds: [], cast_points: options.castPoints ?? false, has_parts: true, leaf_count: leafCount }
    : { id: 1581, name: 'Maman', kind_id: 3, type: 'sculpture', location_count: 2, kinds: [], cast_points: true, has_parts: false, leaf_count: null }
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
          progress={options.progress}
          isSelected={false}
          locationRefs={{ current: new Map() }}
          itemRefs={{ current: new Map() }}
          showCheckbox={options.signedIn ?? true}
          isLoading={false}
          onHover={() => {}}
          onLeave={() => {}}
          onClick={options.onClick ?? (() => {})}
          onLocationVisitedToggle={() => {}}
          onToggleAllLocations={() => {}}
          onTogglePlace={options.onTogglePlace ?? (() => {})}
          onLocationHover={() => {}}
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
    renderRow('visited', { whole: true, visited: [FUGLENES], onTogglePlace: toggle, onClick: open });

    expect(screen.queryByRole('checkbox')).toBeNull();
    const mark = screen.getByRole('img', { name: 'Visited' });
    expect(mark.tabIndex).toBe(-1);
    fireEvent.click(mark);
    expect(toggle).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalled();
  });

  it('names each state, visited after one of its places as after all of them (ADR-0206)', () => {
    renderRow('visited', { whole: true, visited: [FUGLENES], progress: { visited: 1, total: 34 } });
    expect(screen.getByRole('img', { name: 'Visited' })).toBeTruthy();
    expect(screen.getByText('Struve Geodetic Arc').dataset.visited).toBe('true');
    cleanup();
    renderRow('not_visited', { whole: true, visited: [] });
    expect(screen.getByRole('img', { name: 'Not visited' })).toBeTruthy();
  });

  it('offers no button beside the mark: its places are marked on its card', () => {
    renderRow('visited', { whole: true, visited: [FUGLENES] });
    expect(screen.queryAllByRole('button', { name: /all/ })).toHaveLength(0);
  });
});

describe("the count on a row (ADR-0206)", () => {
  it("reads the whole's own count in every region's list: the Struve Arc in Moldova's after a station in Finland", () => {
    renderRow('visited', { whole: true, visited: [FUGLENES], progress: { visited: 1, total: 34 } });
    expect(screen.getByText('1 of 34')).toBeTruthy();
    expect(screen.getByLabelText('1 of 34 places visited')).toBeTruthy();
    expect(screen.queryByText('1/2')).toBeNull();
  });

  it('reads "?" for a whole ticked without naming a place', () => {
    renderRow('visited', { whole: true, visited: [], progress: { visited: null, total: 34 } });
    expect(screen.getByText('? of 34')).toBeTruthy();
  });

  it('reads 0 of N where the traveller has not been, and N places to a visitor signed out', () => {
    renderRow('not_visited', { whole: true, visited: [] });
    expect(screen.getByText('0 of 34')).toBeTruthy();
    cleanup();
    renderRow('not_visited', { whole: true, visited: [], signedIn: false });
    expect(screen.getByText('34 places')).toBeTruthy();
  });

  it('shows none on a whole of one offered place', () => {
    renderRow('not_visited', { whole: true, leafCount: 1, visited: [] });
    expect(screen.queryByText(/ of |places/)).toBeNull();
  });

  it('counts no visit on an edition a curator has given parts: every cast is the work', () => {
    renderRow('visited', { whole: true, castPoints: true, progress: { visited: 1, total: 34 } });
    expect(screen.queryByText('1 of 34')).toBeNull();
    expect(screen.getByText('2 places')).toBeTruthy();
  });

  it('says how many places an edition stands at, never how many are in the region', () => {
    renderRow('visited');
    expect(screen.getByText('2 places')).toBeTruthy();
    expect(screen.queryByText('1/2')).toBeNull();
  });
});

/**
 * The question after "Visited, not sure which part" on the open card (#2121)
 * stands under the row, below the line offering a date for that tick, so
 * nothing comes between the date and the card.
 */
describe("the question under a whole's row", () => {
  afterEach(() => { forgetWholeAsks(); });

  it('stands under the row once its card asked', () => {
    renderRow('visited', { whole: true, visited: [], progress: { visited: null, total: 34 } });
    expect(screen.queryByText('Which places were you at?')).toBeNull();
    act(() => askWhichPlaces(1093));
    expect(screen.getByText('Which places were you at?')).toBeTruthy();
  });

  it('never stands under a place of no parts', () => {
    renderRow('visited');
    act(() => askWhichPlaces(1581));
    expect(screen.queryByText('Which places were you at?')).toBeNull();
  });
});
