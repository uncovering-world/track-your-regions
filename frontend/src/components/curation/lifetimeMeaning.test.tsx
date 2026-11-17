import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { FactTable, ProposalSummary } from './FactTable';
import { rowsFor } from './factRows';
import type { ProposedField } from './fieldMeaning';
import { CHANGE_COLUMNS, changeAnswersLine } from './selection/answerWords';

/**
 * The held card for a place's periods (#2578), on the three places the slice
 * was designed from: Bethlehem Chapel in Prague, the Odeon of Herodes Atticus
 * in Athens and a place readers see whose source now says it is gone
 * (Nelson's Pillar in Dublin). Each list is the one a run files.
 */

const on = (year: number, rest: Record<string, unknown> = {}) => ({
  year, month: null, day: null, span: null, circa: false, property: 'P571', statement: null, ...rest,
});
const open = (from: unknown) => ({ from, ended: false, until: null, ending: null, what: null });
const until = (from: unknown, end: unknown, ending: string | null = null) => ({ from, ended: true, until: end, ending, what: null });

const CHAPEL: ProposedField = {
  field: 'stood', old: [open(on(1391))], new: [until(on(1391), on(1786)), open(on(1952))],
};
const ODEON: ProposedField = {
  field: 'stood', old: [open(on(161))], new: [until(on(161), on(267), 'destroyed'), open(on(1953))],
};
const PILLAR: ProposedField = {
  field: 'stood', old: [open(on(1809))], new: [until(on(1809), on(1966, { month: 3, day: 8 }), 'destroyed')],
};

/** The card's table as a curator reads it: one line a row, the cells set apart. */
function cardText(proposed: ProposedField[]): string[] {
  const rows = rowsFor(proposed, { proposed });
  const { container } = render(
    <>
      <ProposalSummary lead="The run of 16 Nov proposes" rows={rows} />
      <FactTable groups={[{ subject: { kind: 'object', label: '' }, rows }]} labels={CHANGE_COLUMNS} />
    </>,
  );
  const summary = container.firstElementChild?.textContent ?? '';
  // A cell's blocks, the value and the sentence under it, set apart by a bar.
  const cells = [...container.querySelectorAll('tbody td')].map(cell => [...cell.children].map(block => block.textContent).join(' | '));
  return [summary, ...cells];
}

const day = new Date(2000, 2, 8).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

describe('the held card for a place\'s periods', () => {
  it('shows Bethlehem Chapel\'s gap beside what the place holds, and says what taking it means', () => {
    const [summary, fact, current, proposed] = cardText([CHAPEL]);
    expect(summary).toBe('The run of 16 Nov proposes1 changedwhen it stood');
    expect(fact).toBe('when it stood | changed');
    expect(current).toBe('Built 1391, stands today');
    expect(proposed).toBe('Built 1391, stood until 1786\nRebuilt 1952, stands today'
      + ' | →Taking the proposed list says the place was not there from 1786 to 1952, 166 years. '
      + 'Keep the current one if something stood here to visit, a ruin included.');
  });

  it('shows the Odeon\'s destruction and rebuilding, whose ruin a curator keeps by keeping the current list', () => {
    const [, , current, proposed] = cardText([ODEON]);
    expect(current).toBe('Built AD 161, stands today');
    expect(proposed).toBe('Built AD 161, destroyed AD 267\nRebuilt 1953, stands today'
      + ` | →Taking the proposed list says the place was not there from AD 267 to 1953, ${(1686).toLocaleString()} years. `
      + 'Keep the current one if something stood here to visit, a ruin included.');
  });

  it('says plainly what taking the end of a place readers see does', () => {
    const [summary, , current, proposed] = cardText([PILLAR]);
    expect(summary).not.toContain('nothing readers see changes');
    expect(current).toBe('Built 1809, stands today');
    expect(proposed).toBe(`Built 1809, destroyed ${day} 1966`
      + ' | →Taking the proposed list says the place is gone. '
      + 'It leaves today’s lists and stays among what is no longer there, and for past trips.');
  });

  it('never says of a first standing list that nothing readers see changes, and says so of a use', () => {
    const gone: ProposedField = { field: 'stood', old: null, new: PILLAR.new };
    expect(cardText([gone])[0]).toBe('The run of 16 Nov proposes1 newwhen it stood');
    const used: ProposedField = { field: 'used', old: null, new: [until(null, on(-7000, { span: 'millennium' }))] };
    const [summary, , current, proposed] = cardText([used]);
    expect(summary).toContain('nothing readers see changes');
    expect(current).toBe('no dates');
    expect(proposed).toBe(`In use until c. ${(7000).toLocaleString('en-GB')} BC`);
  });

  it('reads a place said to stand again, a date not known, and a value that is no list', () => {
    const again: ProposedField = { field: 'stood', old: [until(null, null, 'demolished')], new: [until(null, null, 'demolished'), open(null)] };
    const [, , current, proposed] = cardText([again]);
    expect(current).toBe('Demolished, date unknown');
    expect(proposed).toBe('Demolished, date unknown\nRebuilt, date unknown, stands today'
      + ' | →Taking the proposed list says the place stands again, and puts it back on today’s lists.');
    expect(cardText([{ field: 'stood', old: null, new: 'gone' }])[3]).toBe('"gone"');
  });

  it('says under the answers what each does, and that keeping the current list settles the question', () => {
    expect(changeAnswersLine(['stood'])).toBe('Use proposed changes when the place stood or was in use, now. '
      + 'Keep current changes nothing readers see and settles the question — the source has to propose something different to ask again.');
  });
});
