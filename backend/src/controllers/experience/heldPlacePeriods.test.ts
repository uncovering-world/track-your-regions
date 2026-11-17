import { describe, expect, it } from 'vitest';
import { isPeriodsField, proposedPeriods } from './heldPlacePeriods.js';

/**
 * #2578: the list a held row proposes, read off its changeset before a publish
 * writes it. Bethlehem Chapel in Prague stood from 1391 until 1786 and stands
 * again since 1952; Göbekli Tepe was in use until about 7000 BC.
 */

const on = (year: number, rest: Record<string, unknown> = {}) => ({
  year, month: null, day: null, span: null, circa: false, property: 'P571', statement: null, ...rest,
});
const open = (from: unknown) => ({ from, ended: false, until: null, ending: null, what: null });
const until = (from: unknown, end: unknown, ending: string | null = null) => ({ from, ended: true, until: end, ending, what: null });

describe('the list a held row of a place\'s periods proposes', () => {
  it('names the lists a run reports, and no other field', () => {
    expect(['stood', 'used', 'closed', 'held', 'name'].filter(isPeriodsField)).toEqual(['stood', 'used']);
  });

  it('reads a list as its changeset filed it, and a held removal as an empty one', () => {
    const chapel = [until(on(1391), on(1786, { property: 'P576' })), open(on(1952, { property: 'P793', statement: 'Q9$a' }))];
    expect(proposedPeriods('stood', chapel)).toEqual(chapel);
    expect(proposedPeriods('stood', [until(on(1809), null, 'destroyed')])).toEqual([until(on(1809), null, 'destroyed')]);
    expect(proposedPeriods('used', [until(null, on(-7000, { span: 'millennium', circa: true }))])).toHaveLength(1);
    expect(proposedPeriods('used', null)).toEqual([]);
  });

  it('refuses what is no list a place can hold', () => {
    const refused: unknown[] = [
      'gone', {}, [null], [{ ...open(on(1391)), ended: 'no' }],
      // Not a date: a year that is none, a thirteenth month, a span the schema does not know.
      [open({ ...on(1391), year: '1391' })], [open(on(1391, { month: 13 }))], [open(on(1391, { span: 'era' }))],
      // The shared rule: an open period followed by another, and a period in the future.
      [open(on(1391)), open(on(1952))], [open(on(2999))],
      // An ending the vocabulary lacks, one on a period still open, and a run's period with a name.
      [until(on(1391), on(1786), 'sold')], [{ ...open(on(1391)), ending: 'destroyed' }], [{ ...open(on(1391)), what: 'a chapel' }],
    ];
    for (const value of refused) expect(proposedPeriods('stood', value), JSON.stringify(value)).toBeUndefined();
    // How a place stopped standing is said of its standing only.
    expect(proposedPeriods('used', [until(null, on(1539), 'destroyed')])).toBeUndefined();
  });
});
