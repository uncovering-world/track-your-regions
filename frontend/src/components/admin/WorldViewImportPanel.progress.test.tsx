/**
 * A running import says which of its three steps it is on (#1356).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WorldViewImportPanel } from './WorldViewImportPanel';
import { getImportStatus } from '../../api/admin/worldViewImport';
import { getExtractionStatus } from '../../api/admin/wikivoyageExtract';

vi.mock('../../api/admin/worldViewImport', async () => ({
  getImportStatus: vi.fn(),
  cancelImport: vi.fn(),
  startBaseLayerImport: vi.fn(),
}));
vi.mock('../../api/admin/wikivoyageExtract', async () => ({
  getExtractionStatus: vi.fn().mockResolvedValue({ running: false, importedWorldViews: [] }),
  cancelExtraction: vi.fn(),
  answerExtractionQuestion: vi.fn(),
}));
vi.mock('../../api/geometry', async () => ({
  startWorldViewGeometryComputation: vi.fn(),
  fetchWorldViewComputationStatus: vi.fn(),
  cancelWorldViewGeometryComputation: vi.fn(),
}));
vi.mock('./ImportSourcePanel', () => ({ ImportSourcePanel: () => null }));

const mockedStatus = getImportStatus as unknown as ReturnType<typeof vi.fn>;

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <WorldViewImportPanel />
    </QueryClientProvider>,
  );
}

describe('a running import (#1356)', () => {
  beforeEach(() => { mockedStatus.mockReset(); });

  it('says the step it is on, of the three, with the spatial pass counted', async () => {
    mockedStatus.mockResolvedValue({
      running: true, status: 'matching', statusMessage: 'Spatial pass: 1228 of 2490 leaves with a Wikidata id',
      createdRegions: 3234, totalRegions: 3234, worldViewId: 30, importedWorldViews: [],
      operation: {
        elapsedSeconds: 4800, cancelling: false,
        step: { index: 3, count: 3, sentence: 'Scoring the leaves the names left by their shape and points', done: 1227, total: 2490, elapsedSeconds: 4200 },
        wait: null,
      },
    });
    renderPanel();

    expect(await screen.findByText('Step 3 of 3')).toBeInTheDocument();
    expect(screen.getByText(/1,227 of 2,490/)).toBeInTheDocument();
    expect(screen.queryByText(/Matching countries:/)).not.toBeInTheDocument();
  });
});

describe('a running extraction (#1356)', () => {
  it('says the step it is on, of the six, and keeps only its request counts', async () => {
    mockedStatus.mockResolvedValue({ running: false, importedWorldViews: [] });
    (getExtractionStatus as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      running: true, status: 'extracting', statusMessage: 'Extracting Africa...',
      regionsFetched: 1200, estimatedTotal: 5700, apiRequests: 40, cacheHits: 1160,
      importedWorldViews: [], caches: [],
      operation: {
        elapsedSeconds: 120, cancelling: false,
        step: { index: 1, count: 6, sentence: 'Reading the region hierarchy from Wikivoyage', done: 1200, total: 5700, elapsedSeconds: 120 },
        wait: null,
      },
    });
    renderPanel();

    expect(await screen.findByText('Step 1 of 6')).toBeInTheDocument();
    expect(screen.getByText(/API requests: 40 \| Cache hits: 1160/)).toBeInTheDocument();
    expect(screen.queryByText(/Extracting regions:/)).not.toBeInTheDocument();
  });
});
