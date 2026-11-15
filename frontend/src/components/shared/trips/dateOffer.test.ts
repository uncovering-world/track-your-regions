/**
 * The mock's sequences of the date offered after a tick (#2120), walked through
 * the session's pure functions: what each tick saves and what its line says.
 * Today is 12 November 2026, as in the mock.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatApproximateDate } from '../../../utils/dateFormat';
import { OFFER_SESSION_KEY } from '../visitRemovals';
import {
  FRESH_SESSION, answerGuesses, answerOffer, askSentence, askYears, distanceKm, dropGuesses, guessedToday, guessesSentence,
  movedSentence, noteGuesses, offerForTick, savedSentence, signalsPast, silence,
  type Guess, type OfferLine, type OfferSession, type Tick,
} from './dateOffer';

const at = (hour: number, minute: number) => new Date(2026, 10, 12, hour, minute).getTime();
const place = (label: string, lat: number, lon: number) => ({ label, lat, lon });

const PANTHEON = place('Pantheon', 41.8986, 12.4769);
const TREVI = place('Trevi Fountain', 41.9009, 12.4833);
const COLOSSEUM = place('Colosseum', 41.8902, 12.4922);
const KINKAKUJI = place('Kinkaku-ji', 35.0394, 135.7292);
const UFFIZI = place('Uffizi Gallery', 43.7678, 11.2553);
const DUOMO = place('Florence Cathedral', 43.7731, 11.2560);
const PRADO = place('Museo del Prado', 40.4138, -3.6921);
const THYSSEN = place('Museo Thyssen-Bornemisza', 40.4160, -3.6949);
const REINA_SOFIA = place('Museo Reina Sofía', 40.4086, -3.6943);

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

  describe('C: a wrong guess of today, asked about once', () => {
    /** A tick on the sofa as the offer makes it, its today-trip saved as `trip`. */
    function onTheSofa(session: OfferSession, where: ReturnType<typeof place>, time: number, trip: number) {
      const ticked = offerForTick(session, tick(where, time), null, null);
      const guess: Guess = { ...where, trip, place: trip, time, date: ticked.save! };
      return { ...ticked, session: ticked.guessed ? noteGuesses(ticked.session, [guess]) : ticked.session };
    }

    it('asks about the Prado and the Thyssen, saved as today, when Kinkaku-ji is ticked ten minutes later', () => {
      const prado = onTheSofa(FRESH_SESSION, PRADO, at(21, 0), 81);
      const thyssen = onTheSofa(prado.session, THYSSEN, at(21, 2), 82);
      expect([prado.guessed, thyssen.guessed]).toEqual([true, true]);
      expect(says(thyssen.line, at(21, 2))).toBe(`Visited today, ${NOV_12}`);

      const kyoto = offerForTick(thyssen.session, tick(KINKAKUJI, at(21, 12)), null, null);
      expect(kyoto.today?.map(g => g.trip)).toEqual([81, 82]);
      expect(guessesSentence(kyoto.today!, at(21, 12)))
        .toBe('Museo del Prado and Museo Thyssen-Bornemisza were saved as today. When were you there?');
      // The tick's own question waits below it: Kinkaku-ji is not dated today either.
      expect(kyoto).toMatchObject({ save: null, line: { kind: 'ask' }, session: { mode: 'past', askedAboutToday: true } });

      // 2019 is carried from Madrid: Kyoto, 10,000 km away, is offered it first rather than given it.
      const answered = answerGuesses(kyoto.session, kyoto.today!, year(2019));
      expect(movedSentence(kyoto.today!, year(2019))).toBe('Moved to 2019: Museo del Prado and Museo Thyssen-Bornemisza');
      const fushimi = offerForTick(answered, tick(KINKAKUJI, at(21, 13)), null, null);
      expect(says(fushimi.line, at(21, 13))).toBe('When were you here? | 2019, like Museo del Prado | 2026 | 2025 | 2024');
    });

    it('asks once a session: a second signal later asks nothing about today', () => {
      const prado = onTheSofa(FRESH_SESSION, PRADO, at(21, 0), 81);
      const kyoto = offerForTick(prado.session, tick(KINKAKUJI, at(21, 10)), null, null);
      expect(kyoto.today).toHaveLength(1);
      // "Today" for Kinkaku-ji: a trip again; Himeji Castle two hours on, 100 km away, is saved as today on a guess.
      const back = answerOffer(kyoto.session, kyoto.line!, day(2026, 11, 12), KINKAKUJI, at(21, 11)).session;
      const himeji = onTheSofa(back, place('Himeji Castle', 34.8394, 134.6939), at(23, 20), 83);
      expect(himeji.guessed).toBe(true);
      const rome = offerForTick(himeji.session, tick(PANTHEON, at(23, 30)), null, null);
      expect(rome.session.mode).toBe('past');
      expect(rome.today).toBeNull();
    });

    it('does not ask about a today-trip saved more than 2 hours before the signal', () => {
      const prado = onTheSofa(FRESH_SESSION, PRADO, at(18, 0), 81);
      const thyssen = onTheSofa(prado.session, THYSSEN, at(20, 30), 82);
      const kyoto = offerForTick(thyssen.session, tick(KINKAKUJI, at(21, 0)), null, null);
      expect(kyoto.today?.map(g => g.trip)).toEqual([82]);
      expect(guessesSentence(kyoto.today!, at(21, 0))).toBe('Museo Thyssen-Bornemisza was saved as today. When were you there?');
      // None within the 2 hours: the signal asks only the tick's own question, and can still ask later.
      const late = offerForTick(prado.session, tick(KINKAKUJI, at(20, 30)), null, null);
      expect(late).toMatchObject({ today: null, session: { askedAboutToday: false } });
    });

    it('never asks about a date the traveller set: an answer followed nearby, or a trip dated by hand', () => {
      // "Yesterday" on the Prado's line: the Thyssen follows that answer, which is no guess.
      const prado = onTheSofa(FRESH_SESSION, PRADO, at(21, 0), 81);
      const changed = answerOffer(dropGuesses(prado.session, g => g.trip !== 81), prado.line!, day(2026, 11, 11), PRADO, at(21, 1));
      const thyssen = onTheSofa(changed.session, THYSSEN, at(21, 2), 82);
      expect(thyssen).toMatchObject({ save: day(2026, 11, 11), guessed: false });
      expect(offerForTick(thyssen.session, tick(KINKAKUJI, at(21, 10)), null, null).today).toBeNull();

      // The Reina Sofía, guessed, then dated on its card: dropped, so nothing is left to ask about.
      const sofia = onTheSofa(FRESH_SESSION, REINA_SOFIA, at(21, 0), 84);
      const dated = dropGuesses(sofia.session, g => g.trip !== 84);
      expect(offerForTick(dated, tick(KINKAKUJI, at(21, 10)), null, null).today).toBeNull();
    });

    it('names the date of a guess saved before midnight, since that is what its trip holds', () => {
      // The Prado at 23:50 on 12 Nov, the Thyssen at 00:02 and Kinkaku-ji at 00:05 on 13 Nov.
      const prado = onTheSofa(FRESH_SESSION, PRADO, at(23, 50), 81);
      const thyssen = onTheSofa(prado.session, THYSSEN, at(24, 2), 82);
      expect([prado.save, thyssen.save]).toEqual([day(2026, 11, 12), day(2026, 11, 13)]);
      const kyoto = offerForTick(thyssen.session, tick(KINKAKUJI, at(24, 5)), null, null);
      expect(guessesSentence(kyoto.today!, at(24, 5)))
        .toBe(`Museo del Prado was saved as ${NOV_12}, Museo Thyssen-Bornemisza as today. When were you there?`);
      expect(guessesSentence(kyoto.today!.slice(0, 1), at(24, 5))).toBe(`Museo del Prado was saved as ${NOV_12}. When were you there?`);
      expect(guessedToday(kyoto.today!, at(24, 5))).toBe(false);
      expect(guessedToday(kyoto.today!.slice(1), at(24, 5))).toBe(true);
    });

    it('names two places and counts the rest, and says when an answer has no date', () => {
      const guess = (label: string, trip: number): Guess => ({ ...PRADO, label, trip, place: trip, time: at(21, 0), date: day(2026, 11, 12) });
      const three = [guess('Museo del Prado', 81), guess('Museo Thyssen-Bornemisza', 82), guess('Museo Reina Sofía', 84)];
      expect(guessesSentence(three, at(21, 10)))
        .toBe('Museo del Prado, Museo Thyssen-Bornemisza and 1 more place were saved as today. When were you there?');
      expect(movedSentence(three.slice(0, 1), { year: null, month: null, day: null }))
        .toBe('Date not remembered for Museo del Prado');
    });
  });
});

