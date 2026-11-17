import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CurationActTable, type ActEntry } from './CurationActTable';

/**
 * Three of a curator's acts on dev, 10 and 16 November, dated in this year so
 * the days read without one, and built from local time so the day they fall on
 * is the same in every zone the table is read in.
 */
const YEAR = new Date().getFullYear();
const at = (day: number, hour: number, minute: number) => new Date(YEAR, 10, day, hour, minute).toISOString();
const LENA: ActEntry = {
  id: 3, action: 'arrival_refused', kind_name: 'Bridges & engineering marvels', created_at: at(16, 10, 15), who: 'Ada',
  details: { reason: 'kept out by a curator', membershipId: 155469, note: null },
  place: { id: 50622, name: 'Lena Bridge', imageUrl: null, credit: null },
};
const RYBINSK: ActEntry = {
  id: 2, action: 'admission_overridden', kind_name: 'Places of worship', created_at: at(10, 18, 8), who: 'Ada',
  details: { reason: 'no place-of-worship class', pinned: true, membershipId: 152296, note: null },
  place: { id: 49442, name: 'Roman Catholic church in Rybinsk, Russia', imageUrl: null, credit: null },
};
const NEUE_WACHE: ActEntry = {
  id: 1, action: 'edited', kind_name: null, created_at: at(10, 14, 53), who: 'Ada',
  details: { 'metadata.commemorates': { old: null, new: { via: 'curator', subjects: [{ item: 'Q814235', label: 'German campaign of 1813' }] } } },
  place: { id: 1532, name: 'Neue Wache', imageUrl: null, credit: null },
};

function renderTable(entries: ActEntry[], variant: 'trail' | 'history' = 'trail') {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CurationActTable entries={entries} variant={variant} />
    </QueryClientProvider>,
  );
}

const rowOf = (text: string) => screen.getByText(text).closest('tr')!;

describe("a curator's trail as an audit table (#956)", () => {
  it('reads each act as its fact before and after, under the day it happened', () => {
    renderTable([LENA, RYBINSK, NEUE_WACHE]);
    const days = screen.getAllByRole('row').map((row) => row.textContent);
    // The day in the reader's locale, whatever it is: "16 November", "November 16", "16. November".
    const label = (iso: string | null) => new Date(iso!).toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
    expect(days).toEqual(expect.arrayContaining([label(LENA.created_at), label(NEUE_WACHE.created_at)]));
    const edit = rowOf('Neue Wache');
    expect(within(edit).getByText('German campaign of 1813')).toBeInTheDocument();
    expect(within(edit).getByText('—')).toBeInTheDocument();
    expect(within(rowOf('Lena Bridge')).getByText('In, by the rule')).toBeInTheDocument();
  });

  it('marks the calls against the rule, and no other', () => {
    renderTable([LENA, RYBINSK, NEUE_WACHE]);
    expect(within(rowOf('Lena Bridge')).getByText('against the rule')).toBeInTheDocument();
    expect(within(rowOf('Roman Catholic church in Rybinsk, Russia')).getByText('against the rule')).toBeInTheDocument();
    expect(within(rowOf('Neue Wache')).queryByText('against the rule')).toBeNull();
  });

  it("opens why the rule decided under the row, and shows no raw record anywhere", () => {
    renderTable([RYBINSK]);
    fireEvent.click(within(rowOf('Roman Catholic church in Rybinsk, Russia')).getByRole('button', { name: 'Why' }));
    expect(screen.getAllByRole('row').at(-1)!.textContent).not.toBe('');
    expect(document.body.textContent).not.toContain('membershipId');
    expect(document.body.textContent).not.toContain('{');
  });

  it("names the year of a day that is not this year's, and keeps two years' same day apart", () => {
    const lastYear = new Date().getFullYear() - 1;
    renderTable([
      { ...NEUE_WACHE, id: 9, created_at: new Date(lastYear, 10, 10, 14, 53).toISOString() },
      { ...NEUE_WACHE, id: 8, created_at: new Date(lastYear - 1, 10, 10, 14, 53).toISOString() },
    ]);
    const days = screen.getAllByRole('row').map((row) => row.textContent ?? '').filter((t) => t.includes(String(lastYear - 1)) || t.includes(String(lastYear)));
    expect(days).toHaveLength(2);
    expect(days[0]).toContain(String(lastYear));
  });

  it('opens the whole record of an act under its row with More', () => {
    renderTable([{ ...NEUE_WACHE, id: 7, action: 'kind_added', kind_name: 'Monuments & memorials',
      details: { kind: 'Monuments & memorials', kindId: 6, type: 'monument', fromArrival: { kind: 'Public art', stays: false } } }]);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByText(/from its arrival in Public art/i)).toBeInTheDocument();
  });

  it('names who acted in a History, with no place column', () => {
    renderTable([NEUE_WACHE], 'history');
    expect(screen.getByRole('columnheader', { name: 'Who' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Place' })).toBeNull();
    expect(screen.getByText('Ada')).toBeInTheDocument();
  });
});
