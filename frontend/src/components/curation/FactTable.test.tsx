/**
 * Tests for what a curator is asked to decide, laid out as a table of facts.
 *
 * The thing worth pinning is what the card *says* and where: the fact's name anchors the
 * row and carries its definition; the kind of change is on the row and counted above the
 * rows; a value looks the way readers see it; the sentence under a value is one line
 * about this change; an answer applies to a field, never to a key inside one; and a part
 * of the object is a group of its own with a way to open it (#570).
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { FactTable, ProposalSummary } from './FactTable';
import { rowsFor, type FactGroup } from './factRows';
import type { ChangeContext, ProposedField } from './fieldMeaning';

/** Bamiyan's held card from run 68: the flag repaired after filing, two facts arriving. */
const BAMIYAN = [
  { field: 'metadata.inDanger', old: false, new: true },
  {
    field: 'metadata',
    old: { website: 'https://whc.unesco.org/en/list/208' },
    new: {
      website: 'https://whc.unesco.org/en/list/208',
      criteria: '(i)(ii)(iii)(iv)',
      imageCredit: { author: 'Graciela Gonzalez Brigas', license: '© UNESCO', detailsUrl: 'https://whc.unesco.org/en/list/208' },
    },
  },
];
const BAMIYAN_CONTEXT: ChangeContext = { proposed: BAMIYAN, inDanger: true, dangerSince: 2003 };
const HELD_LABELS = { before: 'readers see', after: 'the run proposes' };

function objectGroup(proposed: ProposedField[], context: ChangeContext): FactGroup[] {
  return [{ subject: { kind: 'object', label: 'Bamiyan Valley' }, rows: rowsFor(proposed, context) }];
}

describe('FactTable', () => {
  it('lays a proposal out as one row per fact, with both values in their own columns', () => {
    render(<FactTable groups={objectGroup(BAMIYAN, BAMIYAN_CONTEXT)} labels={HELD_LABELS} context={BAMIYAN_CONTEXT} />);

    expect(screen.getByRole('columnheader', { name: 'readers see' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'the run proposes' })).toBeInTheDocument();
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    expect(rows.map(r => within(r).getAllByRole('cell')[0].textContent)).toEqual([
      'in dangerchanged', 'inscription criterianew', 'picture creditnew',
    ]);
  });

  it('keeps the definition on the term, reachable by keyboard', () => {
    render(<FactTable groups={objectGroup(BAMIYAN, BAMIYAN_CONTEXT)} labels={HELD_LABELS} context={BAMIYAN_CONTEXT} />);
    const term = screen.getByLabelText('in danger — what this fact is');
    expect(term).toHaveAttribute('tabindex', '0');
    expect(screen.queryByRole('button', { name: /what .* is/ })).not.toBeInTheDocument();
  });

  it('shows a value the way readers see it, with a dash for nothing', () => {
    render(<FactTable groups={objectGroup(BAMIYAN, BAMIYAN_CONTEXT)} labels={HELD_LABELS} context={BAMIYAN_CONTEXT} />);
    const [danger, criteria] = screen.getAllByRole('row').slice(1);
    // The badge is the badge, with its year; before it there was no badge.
    expect(within(danger).getByText('In Danger since 2003')).toBeInTheDocument();
    expect(within(danger).getByText('no badge')).toBeInTheDocument();
    // A fact arriving has a dash where readers see nothing, and chips for the criteria.
    expect(within(criteria).getByText('—')).toBeInTheDocument();
    expect(within(criteria).getByText('(iv)')).toBeInTheDocument();
    expect(screen.queryByText(/false/)).not.toBeInTheDocument();
  });

  it('puts one sentence about this change under the proposed value, arrowed for an event', () => {
    render(<FactTable groups={objectGroup(BAMIYAN, BAMIYAN_CONTEXT)} labels={HELD_LABELS} context={BAMIYAN_CONTEXT} />);
    const [danger, , credit] = screen.getAllByRole('row').slice(1);
    expect(within(danger).getByText(/Readers already see this badge/)).toHaveTextContent(/^→/);
    expect(within(credit).getByText('Readers see the picture uncredited today.')).toBeInTheDocument();
  });

  it('compares text a person wrote word by word, across the two columns', () => {
    const proposed = [{ field: 'shortDescription', old: 'The ruins of Aksum', new: 'The ruins of Axum' }];
    render(<FactTable groups={objectGroup(proposed, { proposed })} labels={HELD_LABELS} context={{ proposed }} />);
    const [row] = screen.getAllByRole('row').slice(1);
    const cells = within(row).getAllByRole('cell');
    expect(cells[1]).toHaveTextContent('The ruins of Aksum');
    expect(cells[2]).toHaveTextContent('The ruins of Axum');
    expect(within(cells[1]).getByText('Aksum').tagName).toBe('MARK');
  });

  it('answers a field once, in its own column, spanning every row the field made', () => {
    const answer = vi.fn((field: string) => <button type="button">answer {field}</button>);
    render(<FactTable groups={objectGroup(BAMIYAN, BAMIYAN_CONTEXT)} labels={{ before: 'yours', after: 'the source proposes' }} context={BAMIYAN_CONTEXT} answer={answer} />);

    expect(screen.getByRole('columnheader', { name: 'Your answer' })).toBeInTheDocument();
    // Two fields on the card — `metadata.inDanger` and `metadata` — so two answers, the
    // second spanning the criteria and the credit, which are keys inside one field.
    expect(screen.getAllByRole('button', { name: /^answer/ }).map(b => b.textContent)).toEqual([
      'answer metadata.inDanger', 'answer metadata',
    ]);
    const [, criteria] = screen.getAllByRole('row').slice(1);
    expect(within(criteria).getByRole('button', { name: 'answer metadata' }).closest('td')).toHaveAttribute('rowspan', '2');
  });

  it('heads a part of the object with its name and a way to open it', () => {
    // A place of a serial site renamed, as a run records it one level down (ADR-0026):
    // Château de Montésgur, whose name the source corrected.
    const onOpen = vi.fn();
    const proposed = [{ field: 'name', old: 'Château de Montésgur', new: 'Château de Montségur' }];
    const groups: FactGroup[] = [
      { subject: { kind: 'object', label: 'Royal Capetian Fortresses of Languedoc' }, rows: [] },
      { subject: { kind: 'place', label: 'Château de Montségur', detail: 'place 4 of 8', onOpen }, rows: rowsFor(proposed, { proposed }) },
    ];
    render(<FactTable groups={groups} labels={HELD_LABELS} context={{ proposed }} />);

    expect(screen.getByText('a place of this object')).toBeInTheDocument();
    expect(screen.getByText('Château de Montségur')).toBeInTheDocument();
    expect(screen.getByText('place 4 of 8')).toBeInTheDocument();
    screen.getByRole('button', { name: 'open' }).click();
    expect(onOpen).toHaveBeenCalled();
    // The object's own group has no heading: the card is its heading.
    expect(screen.queryByText('Royal Capetian Fortresses of Languedoc')).not.toBeInTheDocument();
  });
});

