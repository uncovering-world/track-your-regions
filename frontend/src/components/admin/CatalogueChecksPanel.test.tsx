/**
 * The copy is the feature here, so the copy is what these pin.
 *
 * A catalogue built from four sources over years holds rows nobody is proud of.
 * The panel's whole job is to say which of those an admin is *carrying* — stated,
 * dated, attributed, and left alone — and which is something happening now. Two
 * sentences over the same rows, and the difference decides whether anybody acts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CatalogueChecksPanel } from './CatalogueChecksPanel';
import { acceptDataAssertion, getDataAssertions } from '../../api/admin/dataAssertions';
import type { DataAssertion } from '../../api/admin/dataAssertions';

vi.mock('../../api/admin/dataAssertions', async () => ({
  getDataAssertions: vi.fn(),
  acceptDataAssertion: vi.fn(),
}));

const mockedGet = getDataAssertions as unknown as ReturnType<typeof vi.fn>;
const mockedAccept = acceptDataAssertion as unknown as ReturnType<typeof vi.fn>;

function assertion(overrides: Partial<DataAssertion> = {}): DataAssertion {
  return {
    id: 'held-by-no-region',
    area: 'regions',
    title: 'An object offered to readers that no region holds',
    kind: 'invariant',
    meaning: 'The object cannot be found by browsing.',
    status: 'holding',
    found: 28,
    accepted: 28,
    acceptedAt: '2026-08-24T10:00:00.000Z',
    acceptedBy: 'Nikolay',
    sample: ['Aldabra Atoll (185): in Seychelles, and in no region (experience 300)'],
    error: null,
    needsAttention: false,
    ...overrides,
  };
}

function renderPanel(assertions: DataAssertion[], acceptancesUnavailable: string | null = null) {
  mockedGet.mockResolvedValue({
    assertions,
    needsAttention: assertions.filter(a => a.needsAttention).length,
    acceptancesUnavailable,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CatalogueChecksPanel />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockedGet.mockReset();
  mockedAccept.mockReset();
});

describe('CatalogueChecksPanel', () => {
  it('says debt that stands still is the number accepted, and who accepted it', async () => {
    renderPanel([assertion()]);

    expect(await screen.findByText(/28 rows, the number accepted/)).toBeInTheDocument();
    expect(screen.getByText(/28 accepted by Nikolay/)).toBeInTheDocument();
    // Carried debt is not something to do today, so the page must not lead with it.
    expect(screen.getByText(/Nothing has grown past what was accepted/)).toBeInTheDocument();
  });

  it('leads with a count that grew, which is the case the lane exists for', async () => {
    renderPanel([assertion({ status: 'regressed', found: 31, needsAttention: true })]);

    expect(await screen.findByText(/31 rows, 3 more than the 28 accepted/)).toBeInTheDocument();
    expect(screen.getByText(/1 check needs a person/)).toBeInTheDocument();
    // The meaning is shown where somebody has to act, and only there.
    expect(screen.getByText(/cannot be found by browsing/)).toBeInTheDocument();
  });

  it('says plainly when a rule nobody has answered for finds rows', async () => {
    renderPanel([assertion({ status: 'unanswered', accepted: null, acceptedAt: null, acceptedBy: null, needsAttention: true })]);

    expect(await screen.findByText(/28 rows, none of them accepted/)).toBeInTheDocument();
    expect(screen.getByText(/nobody has answered for this/)).toBeInTheDocument();
  });

  it('offers no accept button on a watch, whose count is not a debt', async () => {
    renderPanel([assertion({
      id: 'visits-on-places-no-reader-is-shown', kind: 'watch', status: 'watch',
      area: 'places', found: 5, accepted: null, acceptedAt: null, acceptedBy: null,
    })]);

    expect(await screen.findByText(/a number to watch/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Accept/ })).not.toBeInTheDocument();
  });

  it('shows a query that did not run as a failure rather than as nothing found', async () => {
    renderPanel([assertion({
      status: 'error', found: 0, sample: [], error: 'relation does not exist', needsAttention: true,
    })]);

    // An assertion answering nothing is not an assertion that passed.
    expect(await screen.findByText(/relation does not exist/)).toBeInTheDocument();
    expect(screen.getByText(/did not run/)).toBeInTheDocument();
  });

  it('says what to apply when the record of accepted numbers is missing', async () => {
    // Every existing database passes through this state once, at the moment
    // somebody opens the screen for the first time. The checks still answer.
    renderPanel([assertion()], 'The record of accepted numbers is missing: apply db/migrations/031.');

    expect(await screen.findByText(/apply db\/migrations\/031/)).toBeInTheDocument();
    expect(screen.getByText(/An object offered to readers that no region holds/)).toBeInTheDocument();
  });

  it('opens a check that has just gone from carried to grown', async () => {
    // The card keeps its identity across reads, so the rows of the one check
    // somebody needs must not stay folded away behind its earlier state. The
    // toggle's own label is the assertion, since MUI keeps a collapsed child
    // mounted and a text query would find the rows either way.
    renderPanel([assertion()]);
    expect(await screen.findByRole('button', { name: /Show rows/ })).toBeInTheDocument();

    mockedGet.mockResolvedValue({
      assertions: [assertion({ status: 'regressed', found: 31, needsAttention: true })],
      needsAttention: 1,
      acceptancesUnavailable: null,
    });
    fireEvent.click(screen.getByRole('button', { name: /Read again/ }));

    expect(await screen.findByText(/31 rows, 3 more than the 28 accepted/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Hide rows/ })).toBeInTheDocument();
  });

  it('drops the "could not be read" notice once a row has been written', async () => {
    // The two failures co-occur: whatever failed the report's ledger read is
    // what fails the accept's read-back, and that path answers with the row it
    // wrote. Carrying the notice forward would put "could not be read" directly
    // above a card saying "28 accepted".
    mockedAccept.mockResolvedValue(assertion({ status: 'holding', found: 28 }));
    renderPanel(
      [assertion({ status: 'unanswered', accepted: null, acceptedAt: null, acceptedBy: null, needsAttention: true })],
      'The record of accepted numbers could not be read.',
    );
    fireEvent.click(await screen.findByRole('button', { name: /Accept 28 as carried/ }));

    await waitFor(() => expect(screen.queryByText(/could not be read/)).not.toBeInTheDocument());
  });

  it('accepts one assertion by name, sending no number of its own', async () => {
    mockedAccept.mockResolvedValue(assertion({ status: 'holding', found: 28 }));
    renderPanel([assertion({ status: 'unanswered', accepted: null, acceptedAt: null, acceptedBy: null, needsAttention: true })]);

    fireEvent.click(await screen.findByRole('button', { name: /Accept 28 as carried/ }));

    // The id alone: the number is measured by the server as it records it, so a
    // screen minutes out of date cannot write a figure the catalogue never held.
    // The first argument rather than the whole call, because React Query hands a
    // mutation its own context as a second one.
    await waitFor(() => expect(mockedAccept.mock.calls[0]?.[0]).toBe('held-by-no-region'));
  });
});
