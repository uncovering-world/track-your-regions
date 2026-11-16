import { describe, expect, it } from 'vitest';
import { compareApproximate } from './approximateDates.js';
import {
  comparePlaceDates, isValidPlaceDate, julianToGregorian, latestDayOnEarth, outerDaysOf, periodOf, periodsFault, samePlaceDate, standsBy,
  type PlaceDate, type PlacePeriod,
} from './lifetime.js';

const date = (year: number, rest: Partial<Omit<PlaceDate, 'year'>> = {}): PlaceDate =>
  ({ year, month: null, day: null, span: null, circa: false, ...rest });

describe('a date of a place\'s lifetime (#1719)', () => {
  it('holds a BC year to the millennium, about, as Göbekli Tepe begins', () => {
    expect(isValidPlaceDate(date(-9999, { span: 'millennium', circa: true }), 2026)).toBe(true);
    expect(isValidPlaceDate(date(-35000, { span: 'millennium' }), 2026)).toBe(true);
  });

  it('refuses year zero, a year past the latest and one before the earliest', () => {
    expect(isValidPlaceDate(date(0), 2026)).toBe(false);
    expect(isValidPlaceDate(date(2027), 2026)).toBe(false);
    expect(isValidPlaceDate(date(-100_001), 2026)).toBe(false);
    expect(isValidPlaceDate(date(1.5), 2026)).toBe(false);
  });

  it('holds a month only within a year and a day only within a month the month has', () => {
    expect(isValidPlaceDate(date(1931, { month: 12, day: 5 }), 2026)).toBe(true);
    expect(isValidPlaceDate(date(2024, { month: 1 }), 2026)).toBe(true);
    expect(isValidPlaceDate(date(1931, { day: 5 }), 2026)).toBe(false);
    expect(isValidPlaceDate(date(1931, { month: 13 }), 2026)).toBe(false);
    expect(isValidPlaceDate(date(1931, { month: 4, day: 31 }), 2026)).toBe(false);
  });

  it('counts a BC leap year one later than an AD one, as 1 BC and 5 BC are', () => {
    expect(isValidPlaceDate(date(-1, { month: 2, day: 29 }), 2026)).toBe(true);
    expect(isValidPlaceDate(date(-5, { month: 2, day: 29 }), 2026)).toBe(true);
    expect(isValidPlaceDate(date(-4, { month: 2, day: 29 }), 2026)).toBe(false);
    expect(isValidPlaceDate(date(1900, { month: 2, day: 29 }), 2026)).toBe(false);
    expect(isValidPlaceDate(date(2000, { month: 2, day: 29 }), 2026)).toBe(true);
  });

  it('holds a span only on a year with no month', () => {
    expect(isValidPlaceDate(date(-3000, { span: 'century', circa: true }), 2026)).toBe(true);
    expect(isValidPlaceDate(date(1880, { span: 'decade', month: 3 }), 2026)).toBe(false);
  });

  it('compares two dates field by field', () => {
    expect(samePlaceDate(date(1883), date(1883))).toBe(true);
    expect(samePlaceDate(date(1883), date(1883, { circa: true }))).toBe(false);
    expect(samePlaceDate(date(-3000, { span: 'century' }), date(-3000))).toBe(false);
    expect(samePlaceDate(null, null)).toBe(true);
    expect(samePlaceDate(date(1883), null)).toBe(false);
  });
});

describe('a day of the Julian calendar, as the Gregorian day it is (#1719)', () => {
  it('turns 29 February 1500, which the Gregorian calendar lacks, into 10 March 1500, a day the rule holds', () => {
    const gregorian = julianToGregorian(1500, 2, 29);
    expect(gregorian).toEqual({ year: 1500, month: 3, day: 10 });
    if (gregorian === null) return;
    expect(isValidPlaceDate(date(gregorian.year, { month: gregorian.month, day: gregorian.day }), 2026)).toBe(true);
    expect(isValidPlaceDate(date(1500, { month: 2, day: 29 }), 2026)).toBe(false);
  });

  it('meets the days the two calendars are known to meet on', () => {
    // The Gregorian reform: 4 October 1582 Julian was followed by 15 October.
    expect(julianToGregorian(1582, 10, 5)).toEqual({ year: 1582, month: 10, day: 15 });
    // Russia's change: 31 January 1918 Julian was followed by 14 February.
    expect(julianToGregorian(1918, 2, 1)).toEqual({ year: 1918, month: 2, day: 14 });
    // Julian day 0, 1 January 4713 BC, is 24 November 4714 BC.
    expect(julianToGregorian(-4713, 1, 1)).toEqual({ year: -4714, month: 11, day: 24 });
  });

  it('crosses the turn of the era with no year zero, either way', () => {
    expect(julianToGregorian(1, 1, 1)).toEqual({ year: -1, month: 12, day: 30 });
    expect(julianToGregorian(-44, 3, 15)).toEqual({ year: -44, month: 3, day: 13 });
  });

  it('answers null for a day the Julian calendar does not have, as the rule refuses a Gregorian one', () => {
    expect(julianToGregorian(1500, 2, 30)).toBeNull();
    expect(julianToGregorian(1501, 2, 29)).toBeNull();
    expect(julianToGregorian(1500, 4, 31)).toBeNull();
    expect(julianToGregorian(1500, 13, 1)).toBeNull();
    expect(julianToGregorian(1500, 0, 1)).toBeNull();
    expect(julianToGregorian(0, 1, 1)).toBeNull();
    // 1300 leaps in the Julian calendar, not in the Gregorian; 1 BC leaps in both.
    expect(julianToGregorian(1300, 2, 29)).toEqual({ year: 1300, month: 3, day: 8 });
    expect(julianToGregorian(-1, 2, 29)).toEqual({ year: -1, month: 2, day: 27 });
  });
});

