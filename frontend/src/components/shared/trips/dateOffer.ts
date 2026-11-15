/**
 * The date offered after a tick (#2120): pure functions over the session the
 * browser tab keeps, so the mock's sequences are walked by a spec without a
 * screen. A tick is taken as made on the spot, and today saved at once,
 * unless a signal says the traveller is filling in past travels; then the
 * line asks for a year and carries the answer to the next nearby ticks. The
 * signal that ends a trip asks once a session about the dates it guessed in
 * the hours before (`today`), since those were likely past travels too.
 */
import type { TripDateBody } from '../../../api/trips';
import { formatApproximateDate } from '../../../utils/dateFormat';
import { plural } from '../../../utils/plural';
import { OFFER_SESSION_KEY, OFFER_SILENCE_KEY } from '../visitRemovals';
import { OFFER } from './offerThresholds';

const HOUR = 3_600_000;

/** Where a tick or an answer was: the place's point. */
export interface Spot { lat: number; lon: number }

/** One tick as the offer reads it: when, where, how many places, and the place's name. */
export interface Tick extends Spot { time: number; count: number; label: string }

/**
 * A trip the offer dated today on its own guess, the traveller having said
 * nothing about it: what a wrong guess is asked about (#773, 2026-11-12).
 */
export interface Guess extends Spot { trip: number; place: number; label: string; time: number; date: TripDateBody }

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
  /** On a trip, the dates saved as today on the offer's own guess within WRONG_GUESS_HOURS. */
  guesses: Guess[];
  /** The guesses were asked about: at most once a session. */
  askedAboutToday: boolean;
}

