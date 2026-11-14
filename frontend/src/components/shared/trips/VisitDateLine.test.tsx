/**
 * The line under the newest tick (#2120), on the mock's Pantheon: today saved
 * by the request after the tick, "Change" opening the quick choices in the
 * line and Escape closing them, the cross and "Don't ask in this session",
 * and a question in past travels. Every control waits on a visit write. The
 * line and the session are the ticking traveller's own. On the sofa, the
 * Prado and the Thyssen saved as today are asked about once when Kinkaku-ji
 * is ticked ten minutes later.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';

const addTrips = vi.fn();
const changeTrips = vi.fn();
const moveTrips = vi.fn();
let pending = false;
vi.mock('../../../api/trips', () => ({
  addTrips: (...args: unknown[]) => addTrips(...args),
  changeTrips: (...args: unknown[]) => changeTrips(...args),
  moveTrips: (...args: unknown[]) => moveTrips(...args),
}));
vi.mock('../../../hooks/useVisitedExperiences', () => ({ useVisitWritePending: () => pending }));

import { VisitDateLine } from './VisitDateLine';
import { closeOffer, forgetGuessesOn, forgetOffer, offerDate, useCurrentOffer } from './offerRuntime';
import { readSession } from './dateOffer';
import { formatApproximateDate } from '../../../utils/dateFormat';
import { dateLineAt, forgetTraveller, handleTicks, OFFER_SILENCE_KEY, writeOrigin } from '../visitRemovals';

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

describe('a wrong guess of today, asked about once', () => {
  const PRADO = { experienceId: 9101, name: 'Museo del Prado', latitude: 40.4138, longitude: -3.6921 };
  const THYSSEN = { experienceId: 9102, name: 'Museo Thyssen-Bornemisza', latitude: 40.4160, longitude: -3.6949 };
  const KINKAKUJI = { experienceId: 9103, name: 'Kinkaku-ji', latitude: 35.0394, longitude: 135.7292 };
  const START = new Date(2026, 10, 14, 21, 0).getTime();
  const TODAY = { year: 2026, month: 11, day: 14 };
  const Y2019 = { year: 2019, month: null, day: null };
  const tripOf = (experienceId: number) => experienceId + 1000;
  const dated = (ids: number[], d: unknown) =>
    ({ success: true, trips: ids.map(id => ({ experienceId: id - 1000, trip: { id, ...(d as object), createdAt: null } })) });

  beforeEach(() => {
    addTrips.mockImplementation(async (ids: number[], d: unknown) => dated(ids.map(tripOf), d));
    moveTrips.mockReset().mockImplementation(async (moves: { id: number; date: unknown }[]) =>
      dated(moves.map(m => m.id), moves[0].date));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    handleTicks(() => {}, () => {}, () => {});
  });

  /** A tick `minutes` after nine in the evening, its today-trip written. */
  async function tickAt(place: typeof PRADO, minutes: number) {
    vi.spyOn(Date, 'now').mockReturnValue(START + minutes * 60_000);
    await act(async () => offerDate(place.experienceId, [place], new QueryClient(), writeOrigin(7)));
  }
  /** The Prado and the Thyssen ticked on the sofa, each saved as today. */
  async function sofa() {
    await tickAt(PRADO, 0);
    render(<VisitDateLine />);
    await tickAt(THYSSEN, 2);
    await waitFor(() => expect(readSession(7).guesses.map(g => g.trip)).toEqual([tripOf(9101), tripOf(9102)]));
  }
  const status = () => screen.getAllByRole('status').map(el => el.textContent);
  /** "Earlier…", 2019 in the year select, and Save. */
  async function answer2019() {
    fireEvent.click(screen.getByRole('button', { name: 'Earlier…' }));
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Year' }));
    fireEvent.click(screen.getByRole('option', { name: '2019' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });
  }

  it('asks about the two Madrid places when Kinkaku-ji is ticked, moves both with one answer, and puts both back', async () => {
    await sofa();
    await tickAt(KINKAKUJI, 12);
    expect(status()).toEqual(['Museo del Prado and Museo Thyssen-Bornemisza were saved as today. When were you there?']);
    expect(screen.queryByRole('button', { name: 'Change' })).toBeNull();

    await answer2019();
    expect(moveTrips).toHaveBeenCalledWith([
      { id: tripOf(9101), date: Y2019, from: TODAY }, { id: tripOf(9102), date: Y2019, from: TODAY },
    ]);
    await waitFor(() => expect(status()).toEqual([
      'Moved to 2019: Museo del Prado and Museo Thyssen-Bornemisza', 'When were you here?',
    ]));
    // Kinkaku-ji's own question, 10,000 km from Madrid, offers 2019 first.
    expect(screen.getByRole('button', { name: '2019, like Museo del Prado' })).toBeTruthy();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Undo' })); });
    expect(moveTrips).toHaveBeenLastCalledWith([
      { id: tripOf(9101), date: TODAY, from: Y2019 }, { id: tripOf(9102), date: TODAY, from: Y2019 },
    ]);
    await waitFor(() => expect(status()).toEqual(['When were you here?']));
    expect(screen.queryByRole('button', { name: '2019, like Museo del Prado' })).toBeNull();
  });

  it('keeps today on "Today is right", asks the tick\'s own question, and never asks about today again', async () => {
    await sofa();
    await tickAt(KINKAKUJI, 12);
    fireEvent.click(screen.getByRole('button', { name: 'Today is right' }));
    expect(status()).toEqual(['When were you here?']);
    expect(moveTrips).not.toHaveBeenCalled();
    expect(readSession(7)).toMatchObject({ askedAboutToday: true, guesses: [] });
  });

  it('names the date a guess from before midnight holds, and offers "That\'s right" for it', async () => {
    // The Prado at 23:50 is saved as 14 Nov; Kinkaku-ji is ticked at 00:05, on 15 Nov.
    await tickAt(PRADO, 170);
    render(<VisitDateLine />);
    await waitFor(() => expect(readSession(7).guesses.map(g => g.date)).toEqual([TODAY]));
    await tickAt(KINKAKUJI, 185);
    expect(status()).toEqual([`Museo del Prado was saved as ${formatApproximateDate(TODAY)}. When were you there?`]);
    expect(screen.queryByRole('button', { name: 'Today is right' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: "That's right" }));
    expect(status()).toEqual(['When were you here?']);
    expect(moveTrips).not.toHaveBeenCalled();
  });

  it('says only what moved: a place dated in another tab meanwhile is left out', async () => {
    await sofa();
    await tickAt(KINKAKUJI, 12);
    moveTrips.mockImplementationOnce(async () => dated([tripOf(9101)], Y2019));
    await answer2019();
    await waitFor(() => expect(status()[0]).toBe('Moved to 2019: Museo del Prado'));
  });

  it('never asks about a date the traveller chose on the line', async () => {
    await tickAt(PRADO, 0);
    render(<VisitDateLine />);
    await waitFor(() => expect(readSession(7).guesses).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Yesterday' })); });
    expect(readSession(7).guesses).toEqual([]);
    await tickAt(KINKAKUJI, 12);
    expect(status()).toEqual(['When were you here?']);
  });

  it('asks nothing when who is signed in changed between the guesses and the signal', async () => {
    // Wired as the shell wires the chunk: forgetting the traveller forgets the session.
    handleTicks(() => {}, forgetOffer, () => {});
    await sofa();
    act(() => forgetTraveller());
    await tickAt(KINKAKUJI, 12);
    render(<VisitDateLine />);
    expect(screen.queryByText(/saved as today/)).toBeNull();
    // Kinkaku-ji opens the new session, on a trip: its own today is the only guess held.
    await waitFor(() => expect(readSession(7).guesses.map(g => g.trip)).toEqual([tripOf(9103)]));
  });

  it('writes nothing for an answer given after who is signed in changed', async () => {
    await sofa();
    await tickAt(KINKAKUJI, 12);
    // An answer on the line after the change: nothing goes out.
    act(() => forgetTraveller());
    await answer2019();
    expect(moveTrips).not.toHaveBeenCalled();
  });

  it('keeps nothing of a move whose answer arrives after who is signed in changed', async () => {
    await sofa();
    await tickAt(KINKAKUJI, 12);
    let answerMove: () => void = () => {};
    moveTrips.mockImplementationOnce(() => new Promise(resolve => { answerMove = () => resolve(dated([tripOf(9101)], Y2019)); }));
    await answer2019();
    act(() => forgetTraveller());
    await act(async () => answerMove());
    expect(screen.queryByText(/Moved to/)).toBeNull();
    expect(readSession(7).carried).toBeNull();
  });

  it('drops the guesses on places an untick removed', async () => {
    await sofa();
    forgetGuessesOn([THYSSEN.experienceId]);
    await tickAt(KINKAKUJI, 12);
    expect(status()).toEqual(['Museo del Prado was saved as today. When were you there?']);
  });
});

