/**
 * The question after "Visited, not sure which part" (#2121, ADR-0206): one
 * line under the tick asks which places, the card's own list of places is the
 * picker, and "I don't remember" leaves the whole at "? of N" for the session.
 * Drawn here as a card holds them: the button, the line and the list, over
 * one store. The Struve Geodetic Arc in Moldova's list, its station Rudi in
 * the region and Fuglenes in Norway outside it.
 */

import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { WholeProgress } from '@tyr/shared/visits';
import { HoverProvider } from '../../hooks/useHoverContext';
import { CardLocationList } from '../ExperienceList/CardLocationList';
import { LocationsSection } from '../discover/LocationsSection';
import { offersWholeTick } from './visitWords';
import { WholeVisitAsk } from './WholeVisitAsk';
import { WholeVisitButton } from './WholeVisitButton';
import { forgetTraveller } from './visitRemovals';
import { askWhichPlaces, forgetWholeAsks, revealPlaces, useAsking } from './wholeAsk';

// The date line under a place's row reads who is signed in: no one, here.
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ isAuthenticated: false, user: null }) }));

const STRUVE = 847;
const OTHER_WHOLE = 431;
const RUDI = 201;

/** What the visit read says of the Arc, written by the card below as the traveller clicks. */
let held: { ticked: boolean; progress: WholeProgress | undefined } = { ticked: false, progress: undefined };
vi.mock('../../hooks/useVisitedExperiences', () => ({
  useVisitedExperiences: () => ({
    isWholeTicked: (id: number) => id === STRUVE && held.ticked,
    progressOf: (id: number) => (id === STRUVE ? held.progress : undefined),
  }),
}));

const QUESTION = 'Which places were you at?';
const WHOLE_TICK = 'Visited, not sure which part';
const asked = () => screen.queryByText(QUESTION) !== null;

const place = (id: number, name: string, regionPath: string | null, isVisited = false) => ({
  id, name, externalRef: null, ordinal: id, isVisited, latitude: 48, longitude: 28, hasPicture: false, regionPath,
});

/**
 * The Arc's open card: the whole's own tick where `offersWholeTick` offers it,
 * the line under it and the list of places, Map mode's or Discover's. A tick
 * on the whole reads "? of 34", a tick on Rudi "1 of 34".
 */
function Card({ list, startTicked = false }: { list: 'map' | 'discover'; startTicked?: boolean }) {
  const [ticked, setTicked] = useState(startTicked);
  const [rudi, setRudi] = useState(false);
  let progress: WholeProgress | undefined;
  if (rudi) progress = { visited: 1, total: 34 };
  else if (ticked) progress = { visited: null, total: 34 };
  held = { ticked, progress };
  const toggleRudi = () => setRudi(!rudi);
  return (
    <HoverProvider>
      {offersWholeTick({ has_parts: true }, { has_own_point: false }, { ticked, progress }) && (
        <WholeVisitButton experienceId={STRUVE} ticked={ticked} onToggle={() => setTicked(!ticked)} />
      )}
      <WholeVisitAsk experienceId={STRUVE} />
      {list === 'map'
        ? (
          <CardLocationList
            experienceId={STRUVE}
            objectName="Struve Geodetic Arc"
            inRegionLocs={[place(RUDI, 'Rudi', null, rudi)]}
            outOfRegionLocs={[place(202, 'Fuglenes', 'Europe > Norway > Finnmark')]}
            showCheckbox
            isAuthenticated
            inRegionVisitedCount={rudi ? 1 : 0}
            onLocationHover={vi.fn()}
            onLocationVisitedToggle={toggleRudi}
            registerRef={vi.fn()}
          />
        )
        : (
          <LocationsSection
            experienceId={STRUVE}
            objectName="Struve Geodetic Arc"
            locations={Array.from({ length: 34 }, (_, i) => ({
              id: RUDI + i, name: i === 0 ? 'Rudi' : `Station ${i + 1}`, latitude: 48, longitude: 28, ordinal: i,
              isVisited: i === 0 && rudi,
            }))}
            totalCount={34}
            visitCount={null}
            isAuthenticated
            onMarkLocation={toggleRudi}
            onUnmarkLocation={toggleRudi}
            onMarkAll={vi.fn()}
            onUnmarkAll={vi.fn()}
          />
        )}
    </HoverProvider>
  );
}

/** Whether a whole's card asks now, as the store says it. */
function Asking({ id }: { id: number }) {
  return useAsking(id) && <p>asking {id}</p>;
}

const pressWholeTick = () => fireEvent.click(screen.getByRole('button', { name: WHOLE_TICK }));

let scrolled: ReturnType<typeof vi.fn>;
beforeEach(() => {
  forgetWholeAsks();
  held = { ticked: false, progress: undefined };
  scrolled = vi.fn();
  HTMLElement.prototype.scrollIntoView = scrolled as unknown as HTMLElement['scrollIntoView'];
});
afterEach(() => { forgetWholeAsks(); });

