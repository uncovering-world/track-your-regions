import { describe, expect, it } from 'vitest';
import { rowsFor } from './factRows';
import { fieldLabel } from './fieldMeaning';

const NO_CONTEXT = { proposed: [] };

const date = (year: number | null, rest: Record<string, unknown> = {}) => ({
  year, month: null, day: null, span: null, circa: false, ending: null, property: 'P571', statement: null, ...rest,
});

/** A held date of a place on the review card (#1719), on the Cathedral of Christ the Saviour's. */
describe('a held date of a place', () => {
  it('reads as its date on both sides, and asks whether a century apart is a rebuild', () => {
    const [row] = rowsFor([{ field: 'began', old: date(1883), new: date(2000, { month: 8, day: 19 }) }], NO_CONTEXT);
    expect(row.kind).toBe('changed');
    expect(row.meaning.label).toBe('began');
    expect(row.meaning.render?.(row.before, row.context)).toBe('1883');
    expect(row.meaning.render?.(row.after, row.context)).toMatch(/2000$/);
    expect(row.sentence).toBe('A century or more apart. Check whether the place was rebuilt.');
    expect(row.event).toBe(false);
  });

  it('says what publishing an end does, and how the place ended', () => {
    const [row] = rowsFor([{ field: 'ended', old: null, new: date(2024, { month: 1, ending: 'destroyed' }) }], NO_CONTEXT);
    expect(row.kind).toBe('new');
    expect(row.event).toBe(true);
    expect(row.meaning.unseen).toBeUndefined();
    expect(row.meaning.render?.(row.after, row.context)).toMatch(/^destroyed \S+ 2024$/);
    expect(row.sentence).toBe(
      'Publishing takes the place off today’s lists and the map. It stays for past trips and among the gone places.',
    );
  });

  it('says an end with no date as one', () => {
    const [row] = rowsFor([{ field: 'ended', old: null, new: date(null, { ending: 'demolished' }) }], NO_CONTEXT);
    expect(row.meaning.render?.(row.after, row.context)).toBe('demolished, date unknown');
  });

  it('puts a place back when its end is taken off', () => {
    const [row] = rowsFor([{ field: 'ended', old: date(1931, { ending: 'demolished' }), new: null }], NO_CONTEXT);
    expect(row.kind).toBe('removed');
    expect(row.sentence).toBe('Publishing puts the place back on today’s lists.');
  });

  it('names each date in a person\'s words', () => {
    expect(['began', 'rebuilt', 'use_ended', 'ended'].map(fieldLabel))
      .toEqual(['began', 'rebuilt', 'in use until', 'no longer stands']);
  });
});
