/**
 * The line under the newest tick (#2120), on the mock's Pantheon: today saved
 * by the request after the tick, "Change" opening the quick choices in the
 * line and Escape closing them, the cross and "Don't ask in this session",
 * and a question in past travels. Every control waits on a visit write. The
 * line and the session are the ticking traveller's own.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';

const addTrips = vi.fn();
const changeTrips = vi.fn();
let pending = false;
vi.mock('../../../api/trips', () => ({ addTrips: (...args: unknown[]) => addTrips(...args), changeTrips: (...args: unknown[]) => changeTrips(...args) }));
vi.mock('../../../hooks/useVisitedExperiences', () => ({ useVisitWritePending: () => pending }));

import { VisitDateLine } from './VisitDateLine';
import { closeOffer, forgetOffer, offerDate, useCurrentOffer } from './offerRuntime';
import { dateLineAt, forgetTraveller, OFFER_SILENCE_KEY, writeOrigin } from '../visitRemovals';

const PANTHEON = { experienceId: 9001, name: 'Pantheon', latitude: 41.8986, longitude: 12.4769 };
const savedTrip = (id: number, year: number | null, month: number | null, day: number | null) =>
  ({ experienceId: PANTHEON.experienceId, trip: { id, year, month, day, createdAt: null } });

beforeEach(() => {
  sessionStorage.clear();
  forgetOffer();
  pending = false;
  addTrips.mockReset().mockImplementation(async (_ids: number[], d: { year: number; month: number; day: number }) =>
    ({ success: true, trips: [savedTrip(71, d.year, d.month, d.day)] }));
  changeTrips.mockReset().mockImplementation(async () => ({ success: true, trips: [savedTrip(71, 2026, 1, 1)] }));
});
afterEach(() => act(() => closeOffer()));

function tickPantheon(createdAt?: string, owner = 7) {
  act(() => offerDate(PANTHEON.experienceId, [PANTHEON], new QueryClient(), writeOrigin(owner, createdAt)));
  render(<VisitDateLine />);
}

describe('the line under the newest tick', () => {
  it('saves today by the request after the tick, and says so under the row that made it', async () => {
    tickPantheon();
    const now = new Date();
    await waitFor(() => expect(addTrips).toHaveBeenCalledWith(
      [PANTHEON.experienceId], { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() },
    ));
    expect(screen.getByRole('status').textContent).toMatch(/^Visited today, /);
    expect(dateLineAt()).toBe(PANTHEON.experienceId);
  });

  it('opens the quick choices in the line, closes them on Escape, and moves the saved trip on a choice', async () => {
    tickPantheon();
    await waitFor(() => expect(addTrips).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    const choices = screen.getByRole('group', { name: 'When were you here?' });
    fireEvent.keyDown(choices, { key: 'Escape' });
    expect(screen.queryByRole('group')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Yesterday' })); });
    expect(changeTrips).toHaveBeenCalledWith([71], expect.objectContaining({ year: expect.any(Number) }));
    expect(screen.getByRole('status').textContent).toMatch(/^Visited yesterday, /);
  });

  it('closes on the cross, and stays closed for the session after "Don\'t ask in this session"', async () => {
    tickPantheon();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(dateLineAt()).toBeNull();

    act(() => offerDate(PANTHEON.experienceId, [PANTHEON], new QueryClient(), writeOrigin(7)));
    fireEvent.click(screen.getByRole('button', { name: "Don't ask in this session" }));
    act(() => offerDate(PANTHEON.experienceId, [PANTHEON], new QueryClient(), writeOrigin(7)));
    expect(dateLineAt()).toBeNull();
    // On a trip today is still saved for each tick, the silenced one too.
    await waitFor(() => expect(addTrips).toHaveBeenCalledTimes(3));
  });

  it('asks a new traveller for a year and saves nothing until they answer', async () => {
    tickPantheon(new Date().toISOString());
    expect(addTrips).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toBe('When were you here?');
    const thisYear = new Date().getFullYear();
    expect(screen.getByRole('button', { name: String(thisYear - 3) })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Earlier…' })).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: String(thisYear - 1) })); });
    expect(addTrips).toHaveBeenCalledWith([PANTHEON.experienceId], { year: thisYear - 1, month: null, day: null });
    expect(screen.getByRole('status').textContent).toBe(`Visited in ${thisYear - 1}. Using ${thisYear - 1} for the next places`);
  });

  it('holds every control while a visit write is on its way', () => {
    pending = true;
    tickPantheon();
    for (const name of ['Change', 'Close', "Don't ask in this session"]) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
  });

  it("starts the next traveller fresh, not in the last one's past travels", async () => {
    tickPantheon(new Date().toISOString(), 7);
    expect(addTrips).not.toHaveBeenCalled();
    act(() => closeOffer());
    // Another account on the same tab, made long ago: on a trip, today saved.
    act(() => offerDate(PANTHEON.experienceId, [PANTHEON], new QueryClient(), writeOrigin(8, '2020-01-01T00:00:00Z')));
    await waitFor(() => expect(addTrips).toHaveBeenCalled());
  });

  it('keeps no place or time of a tick in the tab\'s storage, only until when it is silenced', async () => {
    // Past travels with a carried year: the session holds the ticks, the mode and the year, in memory.
    tickPantheon(new Date().toISOString());
    const thisYear = new Date().getFullYear();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: String(thisYear - 1) })); });
    expect(sessionStorage.length).toBe(0);

    fireEvent.click(screen.getByRole('button', { name: "Don't ask in this session" }));
    expect(Object.keys(sessionStorage)).toEqual([OFFER_SILENCE_KEY]);
    expect(Object.keys(JSON.parse(sessionStorage.getItem(OFFER_SILENCE_KEY)!)).sort()).toEqual(['owner', 'until']);
  });

  it('is forgotten with its traveller, the silence in the tab with it', () => {
    tickPantheon();
    fireEvent.click(screen.getByRole('button', { name: "Don't ask in this session" }));
    expect(sessionStorage.getItem(OFFER_SILENCE_KEY)).not.toBeNull();
    act(() => forgetTraveller());
    expect(dateLineAt()).toBeNull();
    expect(sessionStorage.getItem(OFFER_SILENCE_KEY)).toBeNull();
  });

  it('stores and writes nothing for a tick, or a choice, of an earlier sign-in', async () => {
    // A tick answered after its traveller was forgotten.
    const origin = writeOrigin(7, new Date().toISOString());
    act(() => forgetTraveller());
    act(() => offerDate(PANTHEON.experienceId, [PANTHEON], new QueryClient(), origin));
    expect(dateLineAt()).toBeNull();
    expect(sessionStorage.length).toBe(0);

    // A line still on screen when its traveller was forgotten: a choice on it stores and writes nothing.
    tickPantheon(new Date().toISOString());
    act(() => forgetTraveller());
    const thisYear = new Date().getFullYear();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: String(thisYear - 1) })); });
    fireEvent.click(screen.getByRole('button', { name: "Don't ask in this session" }));
    expect(addTrips).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
  });

  it('says only what was saved, and closes when nothing was', async () => {
    // Three places marked at once; another tab unticked one before the dates were written.
    const places = [PANTHEON, { ...PANTHEON, experienceId: 9002, name: 'Trevi Fountain' }, { ...PANTHEON, experienceId: 9003, name: 'Colosseum' }];
    addTrips.mockImplementationOnce(async (_ids: number[], d: { year: number; month: number; day: number }) => ({
      success: true, trips: [savedTrip(71, d.year, d.month, d.day), { experienceId: 9002, trip: { id: 72, year: d.year, month: d.month, day: d.day, createdAt: null } }],
    }));
    await act(async () => offerDate(PANTHEON.experienceId, places, new QueryClient(), writeOrigin(7)));
    render(<VisitDateLine />);
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/^2 places visited today, /));

    // None saved: the line would name a date nobody has, so it closes.
    addTrips.mockImplementationOnce(async () => ({ success: true, trips: [] }));
    await act(async () => offerDate(PANTHEON.experienceId, [PANTHEON], new QueryClient(), writeOrigin(7)));
    await waitFor(() => expect(dateLineAt()).toBeNull());
  });

  it('puts a write\'s answer only on the line it was made for', async () => {
    let answerFirst: (trips: unknown) => void = () => {};
    addTrips.mockImplementationOnce(() => new Promise(resolve => { answerFirst = trips => resolve({ success: true, trips }); }));
    act(() => offerDate(PANTHEON.experienceId, [PANTHEON], new QueryClient(), writeOrigin(7)));
    // A second tick of the same row, unticked and ticked again, opens its own line; its write answers at once.
    await act(async () => offerDate(PANTHEON.experienceId, [PANTHEON], new QueryClient(), writeOrigin(7)));
    render(<VisitDateLine />);
    await waitFor(() => expect(addTrips).toHaveBeenCalledTimes(2));

    // The first write answers late with a trip of its own: the second line keeps its trip.
    await act(async () => answerFirst([savedTrip(99, 2026, 1, 1)]));
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Yesterday' })); });
    expect(changeTrips).toHaveBeenCalledWith([71], expect.anything());
  });

  it('does not let an earlier write\'s failure close a later line', async () => {
    let failFirst: () => void = () => {};
    addTrips.mockImplementationOnce(() => new Promise((_resolve, reject) => { failFirst = () => reject(new Error('offline')); }));
    act(() => offerDate(PANTHEON.experienceId, [PANTHEON], new QueryClient(), writeOrigin(7)));
    await act(async () => offerDate(PANTHEON.experienceId, [PANTHEON], new QueryClient(), writeOrigin(7)));
    await act(async () => failFirst());
    expect(dateLineAt()).toBe(PANTHEON.experienceId);
  });

  it('drops the offer on screen when its traveller is forgotten', () => {
    let seen: unknown = 'unread';
    function Probe() { seen = useCurrentOffer(); return null; }
    act(() => offerDate(PANTHEON.experienceId, [PANTHEON], new QueryClient(), writeOrigin(7)));
    render(<Probe />);
    expect(seen).not.toBeNull();
    act(() => forgetOffer());
    expect(seen).toBeNull();
  });
});
