/**
 * The date offered after a tick (#2120): pure functions over the session the
 * browser tab keeps, so the mock's sequences are walked by a spec without a
 * screen. A tick is taken as made on the spot, and today saved at once,
 * unless a signal says the traveller is filling in past travels; then the
 * line asks for a year and carries the answer to the next nearby ticks.
 */
import type { TripDateBody } from '../../../api/trips';
import { formatApproximateDate } from '../../../utils/dateFormat';
import { plural } from '../../../utils/plural';
import { OFFER_SILENCE_KEY } from '../visitRemovals';
import { OFFER } from './offerThresholds';

const HOUR = 3_600_000;

/** Where a tick or an answer was: the place's point. */
export interface Spot { lat: number; lon: number }

/** One tick as the offer reads it: when, where, how many places, and the place's name. */
export interface Tick extends Spot { time: number; count: number; label: string }

export interface OfferSession {
  /** On a trip now, or filling in past travels: past until the traveller answers "Today". */
  mode: 'trip' | 'past';
  /**
   * The traveller answered "Today" in this session: the account's first hours
   * no longer say they are filling in past travels, which they have just said
   * they are not. A jump or a burst of ticks still does (#773, 2026-11-14).
   */
  saidToday: boolean;
  /** The ticks of the last MANY_TICKS_MINUTES, and the one before this one however old. */
  ticks: (Spot & { time: number })[];
  /** On a trip, the last answer, which a nearby tick follows. */
  follow: (Spot & { date: TripDateBody }) | null;
  /** In past travels, the year the last answer set and the place that set it. */
  carried: (Spot & { year: number; label: string }) | null;
  silencedUntil: number;
}

export const FRESH_SESSION: OfferSession = {
  mode: 'trip', saidToday: false, ticks: [], follow: null, carried: null, silencedUntil: 0,
};

/** What the line under the newest tick says: a date it saved, or a question. */
export type OfferLine =
  | { kind: 'saved'; date: TripDateBody; count: number; carried: number | null }
  | { kind: 'ask'; count: number; first: { year: number; label: string } | null };

/** Great-circle distance in kilometres. */
export function distanceKm(a: Spot, b: Spot): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A day as the traveller's own calendar has it. */
export function dayOf(time: number, daysBack = 0): TripDateBody {
  const d = new Date(time);
  d.setDate(d.getDate() - daysBack);
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}

const sameDate = (a: TripDateBody, b: TripDateBody) => a.year === b.year && a.month === b.month && a.day === b.day;

/** Whether this tick says the traveller is filling in past travels: any one signal holds. */
export function signalsPast(session: OfferSession, tick: Tick, createdAt: number | null): boolean {
  const previous = session.ticks.at(-1);
  if (previous) {
    const km = distanceKm(previous, tick);
    const hours = (tick.time - previous.time) / HOUR;
    if (km > OFFER.JUMP_KM && km > OFFER.SPEED_KMH * hours) return true;
  }
  const recent = session.ticks.filter(t => tick.time - t.time <= OFFER.MANY_TICKS_MINUTES * 60_000);
  if (recent.length + 1 >= OFFER.MANY_TICKS) return true;
  return createdAt !== null && tick.time - createdAt < OFFER.NEW_ACCOUNT_HOURS * HOUR;
}

/**
 * What a tick does: the session after it, the date saved for its places (null
 * saves none), and the line shown under it (null shows none). `pending` is a
 * question still unanswered on the line: it moves down to this tick, and its
 * answer will cover every place ticked since the last answer.
 */
export function offerForTick(
  session: OfferSession, tick: Tick, createdAt: number | null, pending: OfferLine | null,
): { session: OfferSession; save: TripDateBody | null; line: OfferLine | null } {
  const past = session.mode === 'past' || signalsPast(session, tick, session.saidToday ? null : createdAt);
  const recent = session.ticks.filter(t => tick.time - t.time <= OFFER.MANY_TICKS_MINUTES * 60_000);
  const next: OfferSession = {
    ...session,
    mode: past ? 'past' : 'trip',
    ticks: [...(recent.length ? recent : session.ticks.slice(-1)), { time: tick.time, lat: tick.lat, lon: tick.lon }],
  };
  const silenced = tick.time < session.silencedUntil;
  if (pending?.kind === 'ask' && !silenced) {
    return { session: next, save: null, line: { ...pending, count: pending.count + tick.count } };
  }
  if (!past) {
    const follow = session.follow && distanceKm(session.follow, tick) <= OFFER.NEARBY_KM ? session.follow.date : null;
    const date = follow ?? dayOf(tick.time);
    return { session: next, save: date, line: silenced ? null : { kind: 'saved', date, count: tick.count, carried: null } };
  }
  // In past travels a date nobody saw is a guess: a silenced line saves none.
  if (silenced) return { session: next, save: null, line: null };
  const carried = session.carried;
  if (carried && distanceKm(carried, tick) <= OFFER.CARRIED_YEAR_KM) {
    const date = { year: carried.year, month: null, day: null };
    return { session: next, save: date, line: { kind: 'saved', date, count: tick.count, carried: carried.year } };
  }
  return {
    session: next,
    save: null,
    line: { kind: 'ask', count: tick.count, first: carried && { year: carried.year, label: carried.label } },
  };
}