export const FRESH_SESSION: OfferSession = {
  mode: 'trip', saidToday: false, ticks: [], follow: null, carried: null, silencedUntil: 0,
  guesses: [], askedAboutToday: false,
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
 * The guesses a tick asks about (`today`), when it turns a trip into past
 * travels with the line not silenced: those within WRONG_GUESS_HOURS, once a
 * session. A guess older than that was most likely made on the spot, and is
 * dropped. With the session's guesses and whether it has asked, after it.
 */
function guessesAsked(
  session: OfferSession, time: number, past: boolean, silenced: boolean,
): Pick<OfferSession, 'guesses' | 'askedAboutToday'> & { today: Guess[] | null } {
  const kept = session.guesses.filter(g => time - g.time <= OFFER.WRONG_GUESS_HOURS * HOUR);
  const asks = past && !silenced && session.mode === 'trip' && !session.askedAboutToday && kept.length > 0;
  return asks
    ? { guesses: [], askedAboutToday: true, today: kept }
    : { guesses: kept, askedAboutToday: session.askedAboutToday, today: null };
}

/**
 * What a tick does: the session after it, the date saved for its places (null
 * saves none), whether that date is the offer's own guess of today, the line
 * shown under it (null shows none), and the guesses to ask about first, when
 * this tick is the signal that turns a trip into past travels (`today`, at
 * most once a session). `pending` is a question still unanswered on the
 * line: it moves down to this tick, and its answer will cover every place
 * ticked since the last answer.
 */
export function offerForTick(
  session: OfferSession, tick: Tick, createdAt: number | null, pending: OfferLine | null,
): { session: OfferSession; save: TripDateBody | null; guessed: boolean; line: OfferLine | null; today: Guess[] | null } {
  const past = session.mode === 'past' || signalsPast(session, tick, session.saidToday ? null : createdAt);
  const recent = session.ticks.filter(t => tick.time - t.time <= OFFER.MANY_TICKS_MINUTES * 60_000);
  const silenced = tick.time < session.silencedUntil;
  const { today, ...asked } = guessesAsked(session, tick.time, past, silenced);
  const next: OfferSession = {
    ...session,
    mode: past ? 'past' : 'trip',
    ticks: [...(recent.length ? recent : session.ticks.slice(-1)), { time: tick.time, lat: tick.lat, lon: tick.lon }],
    ...asked,
  };
  const base = { session: next, save: null, guessed: false, today };
  if (pending?.kind === 'ask' && !silenced) {
    return { ...base, line: { ...pending, count: pending.count + tick.count } };
  }
  if (!past) {
    const follow = session.follow && distanceKm(session.follow, tick) <= OFFER.NEARBY_KM ? session.follow.date : null;
    const date = follow ?? dayOf(tick.time);
    const line: OfferLine | null = silenced ? null : { kind: 'saved', date, count: tick.count, carried: null };
    return { ...base, save: date, guessed: !follow, line };
  }
  // In past travels a date nobody saw is a guess: a silenced line saves none.
  if (silenced) return { ...base, line: null };
  const carried = session.carried;
  if (carried && distanceKm(carried, tick) <= OFFER.CARRIED_YEAR_KM) {
    const date = { year: carried.year, month: null, day: null };
    return { ...base, save: date, line: { kind: 'saved', date, count: tick.count, carried: carried.year } };
  }
  return { ...base, line: { kind: 'ask', count: tick.count, first: carried && { year: carried.year, label: carried.label } } };
}

/** The trips the offer has just saved on its own guess of today, kept to be asked about if past travels show. */
export function noteGuesses(session: OfferSession, guesses: Guess[]): OfferSession {
  return { ...session, guesses: [...session.guesses, ...guesses] };
}

/** The guesses `keep` refuses are the traveller's now, or gone: their dates are never asked about. */
export function dropGuesses(session: OfferSession, keep: (guess: Guess) => boolean): OfferSession {
  return { ...session, guesses: session.guesses.filter(keep) };
}

/**
 * The answer to the question about the guessed dates: a year is carried to
 * the next ticks, with the first guessed place as the one that set it, as an
 * answer in past travels is. The session stays in past travels, since the
 * tick that asked is one, and the guesses were dropped when it asked.
 */
export function answerGuesses(session: OfferSession, guesses: Guess[], date: TripDateBody): OfferSession {
  const [{ lat, lon, label }] = guesses;
  return date.year === null ? session : { ...session, carried: { lat, lon, year: date.year, label } };
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

/** Up to two places by name, then how many more: "Museo del Prado, Museo Thyssen-Bornemisza and 1 more place". */
function namePlaces(labels: string[]): string {
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels[0]}, ${labels[1]} and ${plural(labels.length - 2, 'more place')}`;
}

/** Whether every guessed date is still today: the window of guesses can cross midnight. */
export function guessedToday(guesses: Guess[], now: number): boolean {
  return guesses.every(g => sameDate(g.date, dayOf(now)));
}

/**
 * The question about the guessed dates: "Museo del Prado and Museo
 * Thyssen-Bornemisza were saved as today. When were you there?". A guess
 * from before midnight names its date, "Museo del Prado was saved as 13 Nov,
 * Museo Thyssen-Bornemisza as today", since that is what its trip holds.
 */
export function guessesSentence(guesses: Guess[], now: number): string {
  const byDate: Guess[][] = [];
  for (const g of guesses) {
    const group = byDate.find(([first]) => sameDate(first.date, g.date));
    if (group) group.push(g);
    else byDate.push([g]);
  }
  const as = (group: Guess[]) => (sameDate(group[0].date, dayOf(now)) ? 'today' : formatApproximateDate(group[0].date));
  const [first, ...rest] = byDate;
  const others = rest.map(group => `, ${namePlaces(group.map(g => g.label))} as ${as(group)}`).join('');
  return `${namePlaces(first.map(g => g.label))} ${first.length === 1 ? 'was' : 'were'} saved as ${as(first)}${others}. When were you there?`;
}

/** What its answer moved: "Moved to 2019: Museo del Prado and Museo Thyssen-Bornemisza". */
export function movedSentence(guesses: Guess[], date: TripDateBody): string {
  const names = namePlaces(guesses.map(g => g.label));
  return date.year === null ? `Date not remembered for ${names}` : `Moved to ${formatApproximateDate(date)}: ${names}`;
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

/** The session in this tab's memory, and in its `sessionStorage` so a reload keeps it (`storedSession`). */
let held: { owner: number; session: OfferSession } | null = null;

/** A place to about a kilometre: the offer's nearest distance is 50 km (`OFFER.NEARBY_KM`), and no more is stored. */
const roughly = <T extends Spot>(spot: T): T => ({ ...spot, lat: Math.round(spot.lat * 100) / 100, lon: Math.round(spot.lon * 100) / 100 });

/** The session as it is stored: its coordinates rounded. The names and ids stay, since the offer's question names the places. */
function storable(session: OfferSession): OfferSession {
  return {
    ...session,
    ticks: session.ticks.map(roughly),
    follow: session.follow && roughly(session.follow),
    carried: session.carried && roughly(session.carried),
    guesses: session.guesses.map(roughly),
  };
}

/** A stored place with the numbers `extra` names: what the offer reads of each stored element. */
const isStoredSpot = (value: unknown, ...extra: string[]): boolean => {
  const v = value as Record<string, unknown> | null;
  return !!v && ['lat', 'lon', ...extra].every(key => typeof v[key] === 'number');
};

/** A stored date: a year, or none where the traveller does not remember (`NO_DATE`). */
const isStoredDate = (value: unknown): boolean => {
  const year = (value as { year?: unknown } | null)?.year;
  return year === null || typeof year === 'number';
};

/** A session read back from storage, every element of it checked: anything else is not one, and the offer starts fresh. */
const isSession = (value: unknown): value is OfferSession => {
  const s = value as Partial<OfferSession> | null;
  return !!s && (s.mode === 'trip' || s.mode === 'past')
    && typeof s.saidToday === 'boolean' && typeof s.askedAboutToday === 'boolean'
    && Array.isArray(s.ticks) && s.ticks.every(t => isStoredSpot(t, 'time'))
    && Array.isArray(s.guesses) && s.guesses.every(g => isStoredSpot(g, 'trip', 'place', 'time') && isStoredDate(g.date))
    && (s.follow == null || (isStoredSpot(s.follow) && isStoredDate(s.follow.date)))
    && (s.carried == null || isStoredSpot(s.carried, 'year'));
};

/** The session the tab kept across a reload, with its owner, or none: one it cannot read. */
function storedSession(): typeof held {
  try {
    const stored = JSON.parse(sessionStorage.getItem(OFFER_SESSION_KEY) ?? 'null') as { owner?: unknown; session?: unknown } | null;
    return typeof stored?.owner === 'number' && isSession(stored.session) ? { owner: stored.owner, session: { ...FRESH_SESSION, ...stored.session } } : null;
  } catch {
    return null;
  }
}

function keep(owner: number, session: OfferSession): void {
  held = { owner, session };
  try {
    sessionStorage.setItem(OFFER_SESSION_KEY, JSON.stringify({ owner, session: storable(session) }));
  } catch {
    // A refused storage keeps the session in memory only, until a reload.
  }
}

function storedSilence(owner: number): number {
  try {
    const stored = JSON.parse(sessionStorage.getItem(OFFER_SILENCE_KEY) ?? 'null') as { owner?: number; until?: number } | null;
    return stored?.owner === owner && typeof stored.until === 'number' ? stored.until : 0;
  } catch {
    return 0;
  }
}

/**
 * The session of the traveller `owner` (#2120): its ticks, mode, followed
 * answer, carried year and guessed trips, in this module's memory and in the
 * tab's `sessionStorage` (`OFFER_SESSION_KEY`, #2536), so a reload or an
 * address opened in the same tab keeps the session and the tab closing ends
 * it. A traveller's history may be there under the rule of
 * `docs/security/SECURITY.md` § Data Classification: the least the offer
 * needs, its coordinates rounded to about a kilometre, keyed to its owner.
 * "Don't ask in this session" is kept apart as the time it lasts until. A
 * session kept for another traveller is not theirs, and every change of who is
 * signed in forgets both (`forgetSession`, `forgetTraveller`).
 */
export function readSession(owner: number): OfferSession {
  const kept = held ?? storedSession();
  const session = kept?.owner === owner ? kept.session : FRESH_SESSION;
  return { ...session, silencedUntil: Math.max(session.silencedUntil, storedSilence(owner)) };
}

/**
 * Trips the traveller dated on a place's card, or places they unticked: the
 * session no longer counts those trips as the offer's guesses.
 */
export function dropHeldGuesses(stays: (guess: Guess) => boolean): void {
  // After a reload the session is in the tab's storage until the next write.
  const kept = held ?? storedSession();
  if (kept) keep(kept.owner, dropGuesses(kept.session, stays));
}

export function writeSession(session: OfferSession, owner: number): void {
  keep(owner, session);
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
