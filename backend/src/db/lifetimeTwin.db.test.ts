import { afterAll, describe, expect, it } from 'vitest';
import { latestDayOnEarth, periodOf, type PlaceDate } from '@tyr/shared/lifetime';
import { pool } from './index.js';

/**
 * The day arithmetic's two statements held to each other (#1719, ADR-0217):
 * `periodOf` in `@tyr/shared/lifetime`, by which the writers write a period's
 * outer days and a trip's, and its SQL twins `date_first()`, `date_last()`
 * and `current_day_index()`, by which `period_ok()` checks them and the
 * standing derivation reads today. A date the two count differently would be
 * refused by the schema as the writer writes it.
 */

const on = (year: number, rest: Partial<Omit<PlaceDate, 'year'>> = {}): PlaceDate =>
  ({ year, month: null, day: null, span: null, circa: false, ...rest });

/** The dates the catalogue holds, each at the precision its source gives. */
const DATES: Array<[string, PlaceDate]> = [
  ['Nelson\'s Pillar blown up, 8 March 1966', on(1966, { month: 3, day: 8 })],
  ['the Cathedral of Christ the Saviour consecrated, 1883', on(1883)],
  ['the cathedral blown up, December 1931', on(1931, { month: 12 })],
  ['Frick Madison closed, 3 March 2024', on(2024, { month: 3, day: 3 })],
  ['a leap day, 29 February 2000', on(2000, { month: 2, day: 29 })],
  ['Göbekli Tepe begun, c. 9500 BC to the millennium', on(-9500, { span: 'millennium', circa: true })],
  ['the Pons Sublicius, the 7th century BC', on(-700, { span: 'century' })],
  ['a museum founded in the 1880s', on(1880, { span: 'decade' })],
  ['the year 1 BC', on(-1)],
  ['the year AD 1', on(1)],
  ['the Odeon of Herodes Atticus destroyed, 267', on(267)],
];

afterAll(async () => {
  await pool.end();
});

describe('date_first() and date_last() are periodOf (#1719)', () => {
  it.each(DATES)('%s', async (_name, date) => {
    const { rows: [row] } = await pool.query<{ first: number; last: number }>(
      'SELECT date_first($1, $2, $3, $4) AS first, date_last($1, $2, $3, $4) AS last',
      [date.year, date.month, date.day, date.span],
    );
    expect(row).toEqual(periodOf(date));
  });

  it('gives no day for a date that is not known', async () => {
    const { rows: [row] } = await pool.query(
      'SELECT date_first(NULL, NULL, NULL, NULL) AS first, date_last(NULL, NULL, NULL, NULL) AS last',
    );
    expect(row).toEqual({ first: null, last: null });
  });
});

describe('current_day_index() is the latest day on Earth (#1719)', () => {
  it('counts the day it is at UTC+14 at the server\'s clock', async () => {
    const { rows: [row] } = await pool.query<{ today: number; at: Date }>('SELECT current_day_index() AS today, now() AS at');
    const day = latestDayOnEarth(row.at);
    expect(row.today).toBe(periodOf(on(day.year, { month: day.month, day: day.day })).first);
  });
});