describe('the question after a whole is ticked as a whole', () => {
  it('asks which places once the tick is pressed, and not before', () => {
    render(<Card list="map" />);
    expect(asked()).toBe(false);

    pressWholeTick();
    expect(screen.getByText(QUESTION).getAttribute('role')).toBe('status');
    expect(screen.getByRole('button', { name: 'Mark them in the list' })).toBeTruthy();
    expect(screen.getByRole('button', { name: "I don't remember" })).toBeTruthy();
  });

  it('brings the list of places into view, with the keyboard taken to it', () => {
    render(<Card list="map" />);
    pressWholeTick();

    fireEvent.click(screen.getByRole('button', { name: 'Mark them in the list' }));
    const focused = document.activeElement as HTMLElement;
    expect(focused).not.toBe(document.body);
    expect(focused.tabIndex).toBe(-1);
    expect(focused.contains(screen.getByRole('checkbox'))).toBe(true);
    expect(scrolled).toHaveBeenCalledTimes(1);
  });

  it("goes once a place is named, turning \"? of 34\" into \"1 of 34\", and the whole's own tick stays to be taken back", () => {
    render(<Card list="map" />);
    pressWholeTick();

    fireEvent.click(screen.getByRole('checkbox'));
    expect(held.progress).toEqual({ visited: 1, total: 34 });
    expect(asked()).toBe(false);
    expect(screen.getByRole('button', { name: WHOLE_TICK }).getAttribute('aria-pressed')).toBe('true');

    // Taking Rudi back leaves the whole at "? of 34" and does not ask again: the question had its answer.
    fireEvent.click(screen.getByRole('checkbox'));
    expect(asked()).toBe(false);
  });

  it('offers the whole tick no more once a place is named and that tick is taken back', () => {
    render(<Card list="map" />);
    pressWholeTick();
    fireEvent.click(screen.getByRole('checkbox'));

    pressWholeTick();
    expect(screen.queryByRole('button', { name: WHOLE_TICK })).toBeNull();
    expect(held).toEqual({ ticked: false, progress: { visited: 1, total: 34 } });
  });

  it('goes when the tick is taken back', () => {
    render(<Card list="map" />);
    pressWholeTick();
    pressWholeTick();
    expect(asked()).toBe(false);
  });

  it('goes with the card, so a later open does not ask again', () => {
    const view = render(<Card list="map" />);
    pressWholeTick();
    view.unmount();

    render(<Card list="map" startTicked />);
    expect(held).toEqual({ ticked: true, progress: { visited: null, total: 34 } });
    expect(asked()).toBe(false);
  });
});

describe('"I don\'t remember"', () => {
  it('closes the line and leaves the whole ticked, at "? of 34"', () => {
    render(<Card list="map" />);
    pressWholeTick();

    fireEvent.click(screen.getByRole('button', { name: "I don't remember" }));
    expect(asked()).toBe(false);
    expect(held).toEqual({ ticked: true, progress: { visited: null, total: 34 } });
  });

  it('is kept for the session: the same whole ticked again does not ask, another whole still does', () => {
    render(<Card list="map" />);
    pressWholeTick();
    fireEvent.click(screen.getByRole('button', { name: "I don't remember" }));

    pressWholeTick();
    pressWholeTick();
    expect(held.ticked).toBe(true);
    expect(asked()).toBe(false);

    render(<Asking id={OTHER_WHOLE} />);
    act(() => askWhichPlaces(OTHER_WHOLE));
    expect(screen.getByText(`asking ${OTHER_WHOLE}`)).toBeTruthy();
  });

  it('is forgotten with the traveller', () => {
    render(<Card list="map" />);
    pressWholeTick();
    fireEvent.click(screen.getByRole('button', { name: "I don't remember" }));
    pressWholeTick();

    act(() => forgetTraveller());
    pressWholeTick();
    expect(asked()).toBe(true);
  });
});

describe("the list a whole's question reveals", () => {
  it("in Discover, opens the folded section of the Arc's 34 places", () => {
    render(<Card list="discover" />);
    const header = screen.getByRole('button', { name: /Locations \(34\)/ });
    expect(header.getAttribute('aria-expanded')).toBe('false');

    pressWholeTick();
    fireEvent.click(screen.getByRole('button', { name: 'Mark them in the list' }));
    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(scrolled).toHaveBeenCalledTimes(1);
  });

  it("is the asking whole's only: another whole's question moves nothing here", () => {
    render(<Card list="discover" />);
    act(() => revealPlaces(OTHER_WHOLE));
    expect(screen.getByRole('button', { name: /Locations \(34\)/ }).getAttribute('aria-expanded')).toBe('false');
    expect(scrolled).not.toHaveBeenCalled();
  });
});
