/**
 * The mock's sequences of the date offered after a tick (#2120), walked through
 * the session's pure functions: what each tick saves and what its line says.
 * Today is 12 November 2026, as in the mock.
 */
import { describe, expect, it } from 'vitest';
import { formatApproximateDate } from '../../../utils/dateFormat';
import {
  FRESH_SESSION, answerOffer, askSentence, askYears, distanceKm, offerForTick, savedSentence, signalsPast, silence,
  type OfferLine, type OfferSession, type Tick,
} from './dateOffer';

const at = (hour: number, minute: number) => new Date(2026, 10, 12, hour, minute).getTime();
const place = (label: string, lat: number, lon: number) => ({ label, lat, lon });

const PANTHEON = place('Pantheon', 41.8986, 12.4769);
const TREVI = place('Trevi Fountain', 41.9009, 12.4833);
const COLOSSEUM = place('Colosseum', 41.8902, 12.4922);
const KINKAKUJI = place('Kinkaku-ji', 35.0394, 135.7292);
const UFFIZI = place('Uffizi Gallery', 43.7678, 11.2553);
const DUOMO = place('Florence Cathedral', 43.7731, 11.2560);

const tick = (where: ReturnType<typeof place>, time: number, count = 1): Tick => ({ ...where, time, count });
const day = (y: number, m: number, d: number) => ({ year: y, month: m, day: d });
const year = (y: number) => ({ year: y, month: null, day: null });
/** "12 Nov" as the reader's locale writes it. */
const NOV_12 = formatApproximateDate(day(2026, 11, 12));
const NOV_11 = formatApproximateDate(day(2026, 11, 11));

/** What the line says, as the traveller reads it. */
function says(line: OfferLine | null, now: number): string | null {
  if (!line) return null;
  if (line.kind === 'saved') return savedSentence(line, now);
  return [askSentence(line), ...askYears(line, now).map(y => y.label)].join(' | ');
}

