/**
 * The offer of a date after a tick, as it runs (#2120): the line under the
 * newest tick, the session in the trips chunk's memory, and the trip writes, each
 * carrying the visit-write key so every visit control waits for it. The
 * rules are `dateOffer.ts`'s; this module only applies them.
 */
import { useSyncExternalStore } from 'react';
import { MutationObserver, type QueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../../api/queryKeys';
import { addTrips, changeTrips, moveTrips, type TickedPlace, type TripDateBody, type TripsDated } from '../../../api/trips';
import { invalidateVisitedStatus } from '../../../utils/queryInvalidation';
import { dateLineAt, isCurrentOrigin, showDateLine, type WriteOrigin } from '../visitRemovals';
import {
  answerGuesses, answerOffer, dropGuesses, dropHeldGuesses, forgetSession, noteGuesses, offerForTick, readSession,
  silence, writeSession, type Guess, type OfferLine, type OfferSession, type Spot,
} from './dateOffer';

/**
 * The question about the dates the offer guessed, asked once a session before
 * the tick's own (#773): the guesses while it asks, then what its answer moved
 * with the year it carried and the one carried before, for its Undo.
 */
export type GuessesLine =
  | { kind: 'ask'; guesses: Guess[] }
  | { kind: 'moved'; moved: Guess[]; date: TripDateBody; carried: OfferSession['carried']; before: OfferSession['carried'] };

/** The line on screen: under which row, what it says, and the places and trips its answer moves. */
export interface CurrentOffer {
  at: number;
  line: OfferLine;
  /** Asked before the line's own question when the tick turned a trip into past travels. */
  guesses: GuessesLine | null;
  /** The place the line was opened for last: its name, and where the next answer counts from. */
  where: Spot & { label: string };
  places: number[];
  trips: number[];
  client: QueryClient;
  /** The traveller whose tick opened it: the only one it is shown to, and whose session it reads. */
  owner: number;
  /** The tick's sign-in, checked again before a choice on the line stores or writes anything. */
  origin: WriteOrigin;
}

let current: CurrentOffer | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

function show(next: CurrentOffer | null): void {
  current = next;
  listeners.forEach(listener => listener());
  showDateLine(next && next.at, next?.owner);
}

export function useCurrentOffer(): CurrentOffer | null {
  return useSyncExternalStore(subscribe, () => current);
}

/** A trip write as every visit write is: under the visit-write key, the visits read again after it. */
function write(client: QueryClient, run: () => Promise<TripsDated>): Promise<TripsDated> {
  return new MutationObserver(client, {
    mutationKey: queryKeys.visited.write,
    mutationFn: run,
    onSuccess: () => invalidateVisitedStatus(client),
  }).mutate();
}

/**
 * Whether a write's answer may reach the line on screen: the same row, the
 * same tick, a sign-in still current. Another line opened meanwhile, under
 * the same row or another traveller's, is left as it is.
 */
const mine = (offer: CurrentOffer): boolean =>
  current?.at === offer.at && current.origin === offer.origin && isCurrentOrigin(offer.origin);

/**
 * Save `date` on the line's places: a new trip on each place that has none
 * from this line yet, the line's own trips moved otherwise. A write that
 * fails closes the line, which would otherwise name a date nobody saved.
 * Trips saved on the offer's own guess of today (`guessed`, the tick's
 * places) are kept in the session to be asked about, whether or not the
 * line is still open.
 */
async function saveOn(offer: CurrentOffer, date: TripDateBody, guessed?: TickedPlace[]): Promise<void> {
  let answer: TripsDated;
  try {
    answer = offer.trips.length
      ? await write(offer.client, () => changeTrips(offer.trips, date))
      : await write(offer.client, () => addTrips(offer.places, date));
  } catch {
    if (mine(offer)) show(null);
    return;
  }
  if (guessed && isCurrentOrigin(offer.origin)) {
    const time = Date.now();
    const guesses = answer.trips.flatMap(({ experienceId, trip }) => {
      const place = guessed.find(p => p.experienceId === experienceId);
      return place
        ? [{ trip: trip.id, place: experienceId, label: place.name, lat: place.latitude, lon: place.longitude, time, date }]
        : [];
    });
    writeSession(noteGuesses(readSession(offer.owner), guesses), offer.owner);
  }
  if (!mine(offer) || !current) return;
  // The batch leaves out a place unticked meanwhile: the line says only what
  // was saved, and closes when nothing was.
  const saved = answer.trips;
  if (!saved.length) return show(null);
  show({
    ...current,
    trips: saved.map(s => s.trip.id),
    places: saved.map(s => s.experienceId),
    line: current.line.kind === 'saved' ? { ...current.line, count: saved.length } : current.line,
  });
}

/**
 * A tick's answer, from the shell: what it saved and the line it opens, under
 * the row `at`, for the traveller who ticked. Nothing is stored or written for
 * a tick of an earlier sign-in.
 */
export function offerDate(at: number, ticked: TickedPlace[], client: QueryClient, origin: WriteOrigin): void {
  if (!isCurrentOrigin(origin)) return;
  const { owner, createdAt } = origin;
  const place = ticked[0];
  const tick = { time: Date.now(), lat: place.latitude, lon: place.longitude, count: ticked.length, label: place.name };
  // A question still on screen moves down to this tick; one closed is gone.
  const pending = current && dateLineAt() !== null && current.line.kind === 'ask' ? current : null;
  // An account with no recorded sign-up time is read as not new.
  const created = createdAt ? Date.parse(createdAt) : null;
  const { session, save, guessed, line, today } = offerForTick(readSession(owner), tick, created, pending?.line ?? null);
  writeSession(session, owner);
  const places = ticked.map(p => p.experienceId);
  // The question about the guessed dates, still unanswered, moves down with the line's own.
  const unanswered = pending?.guesses?.kind === 'ask' ? pending.guesses : null;
  const guesses: GuessesLine | null = today ? { kind: 'ask', guesses: today } : unanswered;
  const offer: CurrentOffer = {
    at, client, owner, origin, places: pending && line ? [...pending.places, ...places] : places, trips: [],
    where: { lat: tick.lat, lon: tick.lon, label: tick.label },
    line: line ?? { kind: 'ask', count: 0, first: null },
    guesses,
  };
  show(line ? offer : null);
  if (save) void saveOn(offer, save, guessed ? ticked : undefined);
}

/** The line on screen while its tick's sign-in is still the current one: a choice on any other stores and writes nothing. */
const liveOffer = () => (current && isCurrentOrigin(current.origin) ? current : null);

/** The traveller's answer on the line: its date on every place the line covers. */
export function answerDate(date: TripDateBody): void {
  const live = liveOffer();
  if (!live) return;
  const { session, line } = answerOffer(readSession(live.owner), live.line, date, live.where, Date.now());
  // The traveller has said when for the line's own trips: they are no longer a guess.
  writeSession(dropGuesses(session, g => !live.trips.includes(g.trip)), live.owner);
  const offer = { ...live, line };
  show(offer);
  void saveOn(offer, date);
}

/** The tick's own question, offering first the year carried now, as a tick far from the place that set it is. */
const offeringFirst = (line: OfferLine, carried: OfferSession['carried']): OfferLine =>
  (line.kind === 'ask' ? { ...line, first: carried && { year: carried.year, label: carried.label } } : line);

/**
 * The answer to the question about the guessed dates: every one of them moved
 * to `date`, each only while it still holds the date guessed, so a date the
 * traveller set meanwhile, here or in another tab, stays. The line then says
 * what moved, with an Undo, above the tick's own question, which offers
 * the year first; nothing moved, or a write that fails, leaves the tick's
 * own question alone.
 */
export async function answerGuessedDates(date: TripDateBody): Promise<void> {
  const live = liveOffer();
  if (live?.guesses?.kind !== 'ask') return;
  const { guesses } = live.guesses;
  let answer: TripsDated;
  try {
    answer = await write(live.client, () => moveTrips(guesses.map(g => ({ id: g.trip, date, from: g.date }))));
  } catch {
    if (mine(live) && current) show({ ...current, guesses: null });
    return;
  }
  if (!mine(live) || !current) return;
  const moved = guesses.filter(g => answer.trips.some(t => t.trip.id === g.trip));
  if (!moved.length) return show({ ...current, guesses: null });
  const before = readSession(live.owner);
  const after = answerGuesses(before, moved, date);
  writeSession(after, live.owner);
  show({
    ...current,
    line: offeringFirst(current.line, after.carried),
    guesses: { kind: 'moved', moved, date, carried: after.carried, before: before.carried },
  });
}

/** "Today is right": the guessed dates stay, and the tick's own question is asked. */
export function keepGuessedDates(): void {
  const live = liveOffer();
  if (live) show({ ...live, guesses: null });
}

/**
 * The Undo of that answer: each trip it moved back to the date guessed, only
 * while it still holds the answer, and the year it carried taken back if no
 * later answer replaced it. A write that fails leaves the Undo to try again.
 */
export async function undoGuessedDates(): Promise<void> {
  const live = liveOffer();
  if (live?.guesses?.kind !== 'moved') return;
  const { moved, date, carried, before } = live.guesses;
  try {
    await write(live.client, () => moveTrips(moved.map(g => ({ id: g.trip, date: g.date, from: date }))));
  } catch {
    return;
  }
  if (!mine(live) || !current) return;
  const session = readSession(live.owner);
  if (session.carried !== carried) return show({ ...current, guesses: null });
  writeSession({ ...session, carried: before }, live.owner);
  show({ ...current, line: offeringFirst(current.line, before), guesses: null });
}

/** Places unticked: the trips guessed on them went with their visits, and are never asked about. */
export function forgetGuessesOn(places: number[]): void {
  dropHeldGuesses(g => !places.includes(g.place));
}

/** The cross: the line goes; a date it showed stays saved, a question it asked saves none. */
export function closeOffer(): void {
  show(null);
}

/** "Don't ask in this session": the line goes, and no line opens for SILENCE_HOURS or until the tab closes. */
export function silenceOffer(): void {
  const live = liveOffer();
  if (live) writeSession(silence(readSession(live.owner), Date.now()), live.owner);
  show(null);
}

/** Who is signed in changed (`forgetTraveller`): the offer on screen goes with its traveller. */
export function forgetOffer(): void {
  current = null;
  forgetSession();
  listeners.forEach(listener => listener());
}