describe('the one order of dates (#1719, #2008)', () => {
  it('orders two dates only where the periods they may be do not overlap', () => {
    // 1859 and 6 September 1859; the 1950s and 1955; the 1600s century and 1550.
    expect(comparePlaceDates(date(1859), date(1859, { month: 9, day: 6 }))).toBe(0);
    expect(comparePlaceDates(date(1950, { span: 'decade' }), date(1955))).toBe(0);
    expect(comparePlaceDates(date(1600, { span: 'century' }), date(1550))).toBe(0);
    expect(comparePlaceDates(date(1808), date(1809, { month: 10, day: 21 }))).toBe(-1);
    expect(comparePlaceDates(date(-7000, { span: 'millennium' }), date(-9999, { span: 'millennium' }))).toBe(1);
  });

  it('agrees in sign with a trip\'s order on every dated trip, the only ones a place\'s date is compared with', () => {
    const trips = [
      { year: 2015, month: null, day: null }, { year: 2015, month: 5, day: null }, { year: 2015, month: 5, day: 12 },
      { year: 2022, month: 3, day: null }, { year: 2022, month: 3, day: 1 }, { year: 2022, month: 3, day: 2 },
      { year: 1999, month: 12, day: 31 },
    ];
    for (const a of trips) {
      for (const b of trips) {
        const asPlace = (t: typeof a): PlaceDate => ({ ...t, span: null, circa: false });
        expect(Math.sign(compareApproximate(a, b))).toBe(comparePlaceDates(asPlace(a), asPlace(b)));
      }
    }
  });
});