/**
 * The traveller's answer on the line: the session after it and what the line
 * says now. "Today" in past travels makes the session a trip again from the
 * tick it answers, as decided on #773 (2026-11-14): the ticks counted so far
 * are dropped but that one, so the distance and the burst of ticks are
 * counted from it, and the year carried in past travels goes; a later tick
 * far away too soon, or a burst, moves the session back to past travels. Any
 * other date on a trip is followed by the next nearby tick; a year in past
 * travels is carried to the next ticks, with the place that set it.
 */
export function answerOffer(
  session: OfferSession, line: OfferLine, date: TripDateBody, where: Spot & { label: string }, now: number,
): { session: OfferSession; line: OfferLine } {
  const trip = session.mode === 'trip' || sameDate(date, dayOf(now));
  const follow = { lat: where.lat, lon: where.lon, date };
  let next: OfferSession;
  if (!trip) {
    next = { ...session, carried: date.year === null ? session.carried : { lat: where.lat, lon: where.lon, year: date.year, label: where.label } };
  } else if (session.mode === 'past') {
    next = { ...session, mode: 'trip', saidToday: true, ticks: session.ticks.slice(-1), carried: null, follow };
  } else {
    next = { ...session, follow };
  }
  const carried = !trip && date.year !== null ? date.year : null;
  return { session: next, line: { kind: 'saved', date, count: line.count, carried } };
}

/** "Don't ask in this session": no line until the tab closes or SILENCE_HOURS pass. */
export function silence(session: OfferSession, now: number): OfferSession {
  return { ...session, silencedUntil: now + OFFER.SILENCE_HOURS * HOUR };
}

/** What a saved line says: "Visited today, 12 Nov", "3 places visited in 2015. Using 2015 for the next places". */
export function savedSentence(line: Extract<OfferLine, { kind: 'saved' }>, now: number): string {
  const { date, count, carried } = line;
  const visited = count > 1 ? `${plural(count, 'place')} visited` : 'Visited';
  let when: string;
  if (date.year === null) when = ', date not remembered';
  else if (sameDate(date, dayOf(now))) when = ` today, ${formatApproximateDate(date)}`;
  else if (sameDate(date, dayOf(now, 1))) when = ` yesterday, ${formatApproximateDate(date)}`;
  else when = `${date.day === null ? ' in' : ' on'} ${formatApproximateDate(date)}`;
  const using = carried === null ? '' : `. Using ${carried} for the next places`;
  return `${visited}${when}${using}`;
}

/** What an asking line says: "When were you here?", or for a batch "When were you at these 3 places?". */
export function askSentence(line: Extract<OfferLine, { kind: 'ask' }>): string {
  return line.count > 1 ? `When were you at these ${line.count} places?` : 'When were you here?';
}

/** The years an asking line offers as buttons: the carried one first, "2015, like Rome", then the latest. */
export function askYears(line: Extract<OfferLine, { kind: 'ask' }>, now: number): { year: number; label: string }[] {
  const thisYear = new Date(now).getFullYear();
  const latest = Array.from({ length: line.first ? 3 : 4 }, (_, i) => ({ year: thisYear - i, label: String(thisYear - i) }));
  return line.first ? [{ year: line.first.year, label: `${line.first.year}, like ${line.first.label}` }, ...latest] : latest;
}

/** The session, in this tab's memory only: where and when the traveller ticked is never stored. */
let held: { owner: number; session: OfferSession } | null = null;

function storedSilence(owner: number): number {
  try {
    const stored = JSON.parse(sessionStorage.getItem(OFFER_SILENCE_KEY) ?? 'null') as { owner?: number; until?: number } | null;
    return stored?.owner === owner && typeof stored.until === 'number' ? stored.until : 0;
  } catch {
    return 0;
  }
}

/**
 * The session of the traveller `owner` (#2120). Its ticks, mode, followed
 * answer and carried year live in this module's memory, so a reload starts
 * a fresh session and the tab's storage holds no place or time of a tick
 * (ASVS V14.3.3). Only "Don't ask in this session" is kept in
 * `sessionStorage`, as the time it lasts until and whose it is, so a reload
 * keeps it; the tab closing ends it. A session kept for another traveller is
 * not theirs, and every change of who is signed in forgets both
 * (`forgetSession`, `forgetTraveller`).
 */
export function readSession(owner: number): OfferSession {
  const session = held?.owner === owner ? held.session : FRESH_SESSION;
  return { ...session, silencedUntil: Math.max(session.silencedUntil, storedSilence(owner)) };
}

export function writeSession(session: OfferSession, owner: number): void {
  held = { owner, session };
  if (!session.silencedUntil) return;
  try {
    sessionStorage.setItem(OFFER_SILENCE_KEY, JSON.stringify({ owner, until: session.silencedUntil }));
  } catch {
    // A refused storage keeps the silence in memory only, until a reload.
  }
}

/** Who is signed in changed: the session in memory goes with its traveller. */
export function forgetSession(): void {
  held = null;
}