describe('the date offered after a tick (#2120)', () => {
  it('A: on a trip in Rome, today is saved at once, "Yesterday" moves it, and the next nearby tick follows', () => {
    const pantheon = offerForTick(FRESH_SESSION, tick(PANTHEON, at(14, 2)), null, null);
    expect(pantheon.save).toEqual(day(2026, 11, 12));
    expect(says(pantheon.line, at(14, 2))).toBe(`Visited today, ${NOV_12}`);

    const changed = answerOffer(pantheon.session, pantheon.line!, day(2026, 11, 11), PANTHEON, at(14, 4));
    expect(says(changed.line, at(14, 4))).toBe(`Visited yesterday, ${NOV_11}`);

    const trevi = offerForTick(changed.session, tick(TREVI, at(14, 4)), null, null);
    expect(trevi.save).toEqual(day(2026, 11, 11));
    expect(says(trevi.line, at(14, 4))).toBe(`Visited yesterday, ${NOV_11}`);
    expect(trevi.session.mode).toBe('trip');
  });

  it('B: a new account fills in Rome, carries 2015 over three places, and Kinkaku-ji asks again with "2015, like Pantheon"', () => {
    const created = at(9, 55);
    const pantheon = offerForTick(FRESH_SESSION, tick(PANTHEON, at(10, 0)), created, null);
    expect(pantheon.save).toBeNull();
    expect(says(pantheon.line, at(10, 0))).toBe("When were you here? | 2026 | 2025 | 2024 | 2023");

    // "Earlier…" then 2015, then two more ticks.
    const answered = answerOffer(pantheon.session, pantheon.line!, year(2015), PANTHEON, at(10, 1));
    expect(says(answered.line, at(10, 1))).toBe('Visited in 2015. Using 2015 for the next places');
    const trevi = offerForTick(answered.session, tick(TREVI, at(10, 1)), created, null);
    const colosseum = offerForTick(trevi.session, tick(COLOSSEUM, at(10, 2)), created, null);
    expect([trevi.save, colosseum.save]).toEqual([year(2015), year(2015)]);
    expect(says(colosseum.line, at(10, 2))).toBe('Visited in 2015. Using 2015 for the next places');

    // 9,800 km away: the year is offered first rather than used.
    expect(distanceKm(COLOSSEUM, KINKAKUJI)).toBeGreaterThan(9000);
    const kyoto = offerForTick(colosseum.session, tick(KINKAKUJI, at(10, 4)), created, null);
    expect(kyoto.save).toBeNull();
    expect(says(kyoto.line, at(10, 4))).toBe('When were you here? | 2015, like Pantheon | 2026 | 2025 | 2024');
  });

  it('B: an unanswered question moves down to the newest tick, and its answer covers every place since', () => {
    const created = at(9, 55);
    const pantheon = offerForTick(FRESH_SESSION, tick(PANTHEON, at(10, 0)), created, null);
    const trevi = offerForTick(pantheon.session, tick(TREVI, at(10, 1)), created, pantheon.line);
    expect(trevi.save).toBeNull();
    expect(says(trevi.line, at(10, 1))).toBe('When were you at these 2 places? | 2026 | 2025 | 2024 | 2023');
    const answered = answerOffer(trevi.session, trevi.line!, year(2015), TREVI, at(10, 2));
    expect(says(answered.line, at(10, 2))).toBe('2 places visited in 2015. Using 2015 for the next places');
  });

  it('D: in Florence the cross keeps today, and once silenced no line opens while today is still saved', () => {
    const uffizi = offerForTick(FRESH_SESSION, tick(UFFIZI, at(11, 30)), null, null);
    expect(uffizi.save).toEqual(day(2026, 11, 12));
    // The cross closes the line and saves nothing more: today stays.
    const silenced = silence(uffizi.session, at(11, 30));
    const duomo = offerForTick(silenced, tick(DUOMO, at(12, 10)), null, null);
    expect(duomo.save).toEqual(day(2026, 11, 12));
    expect(duomo.line).toBeNull();

    // In past travels a silenced line saves no date: a date nobody saw is a guess.
    const past = offerForTick({ ...silenced, mode: 'past' }, tick(DUOMO, at(12, 11)), null, null);
    expect(past).toMatchObject({ save: null, line: null });
    // Twelve hours later the line opens again.
    expect(offerForTick(silenced, tick(DUOMO, at(23, 31)), null, null).line).not.toBeNull();
  });

  it('dates a batch with one answer, and says how many places it covers', () => {
    const batch = offerForTick(FRESH_SESSION, tick(PANTHEON, at(14, 2), 3), null, null);
    expect(says(batch.line, at(14, 2))).toBe(`3 places visited today, ${NOV_12}`);
  });

  it('switches to past travels on any one signal', () => {
    const rome: OfferSession = { ...FRESH_SESSION, ticks: [{ ...PANTHEON, time: at(14, 2) }] };
    // Too far, too fast: Rome and Kyoto three minutes apart; Rome at 9:00 and Florence at 14:00 is a trip.
    expect(signalsPast(rome, tick(KINKAKUJI, at(14, 5)), null)).toBe(true);
    const morning = { ...FRESH_SESSION, ticks: [{ ...PANTHEON, time: at(9, 0) }] };
    expect(signalsPast(morning, tick(UFFIZI, at(14, 0)), null)).toBe(false);
    // Many ticks: the tenth within 30 minutes.
    const nine = { ...FRESH_SESSION, ticks: Array.from({ length: 9 }, (_, i) => ({ ...PANTHEON, time: at(14, i) })) };
    expect(signalsPast(nine, tick(PANTHEON, at(14, 10)), null)).toBe(true);
    // A new account: the first 24 hours.
    expect(signalsPast(FRESH_SESSION, tick(PANTHEON, at(14, 0)), at(14, 0) - 23 * 3_600_000)).toBe(true);
    expect(signalsPast(FRESH_SESSION, tick(PANTHEON, at(14, 0)), at(14, 0) - 25 * 3_600_000)).toBe(false);
    // An account whose sign-up time is not recorded is not a new one.
    expect(signalsPast(FRESH_SESSION, tick(PANTHEON, at(14, 0)), null)).toBe(false);
  });

  it('"Today" in past travels makes a trip again, until the next jump or burst asks again (#773)', () => {
    // A new account in Rome is asked at the Colosseum, and again, for both, at the Pantheon;
    // the traveller says they are there today.
    const created = at(9, 55);
    const first = offerForTick(FRESH_SESSION, tick(COLOSSEUM, at(9, 58)), created, null);
    const asked = offerForTick(first.session, tick(PANTHEON, at(10, 0)), created, first.line);
    expect(asked.line).toMatchObject({ kind: 'ask', count: 2 });
    const back = answerOffer(asked.session, asked.line!, day(2026, 11, 12), PANTHEON, at(10, 1));
    expect(back.session).toMatchObject({ mode: 'trip', carried: null });

    // The Trevi Fountain next: today, with no question, though the account is still in its first hours.
    const trevi = offerForTick(back.session, tick(TREVI, at(10, 2)), created, null);
    expect(trevi.save).toEqual(day(2026, 11, 12));
    expect(says(trevi.line, at(10, 2))).toBe(`Visited today, ${NOV_12}`);

    // Kinkaku-ji three minutes later cannot be today's: the session is past travels again, and asks.
    const kyoto = offerForTick(trevi.session, tick(KINKAKUJI, at(10, 5)), created, null);
    expect(kyoto.session.mode).toBe('past');
    expect(kyoto.save).toBeNull();
    expect(kyoto.line?.kind).toBe('ask');

    // A burst counts from the tick "Today" answered: the tenth tick within 30 minutes, that one included, asks again.
    let session = trevi.session;
    for (let minute = 3; minute < 10; minute += 1) {
      const next = offerForTick(session, tick(COLOSSEUM, at(10, minute)), created, null);
      expect(next.session.mode).toBe('trip');
      session = next.session;
    }
    expect(offerForTick(session, tick(COLOSSEUM, at(10, 10)), created, null).line?.kind).toBe('ask');
  });
});
