/**
 * How often the OpenStreetMap layer updates itself, as the admin sees and
 * changes it (ADR-0134 decision 6): every 1 to 30 days, or never by itself.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DumpScheduleLine } from './DumpScheduleLine';
import { setDumpSchedule, type DumpsDumpsItem } from '../../api/admin/dumps';

vi.mock('../../api/admin/dumps', () => ({
  setDumpSchedule: vi.fn(async (_dump: string, everyDays: number | null) => ({ everyDays, chosen: true, defaultEveryDays: 7 })),
}));

const planet = (schedule: NonNullable<DumpsDumpsItem['keeps']>['schedule']): DumpsDumpsItem => ({
  key: 'osm-planet', source: 'OpenStreetMap', title: 'Planet', datedBy: 'day', about: '',
  progress: null, builds: [], localCopy: null, sample: null,
  keeps: {
    title: 'The OpenStreetMap layer', built: { dumpDate: '2026-10-22', swappedAt: '2026-10-22T14:00:00Z' }, needs: 'nothing',
    newestDumpDate: '2026-10-19', newestChecked: 'answered', rederives: false, samples: false, fromCopy: true, schedule, currentTo: true, archives: [],
  },
});

function show(item: DumpsDumpsItem) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><DumpScheduleLine dump={item} /></QueryClientProvider>);
}

beforeEach(() => vi.clearAllMocks());

describe('the schedule line', () => {
  it('shows the default interval as the default', () => {
    show(planet({ everyDays: 7, chosen: false, defaultEveryDays: 7 }));
    expect(screen.getByText(/Updates itself/)).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'How often the worker updates it by itself' }).textContent).toBe('every 7 days (default)');
  });

  it('says when the admin turned the schedule off', () => {
    show(planet({ everyDays: null, chosen: true, defaultEveryDays: 7 }));
    expect(screen.getByRole('combobox').textContent).toBe('never (started by hand)');
  });

  it('saves the interval the admin picks, and off as null', async () => {
    show(planet({ everyDays: 7, chosen: false, defaultEveryDays: 7 }));
    fireEvent.mouseDown(screen.getByRole('combobox'));
    fireEvent.click(within(screen.getByRole('listbox')).getByText('every day'));
    await waitFor(() => expect(setDumpSchedule).toHaveBeenCalledWith('osm-planet', 1));
    fireEvent.mouseDown(screen.getByRole('combobox'));
    fireEvent.click(within(screen.getByRole('listbox')).getByText('never (started by hand)'));
    await waitFor(() => expect(setDumpSchedule).toHaveBeenCalledWith('osm-planet', null));
  });

  it('shows nothing for a dump whose keeper keeps no schedule', () => {
    const { container } = show(planet(null));
    expect(container.textContent).toBe('');
  });
});
