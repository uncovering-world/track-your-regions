/**
 * The arrival's third answer (#2213): the kind it belongs in instead. What is
 * pinned is the form — the kinds the place may go into, a type from the chosen
 * kind's vocabulary, whether it stays — and what one press sends and says.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../api/curation', () => ({ answerArrivalWithKind: vi.fn(), fetchPlaceKinds: vi.fn() }));

import { answerArrivalWithKind, fetchPlaceKinds } from '../../api/curation';
import { ArrivalKindChoice } from './ArrivalKindChoice';
import { arrivalKindOutcome } from './ArrivalKindForm';

const mockedAnswer = vi.mocked(answerArrivalWithKind);
const mockedKinds = vi.mocked(fetchPlaceKinds);

/** The Monument to Peter I before St Michael's Castle, arrived in Public art (2026-10-31). */
const MONUMENT = 9791;

let client: QueryClient;

function renderChoice(onDone = vi.fn()) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ArrivalKindChoice experienceId={MONUMENT} name="Monument to Peter I" membershipId={501}
        arrivingKind="Public art" disabled={false} onDone={onDone} />
    </QueryClientProvider>,
  );
  return onDone;
}

/** The kind picker opens once the place's kinds are read. */
async function kindsRead() {
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Kind' })).not.toHaveAttribute('aria-disabled', 'true'));
}

async function choose(label: string, option: string) {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: label }));
  fireEvent.click(within(await screen.findByRole('listbox')).getByRole('option', { name: option }));
}

beforeEach(() => {
  mockedAnswer.mockReset();
  mockedKinds.mockReset().mockResolvedValue({
    kinds: [], addable: [{ kindId: 6, kindName: 'Monuments & memorials' }, { kindId: 7, kindName: 'Towers' }],
  } as never);
});

describe('an arrival answered with another kind', () => {
  it('moves the place to the chosen kind with its type, out of the one that brought it, in one press', async () => {
    mockedAnswer.mockResolvedValue({
      experienceId: MONUMENT, membershipId: 900, kindId: 6, kind: 'Monuments & memorials',
      arrivalMembershipId: 501, fromKind: 'Public art', stays: false, arrivalPublished: false, arrivalWaits: null,
    });
    const onDone = renderChoice();
    fireEvent.click(screen.getByRole('button', { name: 'Belongs in another kind…' }));
    await kindsRead();
    await choose('Kind', 'Monuments & memorials');
    // The kind's vocabulary: no move until a type is chosen.
    expect(screen.getByRole('button', { name: 'Move to Monuments & memorials' })).toBeDisabled();
    await choose('Type', 'Monument');
    expect(screen.getByText(/kept out of Public art, and that kind's runs do not bring it back/)).toBeInTheDocument();

    const invalidate = vi.spyOn(client, 'invalidateQueries');
    fireEvent.click(screen.getByRole('button', { name: 'Move to Monuments & memorials' }));
    await waitFor(() => expect(mockedAnswer).toHaveBeenCalledWith(MONUMENT, {
      kindId: 6, type: 'monument', stays: false, membershipId: 501,
    }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(
      'Monument to Peter I: added to Monuments & memorials as monument and kept out of Public art',
    ));
    // The place's kinds were read before the answer; the edit dialog reads them too.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['curation', 'placeKinds', MONUMENT] });
  });

  it('keeps the place in its own kind as well where the curator says so', async () => {
    mockedAnswer.mockResolvedValue({
      experienceId: MONUMENT, membershipId: 900, kindId: 6, kind: 'Monuments & memorials',
      arrivalMembershipId: 501, fromKind: 'Public art', stays: true, arrivalPublished: true, arrivalWaits: null,
    });
    renderChoice();
    fireEvent.click(screen.getByRole('button', { name: 'Belongs in another kind…' }));
    await kindsRead();
    await choose('Kind', 'Monuments & memorials');
    await choose('Type', 'Monument');
    fireEvent.click(screen.getByRole('checkbox', { name: 'It belongs in Public art too' }));
    expect(screen.getByText(/published in Public art as well/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add to Monuments & memorials' }));
    await waitFor(() => expect(mockedAnswer).toHaveBeenCalledWith(MONUMENT, expect.objectContaining({ stays: true })));
  });
});

describe("the answer's outcome line", () => {
  const base = {
    experienceId: MONUMENT, membershipId: 900, kindId: 6, kind: 'Monuments & memorials',
    arrivalMembershipId: 501, fromKind: 'Public art',
  };

  it('says where the place went and what became of its arrival', () => {
    expect(arrivalKindOutcome('Monument', 6, 'monument', { ...base, stays: true, arrivalPublished: true, arrivalWaits: null }))
      .toBe('Monument: added to Monuments & memorials as monument, and published in Public art too');
    expect(arrivalKindOutcome('Monument', 6, null, { ...base, stays: true, arrivalPublished: false, arrivalWaits: 'Run 412 moved it' }))
      .toBe('Monument: added to Monuments & memorials; its arrival in Public art still waits — Run 412 moved it');
  });
});
