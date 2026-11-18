import { describe, expect, it } from 'vitest';
import { closedStanding, reopenedStanding, standingTakenBack, type SourcedDate, type SourcedPeriod } from './placePeriodsWriter.js';

/**
 * A curator's *lost*, and taking it back, as standing periods (ADR-0217
 * decision 5, #2584): the Kakhovka Dam, standing since 1956 until a curator
 * judges it lost; the Cathedral of Christ the Saviour in Moscow, which stood
 * from 1883 until 1931 and stands again since 2000; and the Jeddah Tower,
 * whose opening is still ahead.
 */

const TODAY = { year: 2026, month: 11, day: 18 };
const on = (year: number): SourcedDate => ({ year, month: null, day: null, span: null, circa: false, property: 'P571', statement: null });
const open = (from: SourcedDate | null): SourcedPeriod => ({ from, ended: false, until: null, ending: null, what: null });
const ended = (from: SourcedDate | null, until: SourcedDate | null): SourcedPeriod =>
  ({ from, ended: true, until, ending: until ? 'demolished' : null, what: null });
const UNDATED_END = ended(null, null);

describe('closedStanding', () => {
  it('ends the open period at a date not known, keeping its start', () => {
    expect(closedStanding([open(on(1956))], TODAY)).toEqual([ended(on(1956), null)]);
  });

  it('ends only the open period of a place that stood twice', () => {
    const cathedral = [ended(on(1883), on(1931)), open(on(2000))];
    expect(closedStanding(cathedral, TODAY)).toEqual([ended(on(1883), on(1931)), ended(on(2000), null)]);
  });

  it('gives a place with no period one that ended, its dates not known', () => {
    expect(closedStanding([], TODAY)).toEqual([UNDATED_END]);
  });

  it('drops a period that begins on a day still ahead, since none both begins ahead and has ended', () => {
    expect(closedStanding([open(on(2028))], TODAY)).toEqual([UNDATED_END]);
  });

  it('restates a list that already ended', () => {
    const pillar = [ended(on(1809), on(1966))];
    expect(closedStanding(pillar, TODAY)).toEqual(pillar);
  });
});

describe('reopenedStanding', () => {
  it('opens the last period again, keeping its start', () => {
    expect(reopenedStanding([ended(on(1956), null)])).toEqual([open(on(1956))]);
    expect(reopenedStanding([ended(on(1883), on(1931)), ended(on(2000), null)]))
      .toEqual([ended(on(1883), on(1931)), open(on(2000))]);
  });

  it('drops a list that only said the place ended, as an admission pin reads it on every run', () => {
    expect(reopenedStanding([UNDATED_END])).toEqual([]);
  });

  it('leaves a list with an open period as it is', () => {
    const cathedral = [ended(on(1883), on(1931)), open(on(2000))];
    expect(reopenedStanding(cathedral)).toBe(cathedral);
    expect(reopenedStanding([])).toEqual([]);
  });
});

describe('standingTakenBack', () => {
  it('opens the last period again, as reopenedStanding does', () => {
    expect(standingTakenBack([ended(on(1956), null)])).toEqual([open(on(1956))]);
  });

  it('keeps an open period of the curator\'s where only an undated end was held, so a run cannot undo it', () => {
    expect(standingTakenBack([UNDATED_END])).toEqual([open(null)]);
    expect(standingTakenBack([])).toEqual([open(null)]);
  });
});
