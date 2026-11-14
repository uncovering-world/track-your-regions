/**
 * The offer of a date after a tick, as it runs (#2120): the line under the
 * newest tick, the session in the trips chunk's memory, and the trip writes, each
 * carrying the visit-write key so every visit control waits for it. The
 * rules are `dateOffer.ts`'s; this module only applies them.
 */
import { useSyncExternalStore } from 'react';
import { MutationObserver, type QueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../../api/queryKeys';
import { addTrips, changeTrips, type TickedPlace, type TripDateBody, type TripsDated } from '../../../api/trips';
import { invalidateVisitedStatus } from '../../../utils/queryInvalidation';
import { dateLineAt, isCurrentOrigin, showDateLine, type WriteOrigin } from '../visitRemovals';
import {
  answerOffer, forgetSession, offerForTick, readSession, silence, writeSession, type OfferLine, type Spot,
} from './dateOffer';

/** The line on screen: under which row, what it says, and the places and trips its answer moves. */
export interface CurrentOffer {
  at: number;
  line: OfferLine;
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
 * Save `date` on the line's places: a new trip on each place that has none
 * from this line yet, the line's own trips moved otherwise. A write that
 * fails closes the line, which would otherwise name a date nobody saved.
 */
async function saveOn(offer: CurrentOffer, date: TripDateBody): Promise<void> {
  // The write's answer reaches only the line it was made for: the same row,
  // the same tick, a sign-in still current. Another line opened meanwhile,
  // under the same row or another traveller's, is left as it is.
  const mine = () => current?.at === offer.at && current.origin === offer.origin && isCurrentOrigin(offer.origin);
  let answer: TripsDated;
  try {
    answer = offer.trips.length
      ? await write(offer.client, () => changeTrips(offer.trips, date))
      : await write(offer.client, () => addTrips(offer.places, date));
  } catch {
    if (mine()) show(null);
    return;
  }
  if (!mine() || !current) return;
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
  const { session, save, line } = offerForTick(readSession(owner), tick, created, pending?.line ?? null);
  writeSession(session, owner);
  const places = ticked.map(p => p.experienceId);
  const offer: CurrentOffer = {
    at, client, owner, origin, places: pending && line ? [...pending.places, ...places] : places, trips: [],
    where: { lat: tick.lat, lon: tick.lon, label: tick.label },
    line: line ?? { kind: 'ask', count: 0, first: null },
  };
  show(line ? offer : null);
  if (save) void saveOn(offer, save);
}

/** The line on screen while its tick's sign-in is still the current one: a choice on any other stores and writes nothing. */
const liveOffer = () => (current && isCurrentOrigin(current.origin) ? current : null);

/** The traveller's answer on the line: its date on every place the line covers. */
export function answerDate(date: TripDateBody): void {
  const live = liveOffer();
  if (!live) return;
  const { session, line } = answerOffer(readSession(live.owner), live.line, date, live.where, Date.now());
  writeSession(session, live.owner);
  const offer = { ...live, line };
  show(offer);
  void saveOn(offer, date);
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