describe('a period of a place (#2578, ADR-0217)', () => {
  const TODAY = { year: 2026, month: 11, day: 16 };
  const open = (from: PlaceDate | null): PlacePeriod => ({ from, ended: false, until: null });
  const ended = (from: PlaceDate | null, until: PlaceDate | null): PlacePeriod => ({ from, ended: true, until });
  // The Cathedral of Christ the Saviour in Moscow: 1883 to 5 December 1931, and since 2000.
  const CATHEDRAL = [ended(date(1883), date(1931, { month: 12, day: 5 })), open(date(2000))];
  // Nelson's Pillar in Dublin: 1809 to 8 March 1966.
  const PILLAR = [ended(date(1809), date(1966, { month: 3, day: 8 }))];

  it('stands with no standing period or an open one, and not with only ended ones', () => {
    expect(standsBy([])).toBe(true);
    expect(standsBy(CATHEDRAL)).toBe(true);
    expect(standsBy(PILLAR)).toBe(false);
    expect(standsBy([ended(null, null)])).toBe(false);
  });

  it('keeps the first day its start may be and the last day its end may be', () => {
    const [first, second] = CATHEDRAL.map(outerDaysOf);
    expect(first.fromFirst).toBe(periodOf(date(1883, { month: 1, day: 1 })).first);
    expect(first.untilLast).toBe(periodOf(date(1931, { month: 12, day: 5 })).last);
    expect(second).toEqual({ fromFirst: periodOf(date(2000, { month: 1, day: 1 })).first, untilLast: null });
    // A trip of 1980 falls between the two periods' outer days.
    const trip = periodOf(date(1980));
    expect(first.untilLast !== null && second.fromFirst !== null
      && first.untilLast < trip.first && trip.last < second.fromFirst).toBe(true);
    // A century covers every year within a century either side of its year.
    expect(outerDaysOf(ended(date(1250, { span: 'century' }), null))).toEqual({
      fromFirst: periodOf(date(1151, { month: 1, day: 1 })).first, untilLast: null,
    });
  });

  it('holds a gap, an end with no date and a start that is not known', () => {
    expect(periodsFault('stood', CATHEDRAL, TODAY)).toBeNull();
    expect(periodsFault('stood', PILLAR, TODAY)).toBeNull();
    expect(periodsFault('stood', [ended(null, null)], TODAY)).toBeNull();
    // Ponte Santa Trinita in Florence: two gaps.
    expect(periodsFault('stood', [ended(date(1252), date(1557)), ended(date(1569), date(1944)), open(date(1958))], TODAY)).toBeNull();
    // Destroyed and rebuilt within one year, both stated to the year: either may come first.
    expect(periodsFault('stood', [ended(date(1900), date(2010)), open(date(2010))], TODAY)).toBeNull();
  });

  it('refuses standing periods that overlap, are out of order or go on after an open one', () => {
    expect(periodsFault('stood', [ended(date(1883), date(1931)), open(date(1920))], TODAY)).toBe('two periods overlap');
    expect(periodsFault('stood', [open(date(1883)), open(date(2000))], TODAY)).toBe('a period that has not ended is followed by another');
    expect(periodsFault('stood', [open(date(2000)), ended(date(1883), date(1931))], TODAY)).toBe('the periods are not in time order');
  });

  it('reads today as the latest day it is anywhere on Earth', () => {
    expect(latestDayOnEarth(new Date('2026-11-16T09:00:00Z'))).toEqual({ year: 2026, month: 11, day: 16 });
    expect(latestDayOnEarth(new Date('2026-12-31T10:00:00Z'))).toEqual({ year: 2027, month: 1, day: 1 });
  });

  it('lets uses overlap, where standing periods may not', () => {
    expect(periodsFault('used', [open(date(537)), ended(date(1453), date(1931))], TODAY)).toBeNull();
  });

  it('refuses dates stated the wrong way round even where the span of one may hold the other (#2578)', () => {
    // The Church of St. Jaume in Alcúdia: an inception to the century of 1900, a destruction on 18 February 1870.
    const century = date(1900, { span: 'century' });
    const destroyed = date(1870, { month: 2, day: 18 });
    expect(periodsFault('stood', [ended(century, destroyed), open(date(1893))], TODAY)).toBe('it ends before it starts');
    expect(periodsFault('stood', [ended(null, date(1955)), open(date(1950, { span: 'decade' }))], TODAY)).toBe('two periods overlap');
    expect(periodsFault('used', [ended(date(1900, { span: 'century' }), null), open(date(1870))], TODAY)).toBe('the periods are not in time order');
    // The same year, however precisely either is stated, is neither way round.
    expect(periodsFault('stood', [ended(date(2019), date(2019, { month: 6, day: 14 }))], TODAY)).toBeNull();
    expect(periodsFault('stood', [ended(date(1800, { span: 'century' }), destroyed), open(date(1893))], TODAY)).toBeNull();
  });

  it('refuses a period that ends before it starts, an end date on an open period and a date no calendar has', () => {
    expect(periodsFault('stood', [ended(date(2000), date(1931))], TODAY)).toBe('it ends before it starts');
    expect(periodsFault('stood', [{ from: date(1883), ended: false, until: date(1931) }], TODAY)).toBe('it has an end date and has not ended');
    expect(periodsFault('stood', [open(date(1931, { month: 4, day: 31 }))], TODAY)).toBe('its start is not a date');
    expect(periodsFault('used', [ended(null, date(0))], TODAY)).toBe('its end is not a date');
  });

  it('refuses a standing period or a use in the future, and lets a closure and an occurrence lie ahead', () => {
    expect(periodsFault('stood', [ended(date(1809), date(2026, { month: 12, day: 25 }))], TODAY)).toBe('it lies in the future');
    expect(periodsFault('stood', [ended(date(1809), date(2026))], TODAY)).toBeNull();
    expect(periodsFault('used', [open(date(2027))], TODAY)).toBe('its start is not a date');
    // The Pergamon Museum: closed from October 2023 until 2027.
    expect(periodsFault('closed', [ended(date(2023, { month: 10 }), date(2027))], TODAY)).toBeNull();
    // Holy Week in Seville, 2027.
    expect(periodsFault('held', [ended(date(2027, { month: 3, day: 21 }), date(2027, { month: 3, day: 28 }))], TODAY)).toBeNull();
    expect(periodsFault('closed', [ended(date(2023), date(20227))], TODAY)).toBe('its end is not a date');
  });
});
