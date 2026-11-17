import { describe, expect, it } from 'vitest';
import { filedPeriods, isPeriodsField, periodLines, yearsBetween } from './placePeriodsLabel';

const on = (year: number, rest: Record<string, unknown> = {}) => ({ year, month: null, day: null, span: null, circa: false, ...rest });
const period = (from: unknown, until: unknown, ended: boolean, rest: Record<string, unknown> = {}) =>
  ({ from, until, ended, ending: null, what: null, ...rest });
const lines = (says: 'stood' | 'used' | 'closed' | 'held', value: unknown) => periodLines(says, filedPeriods(value) ?? []);

/** A place's periods in words (#2578). */
describe('periodLines', () => {
  it('reads the Cathedral of Christ the Saviour\'s two standing periods, and Ponte Santa Trinita\'s three', () => {
    expect(lines('stood', [period(on(1883), on(1931), true, { ending: 'destroyed' }), period(on(2000), null, false)]))
      .toEqual(['Built 1883, destroyed 1931', 'Rebuilt 2000, stands today']);
    expect(lines('stood', [period(on(1252), on(1557), true), period(on(1569), on(1944), true), period(on(1958), null, false)]))
      .toEqual(['Built 1252, stood until 1557', 'Rebuilt 1569, stood until 1944', 'Rebuilt 1958, stands today']);
  });

  it('reads a place gone at a date not known, and one whose beginning is not known', () => {
    expect(lines('stood', [period(null, null, true)])).toEqual(['No longer stands, date unknown']);
    expect(lines('stood', [period(null, on(1966), true, { ending: 'demolished' })])).toEqual(['Demolished 1966']);
    expect(lines('stood', [period(null, null, false)])).toEqual(['Stands today']);
  });

  it('reads a use, a named use, a closure and an occurrence', () => {
    expect(lines('used', [period(null, on(1539), true)])).toEqual(['In use until 1539']);
    expect(lines('used', [period(on(537), on(1453), true, { what: 'A church' }), period(on(2020), null, false, { what: 'A mosque' })]))
      .toEqual(['A church from AD 537 until 1453', 'A mosque since 2020']);
    expect(lines('closed', [period(on(2023), on(2027), true)])).toEqual(['Closed from 2023 until 2027']);
    expect(lines('held', [period(on(2027), null, true), period(null, null, true), period(null, null, false)]))
      .toEqual(['Held from 2027, end date unknown', 'Held once, dates unknown', 'Held']);
  });

  it('reads no list from a value that is none, and an empty one from nothing', () => {
    expect(filedPeriods(null)).toEqual([]);
    for (const value of ['1883', {}, [1883], [{ from: on(1883) }], [period({ year: '1883' }, null, false)]]) {
      expect(filedPeriods(value)).toBeNull();
    }
    expect(['stood', 'used', 'closed', 'held', 'name'].filter(isPeriodsField)).toEqual(['stood', 'used', 'closed', 'held']);
  });

  it('counts the years of a gap with no year zero', () => {
    expect(yearsBetween(on(267), on(1953))).toBe(1686);
    expect(yearsBetween(on(-10), on(10))).toBe(19);
  });
});
