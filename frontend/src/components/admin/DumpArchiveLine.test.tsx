/**
 * The earlier years readership keeps beside the current one, and asking for
 * another by the month it ends on (#2230).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DumpArchiveLine } from './DumpArchiveLine';
import { startDumpKeep, type DumpsDumpsItem } from '../../api/admin/dumps';

vi.mock('../../api/admin/dumps', () => ({
  startDumpKeep: vi.fn(async () => ({ started: true, progress: {} })),
}));

const dump = (over: Partial<DumpsDumpsItem> & { archives?: string[] } = {}): DumpsDumpsItem => ({
  key: 'pageviews-user', source: 'Wikimedia pageviews', title: 'Readers per article, by month', datedBy: 'month', about: '',
  progress: null, builds: [], localCopy: null, sample: null,
  keeps: {
    title: 'Readership over the last twelve months', built: { dumpDate: '2026-09-01', swappedAt: '2026-10-20T14:00:00Z' }, needs: 'nothing',
    newestDumpDate: '2026-09-01', newestChecked: 'answered', rederives: false, samples: false, fromCopy: false, schedule: null, currentTo: false,
    archives: over.archives ?? [],
  },
  ...over,
});

function show(item: DumpsDumpsItem) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><DumpArchiveLine dump={item} /></QueryClientProvider>);
}

beforeEach(() => vi.clearAllMocks());

describe('the earlier years line', () => {
  it('lists the earlier years kept, each by its last month', () => {
    show(dump({ archives: ['2024-09', '2025-09'] }));
    expect(screen.getByText(/Earlier years kept beside it, each by its last month: Sept 2024, Sept 2025/)).toBeTruthy();
  });

  it('says when none is kept, and offers the build only once a month is named', async () => {
    show(dump());
    expect(screen.getByText(/No earlier year kept beside it/)).toBeTruthy();
    const button = screen.getByRole('button', { name: /Build the year ending/ });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText('The month the year ends on'), { target: { value: '2025-09' } });
    expect(screen.getByRole('button', { name: 'Build the year ending Sept 2025' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Build the year ending Sept 2025' }));
    await waitFor(() => expect(startDumpKeep).toHaveBeenCalledWith('pageviews-user', 'newest', '2025-09'));
  });

  it('shows nothing for a dump dated by day, whatever it keeps', () => {
    const { container } = show(dump({ key: 'wikidata-entities', datedBy: 'day' }));
    expect(container.textContent).toBe('');
  });
});
