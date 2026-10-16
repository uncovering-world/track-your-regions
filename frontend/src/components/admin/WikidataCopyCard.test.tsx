/**
 * The admin's card for the Wikidata copy (#1583): a notice only when something
 * needs doing, naming the one action, and nothing about how the copy is made.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WikidataCopyCard } from './WikidataCopyCard';
import { cancelDumpBuild, startDumpKeep, startDumpRederive, type DumpsDumpsItem } from '../../api/admin/dumps';

vi.mock('../../api/admin/dumps', () => ({
  startDumpKeep: vi.fn(async () => ({})),
  startDumpRederive: vi.fn(async () => ({})),
  cancelDumpBuild: vi.fn(async () => ({ cancelled: true })),
}));

type Keeps = NonNullable<DumpsDumpsItem['keeps']>;

const dump = (keeps: Partial<Keeps>, progress: DumpsDumpsItem['progress'] = null): DumpsDumpsItem => ({
  key: 'wikidata-entities', source: 'Wikidata', title: 'All entities', datedBy: 'day', about: '',
  progress, builds: [], localCopy: null, sample: null,
  keeps: {
    title: "The catalogue's copy of Wikidata",
    built: { dumpDate: '2026-10-05', swappedAt: '2026-10-15T15:31:30Z' },
    needs: 'nothing',
    newestDumpDate: '2026-10-05',
    newestChecked: 'answered',
    ...keeps,
  },
});

function show(item: DumpsDumpsItem) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><WikidataCopyCard dump={item} /></QueryClientProvider>);
}

beforeEach(() => vi.clearAllMocks());

describe('the Wikidata copy card', () => {
  it('says the copy is up to date, and offers nothing to press', () => {
    show(dump({}));
    expect(screen.getByText('Up to date')).toBeTruthy();
    expect(screen.getByText(/Built from the dump of 5 Oct 2026/)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('claims nothing about a newer dump before the host was asked, or when it did not answer', () => {
    const { unmount } = show(dump({ newestChecked: 'not-yet', newestDumpDate: null }));
    expect(screen.getByText(/Checking whether a newer dump is out/)).toBeTruthy();
    expect(screen.queryByText('Up to date')).toBeNull();
    unmount();
    show(dump({ newestChecked: 'unreachable' }));
    expect(screen.getByText(/did not answer, so a newer dump may be out/)).toBeTruthy();
  });

  it('offers an update from a newer dump, saying what it costs', async () => {
    show(dump({ needs: 'newer-dump', newestDumpDate: '2026-10-19' }));
    expect(screen.getByText(/A newer dump is out, of 19 Oct 2026/)).toBeTruthy();
    expect(screen.getByText(/several hours/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Update' }));
    await waitFor(() => expect(startDumpKeep).toHaveBeenCalledWith('wikidata-entities', 'newest'));
  });

  it('offers a recompute after an update of the app changed how the tables are made', async () => {
    show(dump({ needs: 'recompute' }));
    expect(screen.getByText(/a few minutes/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Recompute' }));
    await waitFor(() => expect(startDumpRederive).toHaveBeenCalledWith('wikidata-entities'));
  });

  it('asks for a first build where there is no copy', async () => {
    show(dump({ needs: 'rebuild', built: null }));
    expect(screen.getByText(/There is no copy yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Build' }));
    await waitFor(() => expect(startDumpKeep).toHaveBeenCalledWith('wikidata-entities', 'newest'));
  });

  it('shows a running build with a way to stop it, and no notice', async () => {
    show(dump({ needs: 'newer-dump' }, {
      dump: 'wikidata-entities', kind: 'keep', status: 'reading', message: 'Pass 1 of 2: finding what the subset keeps...',
      file: null, downloaded: 0, read: 0, lines: 0, buildId: 11, heartbeatAt: new Date().toISOString(), etaSeconds: null,
      total: null, stepStartedAt: new Date().toISOString(),
    }));
    expect(screen.getByText(/Pass 1 of 2/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Update' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(cancelDumpBuild).toHaveBeenCalledWith('wikidata-entities'));
  });
});
