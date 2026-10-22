/**
 * Tests for how the Sync panel draws sources that fill their kinds from one
 * gather (ADR-0132): one card for the pass, with the starts, the reader and
 * the cache once, and a section per source that follows its own run.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SyncPanel } from './SyncPanel';
import { getSources, getSyncStatus, startSync } from '../../api/admin';
import type { ExperienceSource, SyncStatus } from '../../api/admin';

vi.mock('../../api/admin', () => ({
  getSources: vi.fn(),
  getSyncStatus: vi.fn(),
  startSync: vi.fn(),
  fixPictures: vi.fn(),
  cancelSync: vi.fn(),
  reorderSources: vi.fn(),
}));
vi.mock('./CurationGateControls', () => ({ CurationGateControls: () => null }));
vi.mock('./SourceLineControls', () => ({ SourceLineControls: () => null }));
vi.mock('./WikidataCacheSection', () => ({
  WikidataCacheSection: ({ sourceId }: { sourceId: number }) => <p>cache of {sourceId}</p>,
}));
vi.mock('./WikidataReaderControls', () => ({
  WikidataReaderControls: ({ source }: { source: ExperienceSource }) => <p>reader of {source.id}</p>,
}));

/** A Wikidata source as the panel lists it; the pass is the test's to say. */
function source(id: number, name: string, pass: number[]): ExperienceSource {
  return {
    id, name, description: null, is_active: true, requires_curation: true,
    last_sync_at: null, last_sync_status: null, display_priority: id, created_at: '2026-01-01T00:00:00Z',
    waiting: { arrivals: 0, held: 0, contents: 0 },
    enter_sitelinks: 22, stay_sitelinks: 18, find_enter_sitelinks: null, find_stay_sitelinks: null,
    caches: true, repairsPictures: false, findsComponentItems: false, wikidataReader: 'subset', subsetReady: true,
    pass,
  };
}

const idle: SyncStatus = { running: false, lastSyncAt: null, lastSyncStatus: null };
const waiting: SyncStatus = {
  running: true, kind: 'sync', status: 'fetching', statusMessage: 'Waiting for the pass\'s earlier kinds to finish...',
};

const SOURCES = [
  source(3, 'Public art', [3, 6]),
  source(4, 'Places of worship', []),
  source(6, 'Monuments & memorials', [3, 6]),
];

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SyncPanel />
    </QueryClientProvider>,
  );
}

/** The card a heading of the panel's names. */
async function cardOf(title: string): Promise<HTMLElement> {
  const heading = await screen.findByRole('heading', { name: title });
  return heading.closest('.MuiCard-root') as HTMLElement;
}

describe('a pass on the Sync panel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSources).mockResolvedValue(SOURCES);
    vi.mocked(getSyncStatus).mockResolvedValue(idle);
  });

  it('is one card, with a section per source in the order the pass runs them', async () => {
    renderPanel();

    const card = await cardOf('Public art · Monuments & memorials');
    const sections = within(card).getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(sections).toEqual(['Public art', 'Monuments & memorials']);
    // The pass's card and the source that runs alone: one start each.
    expect(screen.getAllByRole('button', { name: 'Start Sync' })).toHaveLength(2);
    expect(within(card).getAllByRole('button', { name: 'Start Sync' })).toHaveLength(1);
    expect(await cardOf('Places of worship')).not.toBe(card);
  });

  it('draws the reader and the cache once, as the first source holds them', async () => {
    renderPanel();

    const card = await cardOf('Public art · Monuments & memorials');
    expect(within(card).getByText('reader of 3')).toBeInTheDocument();
    expect(within(card).getByText('cache of 3')).toBeInTheDocument();
    expect(screen.queryByText('reader of 6')).not.toBeInTheDocument();
    expect(screen.queryByText('cache of 6')).not.toBeInTheDocument();
  });

  it('starts the pass through its first source, and follows every later one from then', async () => {
    vi.mocked(startSync).mockResolvedValue({ started: true } as never);
    renderPanel();
    const card = await cardOf('Public art · Monuments & memorials');
    expect(within(card).getAllByText('Never synced')).toHaveLength(2);

    vi.mocked(getSyncStatus).mockImplementation(async (id: number) => (id === 6 ? waiting : idle));
    fireEvent.click(within(card).getByRole('button', { name: 'Start Sync' }));

    await waitFor(() => expect(startSync).toHaveBeenCalledWith(3));
    expect(startSync).toHaveBeenCalledTimes(1);
    // The later source says it waits for the earlier one, and the card offers
    // the pass's Cancel while it does.
    expect(await within(card).findByText(/Waiting for the pass's earlier kinds/)).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });
});
