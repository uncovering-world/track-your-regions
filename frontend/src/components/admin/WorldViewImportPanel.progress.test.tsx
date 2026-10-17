/**
 * A running import says which of its three steps it is on (#1356).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WorldViewImportPanel } from './WorldViewImportPanel';
import { getImportStatus } from '../../api/admin/worldViewImport';

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
