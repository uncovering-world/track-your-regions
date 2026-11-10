/**
 * The admin's card for a copy built from a dump (#1583, #2415): what reads it,
 * a notice only when something needs doing, naming the one action, and how a
 * file is read only behind the info mark.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CopyCard } from './CopyCard';
import { cancelDumpBuild, startDumpKeep, startDumpRederive, type DumpsDumpsItem } from '../../api/admin/dumps';

vi.mock('../../api/admin/dumps', () => ({
  startDumpKeep: vi.fn(async () => ({})),
  startDumpRederive: vi.fn(async () => ({})),
  cancelDumpBuild: vi.fn(async () => ({ cancelled: true })),
}));

type Keeps = NonNullable<DumpsDumpsItem['keeps']>;

const dump = (keeps: Partial<Keeps>, progress: DumpsDumpsItem['progress'] = null): DumpsDumpsItem => ({
  key: 'wikidata-entities', source: 'Wikidata', title: 'All entities', datedBy: 'day', about: 'Every Wikidata item.', how: 'Verified by its sha1.',
  inputOf: null, progress, builds: [], localCopy: null, sample: null,
  keeps: {
    title: 'Wikidata copy',
    feeds: 'Every sync reads Wikidata from this copy, not from the live service.',
    built: { dumpDate: '2026-10-05', swappedAt: '2026-10-15T15:31:30Z' },
    needs: 'nothing',
    newestDumpDate: '2026-10-05',
    newestChecked: 'answered',
    rederives: true,
    samples: true,
    fromCopy: true,
    schedule: { everyDays: 30, chosen: false, defaultEveryDays: 30 },
    currentTo: false,
    followsInputs: false,
    inputsMoved: false,
    archives: [],
    ...keeps,
  },
});

function show(item: DumpsDumpsItem, inputs: DumpsDumpsItem[] = []) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><CopyCard dump={item} inputs={inputs} /></QueryClientProvider>);
}

beforeEach(() => vi.clearAllMocks());

describe('the card of a copy built from a dump', () => {
  it('says the copy is up to date, and offers nothing to press', () => {
    show(dump({}));
    expect(screen.getByText('Up to date')).toBeTruthy();
    expect(screen.getByText(/Built from the dump of 5 Oct 2026/)).toBeTruthy();
    // The only button is the info mark, which a keyboard reaches and a screen reader names.
    expect(screen.getAllByRole('button').map(button => button.getAttribute('aria-label'))).toEqual(['About the Wikidata copy']);
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
    expect(screen.getByText(/A newer dump of 19 Oct 2026 is out/)).toBeTruthy();
    expect(screen.getByText(/keeps working as usual meanwhile/)).toBeTruthy();
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
      total: null, stepStartedAt: new Date().toISOString(), retry: null,
      operation: {
        elapsedSeconds: 90, cancelling: false, wait: null,
        step: { index: 2, count: null, sentence: 'Pass 1 of 2: finding what the subset keeps...', done: 0, total: 0, elapsedSeconds: 60 },
      },
    }));
    expect(screen.getByText(/Pass 1 of 2/)).toBeTruthy();
    // A build names its steps as it goes, so it says which one it is on and not of how many (#1356).
    expect(screen.getByText('Step 2')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Update' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(cancelDumpBuild).toHaveBeenCalledWith('wikidata-entities'));
  });

  it('says what reads the copy, and the dumps its build reads beside its own (#2415)', () => {
    const structure = { ...dump({ title: "English Wikipedia's structure", feeds: 'Its articles and categories.' }), key: 'enwiki-page' } as DumpsDumpsItem;
    const input = (title: string) => ({ ...structure, key: 'enwiki-linktarget', title, keeps: null, inputOf: 'enwiki-page' }) as unknown as DumpsDumpsItem;
    show(structure, [input('Page properties'), input('Link targets'), input('Category links')]);
    expect(screen.getByText('Its articles and categories.')).toBeTruthy();
    expect(screen.getByText('Its build also reads the page properties, link targets and category links of the same date.')).toBeTruthy();
  });

  it('says what the last build cost, from the copy\'s own history', () => {
    show({ ...dump({ needs: 'newer-dump', newestDumpDate: '2026-11-01' }), builds: [
      { kind: 'keep', status: 'success', startedAt: '2026-11-01T10:00:00Z', finishedAt: '2026-11-01T13:05:00Z' },
    ] } as unknown as DumpsDumpsItem);
    expect(screen.getByText(/The last build took 3 h 5 min\. The catalogue keeps working as usual meanwhile\./)).toBeTruthy();
  });

  it('quotes no build that only brought the copy forward, and no figure for a full update', () => {
    // The layer's daily diffs take minutes; its build from a newer planet took hours.
    const builds = [
      { kind: 'keep', status: 'success', broughtForward: true, startedAt: '2026-11-10T06:00:00Z', finishedAt: '2026-11-10T06:04:00Z' },
      { kind: 'keep', status: 'success', broughtForward: false, startedAt: '2026-11-01T10:00:00Z', finishedAt: '2026-11-01T14:30:00Z' },
    ];
    const { unmount } = show({ ...dump({ needs: 'newer-dump', newestDumpDate: '2026-11-08' }), builds } as unknown as DumpsDumpsItem);
    expect(screen.getByText(/The last build took 4 h 30 min\./)).toBeTruthy();
    unmount();

    show({ ...dump({ needs: 'rebuild' }), builds } as unknown as DumpsDumpsItem);
    expect(screen.queryByText(/The last build took/)).toBeNull();
  });

  it("words readership's refold by its cause, the redirects, and keeps no claim the app was updated (#2415)", () => {
    const { unmount } = show(dump({ needs: 'rebuild', followsInputs: true, inputsMoved: true, title: 'Readership' }));
    expect(screen.getByText('The redirects were updated, so the copy is counted again with them.')).toBeTruthy();
    expect(screen.getByText('Its schedule starts this by itself. The runs read the copy as it stood meanwhile.')).toBeTruthy();
    expect(screen.queryByText(/The app was updated/)).toBeNull();
    unmount();

    // With its schedule off, nothing starts it but the button.
    show(dump({ needs: 'rebuild', followsInputs: true, inputsMoved: true, schedule: { everyDays: null, chosen: true, defaultEveryDays: 7 } }));
    expect(screen.getByText('Its schedule is off, so this waits for Update. The runs read the copy as it stood meanwhile.')).toBeTruthy();
  });

  it('says a part is missing, not that the redirects moved, when a month of the year was never kept', () => {
    show(dump({ needs: 'rebuild', followsInputs: true, inputsMoved: false, title: 'Readership' }));
    expect(screen.getByText('Part of the copy is missing, so the runs cannot read it.')).toBeTruthy();
    expect(screen.getByText('Its schedule starts this by itself. The next build reads what is missing, and counts again any month the redirects moved under.')).toBeTruthy();
    expect(screen.queryByText(/The redirects were updated/)).toBeNull();
    expect(screen.queryByText(/as it stood meanwhile/)).toBeNull();
  });

  it("quotes no time for the OpenStreetMap layer, whose update takes the daily changes rather than a planet's build", () => {
    const builds = [{ kind: 'keep', status: 'success', broughtForward: false, startedAt: '2026-11-01T10:00:00Z', finishedAt: '2026-11-01T16:00:00Z' }];
    show({ ...dump({ needs: 'newer-dump', newestDumpDate: '2026-11-08', currentTo: true }), builds } as unknown as DumpsDumpsItem);
    expect(screen.queryByText(/The last build took/)).toBeNull();
  });
});
