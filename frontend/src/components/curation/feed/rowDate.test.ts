/**
 * Tests for the day a row was asked, said in a curator's own time zone and words.
 *
 * `dayOf`'s first test builds its ISO string from a local `Date` and checks it against that
 * same `Date`'s own local fields, so the assertion holds whatever time zone the test runs
 * in — but it cannot, on its own, *catch* a UTC-based regression (`iso.slice(0, 10)`, say):
 * at UTC offset 0 (CI's own zone) `expected` and a UTC slice agree by construction, and even
 * off UTC the two only disagree when the chosen instant actually crosses a day boundary
 * between the two readings. The second test closes that gap by faking the offset with
 * `vi.spyOn` on `Date.prototype`'s local getters, so it disagrees with a UTC-based `dayOf`
 * on every host regardless of the suite's own time zone.
 */

import {
  describe, it, expect, vi,
} from 'vitest';
import {
  dayOf, dayLabel, dateShort, runStamp,
} from './rowDate';

describe('dayOf', () => {
  it('reads the instant\'s local calendar day, not UTC\'s', () => {
    const local = new Date(2026, 8, 7, 23, 30); // 7 Sep, 23:30 in this machine's own zone
    const expected = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}`
      + `-${String(local.getDate()).padStart(2, '0')}`;

    expect(dayOf(local.toISOString())).toBe(expected);
  });

  it('disagrees with a UTC-based reading in every zone, including the suite\'s own', () => {
    // A host's real time zone is not under this test's control — CI's own is UTC, where a
    // UTC-based `dayOf` and a correct one read the same instant identically, so no real
    // instant run on a UTC host could ever fail a UTC-based bug. Faking the offset instead
    // of relying on the host's own makes the test see a boundary crossing regardless of
    // where it runs: `Date.prototype`'s *local* getters are stubbed to answer as a fixed
    // UTC-5 zone would (New York's standard time, no DST) — behind UTC, so a UTC-based
    // `dayOf` and this stub disagree on any instant within five hours of local midnight.
    // The stub reads through `getUTC*` on a shifted copy, never the mocked getters
    // themselves, so it does not recurse into itself.
    const UTC_MINUS_5_MS = 5 * 60 * 60_000;
    const shifted = (date: Date) => new Date(date.getTime() - UTC_MINUS_5_MS);
    const getFullYear = vi.spyOn(Date.prototype, 'getFullYear')
      .mockImplementation(function fakeGetFullYear(this: Date) { return shifted(this).getUTCFullYear(); });
    const getMonth = vi.spyOn(Date.prototype, 'getMonth')
      .mockImplementation(function fakeGetMonth(this: Date) { return shifted(this).getUTCMonth(); });
    const getDate = vi.spyOn(Date.prototype, 'getDate')
      .mockImplementation(function fakeGetDate(this: Date) { return shifted(this).getUTCDate(); });

    try {
      // 2026-09-07T01:00Z is 2026-09-06T20:00 in the faked UTC-5 zone — a day earlier. A
      // UTC-based `dayOf` reads the instant's own UTC date and answers '2026-09-07'.
      const iso = new Date(Date.UTC(2026, 8, 7, 1, 0)).toISOString();
      expect(dayOf(iso)).toBe('2026-09-06');
    } finally {
      getFullYear.mockRestore();
      getMonth.mockRestore();
      getDate.mockRestore();
    }
  });
});

describe('dayLabel', () => {
  const today = '2026-09-07'; // a Monday

  it('names today\'s own day "Today"', () => {
    expect(dayLabel('2026-09-07', today)).toBe('Today');
  });

  it('names the day before "Yesterday"', () => {
    expect(dayLabel('2026-09-06', today)).toBe('Yesterday');
  });

  it('names an older day by weekday, day and month', () => {
    expect(dayLabel('2026-09-05', today)).toBe('Sat 5 Sep');
  });

  it('crosses a month boundary the same way', () => {
    expect(dayLabel('2026-08-31', today)).toBe('Mon 31 Aug');
  });
});

describe('dateShort', () => {
  const today = '2026-09-07';

  it('says "today" for a timestamp on the given day', () => {
    const iso = new Date(2026, 8, 7, 9, 0).toISOString();
    expect(dateShort(iso, today)).toBe('today');
  });

  it('says the day and month for any other day', () => {
    const iso = new Date(2026, 8, 5, 9, 0).toISOString();
    expect(dateShort(iso, today)).toBe('5 Sep');
  });

  it('returns "" for a null timestamp', () => {
    expect(dateShort(null, today)).toBe('');
  });
});

describe('runStamp', () => {
  it('says the day, the month and the time of day, in the reader\'s own zone', () => {
    // Built from local fields, so the expectation holds wherever the suite runs.
    const iso = new Date(2026, 8, 5, 14, 32).toISOString();
    expect(runStamp(iso)).toBe('5 Sep 14:32');
  });

  it('pads a single-digit hour and minute', () => {
    const iso = new Date(2026, 8, 4, 9, 5).toISOString();
    expect(runStamp(iso)).toBe('4 Sep 09:05');
  });

  it('says a run that has not finished is still in progress', () => {
    expect(runStamp(null)).toBe('in progress');
  });
});
