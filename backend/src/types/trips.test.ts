import { describe, expect, it } from 'vitest';
import {
  RESTORE_LIMITS, TRIP_NAMED_TWICE, changeTripsBodySchema, restoreVisitsBodySchema, tripDateBodySchema,
} from './trips.js';

describe("a trip's date as a request carries it (#2120)", () => {
  it('takes a day, a month, a year or nothing at all', () => {
    for (const date of [
      { year: 2022, month: 3, day: 12 }, { year: 2022, month: 3, day: null },
      { year: 2015, month: null, day: null }, { year: null, month: null, day: null },
    ]) expect(tripDateBodySchema.safeParse(date).success).toBe(true);
  });

  it('refuses a month with no year, a day the month does not have and a year before 1900', () => {
    for (const date of [
      { year: null, month: 5, day: null }, { year: 2023, month: 2, day: 29 }, { year: 1899, month: null, day: null },
    ]) expect(tripDateBodySchema.safeParse(date).success).toBe(false);
  });

  it('gives an Undo back what an untick removed, each visit a place id', () => {
    expect(restoreVisitsBodySchema.safeParse({ visits: [] }).success).toBe(false);
    expect(restoreVisitsBodySchema.safeParse({ visits: [{
      experienceId: 9461, markedAt: null, notes: null, rating: null, trips: [{ year: 2015, month: null, day: null }],
    }] }).success).toBe(true);
  });

  it('refuses an Undo over its limits, in words a person reads', () => {
    const trip = { year: 2015, month: null, day: null };
    const visit = (trips: number) => ({
      experienceId: 9461, markedAt: null, notes: null, rating: null, trips: Array.from({ length: trips }, () => trip),
    });
    const parse = (visits: ReturnType<typeof visit>[]) => restoreVisitsBodySchema.safeParse({ visits });

    expect(parse(Array.from({ length: RESTORE_LIMITS.visits }, () => visit(10))).success).toBe(true);
    // One visit takes up to all of it: a merge can leave a visit with more trips than adding allows.
    expect(parse([visit(RESTORE_LIMITS.trips)]).success).toBe(true);
    for (const visits of [
      Array.from({ length: RESTORE_LIMITS.visits + 1 }, () => visit(0)),
      [visit(RESTORE_LIMITS.trips + 1)],
      [visit(RESTORE_LIMITS.trips), visit(1)],
    ]) {
      const parsed = parse(visits);
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues.map(issue => issue.message)).toContain(
        'An Undo puts back at most 1,000 visits and 10,000 trips at once',
      );
    }
  });

  it('refuses a change of dates naming one trip twice, whose two dates one statement could not tell apart', () => {
    const date = (year: number) => ({ year, month: null, day: null });
    expect(changeTripsBodySchema.safeParse({ trips: [{ id: 7, date: date(2015) }, { id: 8, date: date(2015) }] }).success)
      .toBe(true);
    const twice = changeTripsBodySchema.safeParse({ trips: [{ id: 7, date: date(2015) }, { id: 7, date: date(2016) }] });
    expect(twice.success).toBe(false);
    expect(twice.error?.issues.map(issue => issue.message)).toEqual([TRIP_NAMED_TWICE]);
  });
});
