import { describe, expect, it } from 'vitest';
import { compareApproximate, daysInMonth, isValidTripDate, precisionOf } from './approximateDates.js';

const date = (year: number | null, month: number | null = null, day: number | null = null) => ({ year, month, day });

describe('a trip\'s approximate date (#2120)', () => {
  it('takes its precision from which parts are set', () => {
    expect(precisionOf(date(2015, 5, 12))).toBe('day');
    expect(precisionOf(date(2022, 3))).toBe('month');
    expect(precisionOf(date(2015))).toBe('year');
    expect(precisionOf(date(null))).toBe('unknown');
  });

  it('holds a month within a year and a day within a month the month has', () => {
    expect(isValidTripDate(date(2015, 5, 31), 2027)).toBe(true);
    expect(isValidTripDate(date(null, 5), 2027)).toBe(false);
    expect(isValidTripDate(date(2015, null, 3), 2027)).toBe(false);
    expect(isValidTripDate(date(2023, 2, 29), 2027)).toBe(false);
    expect(isValidTripDate(date(2024, 2, 29), 2027)).toBe(true);
    expect(isValidTripDate(date(2015, 13), 2027)).toBe(false);
  });

  it('keeps a year between 1900 and the latest year allowed, and lets a date be unknown', () => {
    expect(isValidTripDate(date(1899), 2027)).toBe(false);
    expect(isValidTripDate(date(2028), 2027)).toBe(false);
    expect(isValidTripDate(date(null), 2027)).toBe(true);
  });

  it('compares two dates at the coarser precision, and an unknown date with nothing', () => {
    expect(compareApproximate(date(2015, 5), date(2015))).toBe(0);
    expect(compareApproximate(date(2015), date(2022, 3))).toBe(-1);
    expect(compareApproximate(date(2022, 3, 2), date(2022, 3, 1))).toBe(1);
    expect(compareApproximate(date(null), date(2015))).toBe(0);
  });

  it('counts February in the year\'s own length', () => {
    expect(daysInMonth(1900, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
  });
});
