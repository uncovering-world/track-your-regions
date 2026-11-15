import { describe, expect, it } from 'vitest';
import { isValidPlaceDate, julianToGregorian, samePlaceDate, type PlaceDate } from './lifetime.js';

const date = (year: number | null, rest: Partial<Omit<PlaceDate, 'year'>> = {}): PlaceDate =>
  ({ year, month: null, day: null, span: null, circa: false, ...rest });

describe('a date of a place\'s lifetime (#1719)', () => {
  it('holds a BC year to the millennium, about, as Göbekli Tepe begins', () => {
    expect(isValidPlaceDate(date(-9999, { span: 'millennium', circa: true }), 'began', 2026)).toBe(true);
    expect(isValidPlaceDate(date(-35000, { span: 'millennium' }), 'began', 2026)).toBe(true);
  });

  it('refuses year zero, a year past the latest and one before the earliest', () => {
    expect(isValidPlaceDate(date(0), 'began', 2026)).toBe(false);
    expect(isValidPlaceDate(date(2027), 'began', 2026)).toBe(false);
    expect(isValidPlaceDate(date(-100_001), 'began', 2026)).toBe(false);
    expect(isValidPlaceDate(date(1.5), 'began', 2026)).toBe(false);
  });

  it('holds a month only within a year and a day only within a month the month has', () => {
    expect(isValidPlaceDate(date(1931, { month: 12, day: 5 }), 'use_ended', 2026)).toBe(true);
    expect(isValidPlaceDate(date(2024, { month: 1 }), 'ended', 2026)).toBe(true);
    expect(isValidPlaceDate(date(1931, { day: 5 }), 'use_ended', 2026)).toBe(false);
    expect(isValidPlaceDate(date(1931, { month: 13 }), 'use_ended', 2026)).toBe(false);
    expect(isValidPlaceDate(date(1931, { month: 4, day: 31 }), 'use_ended', 2026)).toBe(false);
  });

  it('counts a BC leap year one later than an AD one, as 1 BC and 5 BC are', () => {
    expect(isValidPlaceDate(date(-1, { month: 2, day: 29 }), 'began', 2026)).toBe(true);
    expect(isValidPlaceDate(date(-5, { month: 2, day: 29 }), 'began', 2026)).toBe(true);
    expect(isValidPlaceDate(date(-4, { month: 2, day: 29 }), 'began', 2026)).toBe(false);
    expect(isValidPlaceDate(date(1900, { month: 2, day: 29 }), 'began', 2026)).toBe(false);
    expect(isValidPlaceDate(date(2000, { month: 2, day: 29 }), 'began', 2026)).toBe(true);
  });

  it('holds a span only on a year with no month', () => {
    expect(isValidPlaceDate(date(-3000, { span: 'century', circa: true }), 'began', 2026)).toBe(true);
    expect(isValidPlaceDate(date(1880, { span: 'decade', month: 3 }), 'began', 2026)).toBe(false);
  });

  it('lets only the place\'s end hold no year, and then nothing else', () => {
    expect(isValidPlaceDate(date(null), 'ended', 2026)).toBe(true);
    expect(isValidPlaceDate(date(null), 'began', 2026)).toBe(false);
    expect(isValidPlaceDate(date(null), 'use_ended', 2026)).toBe(false);
    expect(isValidPlaceDate(date(null, { circa: true }), 'ended', 2026)).toBe(false);
    expect(isValidPlaceDate(date(null, { span: 'century' }), 'ended', 2026)).toBe(false);
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
    expect(isValidPlaceDate(date(gregorian.year, { month: gregorian.month, day: gregorian.day }), 'began', 2026)).toBe(true);
    expect(isValidPlaceDate(date(1500, { month: 2, day: 29 }), 'began', 2026)).toBe(false);
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