describe('ProposalSummary', () => {
  it('counts what the run proposes by kind and names it, before the rows', () => {
    render(<ProposalSummary lead="Run 68 proposes" rows={rowsFor(BAMIYAN, BAMIYAN_CONTEXT)} />);
    expect(screen.getByText('1 changed')).toBeInTheDocument();
    expect(screen.getByText('in danger')).toBeInTheDocument();
    expect(screen.getByText('2 new')).toBeInTheDocument();
    expect(screen.getByText('inscription criteria, picture credit')).toBeInTheDocument();
    expect(screen.queryByText(/nothing readers see changes/)).not.toBeInTheDocument();
  });

  it('says nothing readers see changes only when every arriving fact is one no reader surface shows', () => {
    // The criteria and the UNESCO region: stored, shown nowhere.
    const unseen = [{ field: 'metadata', old: {}, new: { criteria: '(ii)(iv)', region: 'Europe and North America' } }];
    render(<ProposalSummary lead="Run 68 proposes" rows={rowsFor(unseen, { proposed: unseen })} />);
    expect(screen.getByText('2 new')).toBeInTheDocument();
    expect(screen.getByText('· nothing readers see changes')).toBeInTheDocument();
  });

  it('does not say it when a fact readers see arrives — a credit, a picture', () => {
    // Bamiyan's own card: the criteria are unseen, but the credit goes under the picture
    // readers open. Keying the line on "everything is new" would have said it here.
    const proposed = [BAMIYAN[1]];
    render(<ProposalSummary lead="Run 68 proposes" rows={rowsFor(proposed, { proposed })} />);
    expect(screen.getByText('2 new')).toBeInTheDocument();
    expect(screen.queryByText(/nothing readers see changes/)).not.toBeInTheDocument();

    const picture = [{ field: 'imageUrl', old: null, new: 'https://whc.unesco.org/uploads/sites/site_208.jpg' }];
    render(<ProposalSummary lead="Run 68 proposes" rows={rowsFor(picture, { proposed: picture })} />);
    expect(screen.queryByText(/nothing readers see changes/)).not.toBeInTheDocument();
  });
});
