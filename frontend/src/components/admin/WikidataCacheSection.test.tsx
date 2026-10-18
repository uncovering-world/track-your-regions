/**
 * What the cache section says for a source that reads the local Wikidata
 * subset (ADR-0119): the dump the subset was built from, the one cache its
 * runs still fill (the archaeology run's OpenStreetMap answers), and what its
 * runs on the live service left, apart, as rows no run reads.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WikidataCacheSection } from './WikidataCacheSection';
import { getWikidataCache } from '../../api/admin';
import type { WikidataCache, WikidataCacheKind } from '../../api/admin';

vi.mock('../../api/admin', async () => ({
  getWikidataCache: vi.fn(),
  clearWikidataCache: vi.fn(),
  setWikidataCacheTtl: vi.fn(),
}));

function kind(overrides: Partial<WikidataCacheKind>): WikidataCacheKind {
  return {
    kind: 'osm',
    entries: 0,
    rows: 0,
    expired: 0,
    oldestFetchedAt: null,
    nextExpiresAt: null,
    bytes: 0,
    labels: [],
    ttlMs: 24 * 60 * 60 * 1000,
    ttlSource: 'default',
    answeredBy: 'cache',
    ...overrides,
  };
}

async function opened(cache: WikidataCache) {
  vi.mocked(getWikidataCache).mockResolvedValue(cache);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <WikidataCacheSection sourceId={5} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Wikidata cache' }));
  await screen.findByText(/local subset|caches nothing|cache what Wikidata answers/);
}

describe('WikidataCacheSection on a source that reads the subset', () => {
  it('names the dump, keeps OpenStreetMap a cache, and lists what the live runs left apart', async () => {
    await opened({
      reader: 'subset',
      subsetDumpDate: '2026-10-05',
      kinds: [
        kind({ kind: 'classes', entries: 17, rows: 400, expired: 17, answeredBy: 'subset', labels: ['subclasses of archaeological site'] }),
        kind({ kind: 'osm', entries: 57, rows: 1200, labels: ['digs at 50 candidates'] }),
        kind({ kind: 'pool', entries: 0, answeredBy: 'subset' }),
      ],
    });

    expect(screen.getByText('2026-10-05')).toBeInTheDocument();
    expect(screen.getByText('OpenStreetMap objects')).toBeInTheDocument();
    // The one cache a run still reads keeps its lifetime control.
    expect(screen.getAllByLabelText('Lives for (hours)')).toHaveLength(1);

    const leftOver = screen.getByText('Left from its runs on the live service').parentElement!;
    expect(within(leftOver).getByText('Class trees')).toBeInTheDocument();
    expect(within(leftOver).getByRole('button', { name: 'Clear' })).toBeEnabled();
    // A kind the subset answers with nothing left is not listed at all.
    expect(screen.queryByText('Work pools')).not.toBeInTheDocument();
    expect(screen.queryByText(/caches nothing/)).not.toBeInTheDocument();
  });

  it('says the subset is not built when there is no dump to name', async () => {
    await opened({ reader: 'subset', subsetDumpDate: null, kinds: [] });

    expect(screen.getByText(/which is not built/)).toBeInTheDocument();
    expect(screen.queryByText(/caches nothing/)).not.toBeInTheDocument();
  });
});

describe('WikidataCacheSection on a source that reads the live service', () => {
  it('lists every kind as a cache with its lifetime', async () => {
    await opened({
      reader: 'live',
      subsetDumpDate: null,
      kinds: [kind({ kind: 'classes', entries: 17 }), kind({ kind: 'osm', entries: 57 })],
    });

    expect(screen.queryByText(/local subset/)).not.toBeInTheDocument();
    expect(screen.queryByText('Left from its runs on the live service')).not.toBeInTheDocument();
    expect(screen.getAllByLabelText('Lives for (hours)')).toHaveLength(2);
  });
});