describe('the session across a reload (#2536)', () => {
  afterEach(() => sessionStorage.clear());

  it('keeps the Madrid ticks over a reload, so Kinkaku-ji a minute later reads as past travels', async () => {
    const offer = await import('./dateOffer');
    const prado = offer.offerForTick(FRESH_SESSION, tick(PRADO, at(14, 0)), null, null);
    const reina = offer.offerForTick(prado.session, tick(REINA_SOFIA, at(14, 2)), null, null);
    expect(reina.save).toEqual(day(2026, 11, 12));
    offer.writeSession(reina.session, 7);

    // A reload, or Kyoto opened by its address in the same tab: the module starts again.
    vi.resetModules();
    const reloaded = await import('./dateOffer');
    const kept = reloaded.readSession(7);
    expect(kept.ticks).toHaveLength(2);
    const kinkakuji = reloaded.offerForTick(kept, tick(KINKAKUJI, at(14, 3)), null, null);
    // About 10,700 km in a minute: nothing is saved as today, and the line asks when.
    expect(kinkakuji.save).toBeNull();
    expect(kinkakuji.line?.kind).toBe('ask');
    expect(kinkakuji.session.mode).toBe('past');

    // Another traveller on the same tab starts fresh.
    expect(reloaded.readSession(8).ticks).toEqual([]);
  });

  it('starts fresh from a stored session whose elements are not what the offer wrote', async () => {
    for (const broken of [{ guesses: [null] }, { ticks: [{ lat: 40.41 }] }, { follow: { lat: 40.41, lon: -3.69 } }]) {
      sessionStorage.setItem(OFFER_SESSION_KEY, JSON.stringify({ owner: 7, session: { ...FRESH_SESSION, mode: 'past', ...broken } }));
      vi.resetModules();
      const reloaded = await import('./dateOffer');
      expect(reloaded.readSession(7).mode).toBe('trip');
      expect(() => reloaded.dropHeldGuesses(g => g.trip !== 1)).not.toThrow();
    }
  });

  it("keeps a trip's session whose last answer was \"I don't remember\"", async () => {
    const offer = await import('./dateOffer');
    const pantheon = offer.offerForTick(FRESH_SESSION, tick(PANTHEON, at(14, 2)), null, null);
    const forgotten = offer.answerOffer(pantheon.session, pantheon.line!, { year: null, month: null, day: null }, PANTHEON, at(14, 3));
    offer.writeSession(forgotten.session, 7);

    vi.resetModules();
    const kept = (await import('./dateOffer')).readSession(7);
    expect(kept.ticks).toHaveLength(1);
    expect(kept.follow?.date).toEqual({ year: null, month: null, day: null });
  });

  it('forgets a guess unticked after a reload, so the question never names that place', async () => {
    const offer = await import('./dateOffer');
    const guess = (place: number, spot: typeof PRADO) => ({ ...spot, trip: place * 10, place, label: spot.label, time: at(14, 0), date: day(2026, 11, 12) });
    offer.writeSession(offer.noteGuesses(FRESH_SESSION, [guess(1, PRADO), guess(2, REINA_SOFIA)]), 7);

    vi.resetModules();
    const reloaded = await import('./dateOffer');
    // Museo del Prado unticked before anything else is ticked in the reloaded tab.
    reloaded.dropHeldGuesses(g => g.place !== 1);
    expect(reloaded.readSession(7).guesses.map(g => g.place)).toEqual([2]);

    vi.resetModules();
    expect((await import('./dateOffer')).readSession(7).guesses.map(g => g.place)).toEqual([2]);
  });
});
