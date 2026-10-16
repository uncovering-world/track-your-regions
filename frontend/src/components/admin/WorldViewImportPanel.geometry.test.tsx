/**
 * A finished base-layer import offers its geometry computation where the admin is (#621).
 *
 * A base-layer mirror is one region per division — "Administrative", the development
 * catalogue's world view 5, is one — so once its matching completes its outlines can be
 * drawn. The import panel offers the existing background job there and reports it; an
 * import of another kind still needs its review first and offers nothing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WorldViewImportPanel } from './WorldViewImportPanel';
import { getImportStatus } from '../../api/admin/worldViewImport';
import { fetchWorldViewComputationStatus, startWorldViewGeometryComputation } from '../../api/geometry';
import { ApiError } from '../../api/fetchUtils';

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
const mockedStart = startWorldViewGeometryComputation as unknown as ReturnType<typeof vi.fn>;
const mockedProgress = fetchWorldViewComputationStatus as unknown as ReturnType<typeof vi.fn>;

const finished = (sourceType: string) => ({
  running: false, status: 'complete', createdRegions: 3831, worldViewId: 5,
  importedWorldViews: [{ id: 5, name: 'Administrative', sourceType, reviewComplete: false }],
});

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <WorldViewImportPanel />
    </QueryClientProvider>,
  );
}

describe('the geometry offer after an import (#621)', () => {
  beforeEach(() => {
    mockedStatus.mockReset();
    mockedStart.mockReset();
    mockedProgress.mockReset().mockResolvedValue({ running: false });
  });

  it('offers a finished base-layer import its computation, and starts the background job', async () => {
    mockedStatus.mockResolvedValue(finished('base_layer'));
    mockedStart.mockResolvedValue({ started: false, total: 3831, alreadyComputed: 3831, message: 'All geometries already computed' });
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: 'Compute Geometries' }));

    await waitFor(() => expect(mockedStart).toHaveBeenCalledWith(5, false, true));
    expect(await screen.findByText(/All geometries already computed — 3831 computed/)).toBeInTheDocument();
  });

  it('says why the computation could not start, rather than nothing', async () => {
    mockedStatus.mockResolvedValue(finished('base_layer'));
    mockedStart.mockRejectedValue(new ApiError('World view not found', 404, 'World view not found', undefined));
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: 'Compute Geometries' }));

    expect(await screen.findByText('World view not found')).toBeInTheDocument();
  });

  it('draws a job that stopped as a failure, not a success', async () => {
    mockedStatus.mockResolvedValue(finished('base_layer'));
    mockedStart.mockResolvedValue({ started: true, total: 3831 });
    renderPanel();
    await screen.findByRole('button', { name: 'Compute Geometries' });
    mockedProgress.mockResolvedValue({
      running: false, percent: 12, progress: 460, total: 3831, errors: 0,
      status: 'Error: the computation stopped; the server log has the cause.',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Compute Geometries' }));

    const stopped = await screen.findByText(/the computation stopped/, {}, { timeout: 4000 });
    expect(stopped.closest('[role="alert"]')?.className).toMatch(/Error/);
  });

  it('follows a job already running when the card opens, rather than offering a second start', async () => {
    mockedStatus.mockResolvedValue(finished('base_layer'));
    mockedProgress.mockResolvedValue({ running: true, percent: 40, progress: 1532, total: 3831, errors: 0, currentRegion: 'Bavaria' });
    renderPanel();

    expect(await screen.findByText(/Computing geometries... 1532\/3831 — Bavaria/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Computing...' })).toBeDisabled();
  });

  it('follows the running job when the server answers a start with a conflict', async () => {
    mockedStatus.mockResolvedValue(finished('base_layer'));
    mockedStart.mockRejectedValue(new ApiError('Computation already in progress for this hierarchy', 409, undefined, undefined));
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: 'Compute Geometries' }));

    expect(await screen.findByRole('button', { name: 'Computing...' })).toBeDisabled();
    expect(screen.queryByText('Computation already in progress for this hierarchy')).toBeNull();
  });

  it('offers nothing for an import whose review comes first', async () => {
    mockedStatus.mockResolvedValue({ ...finished('wikivoyage'), importedWorldViews: [{ id: 5, name: 'Wikivoyage Regions', sourceType: 'wikivoyage', reviewComplete: false }] });
    renderPanel();

    expect((await screen.findAllByRole('button', { name: 'Review Matches' })).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Compute Geometries' })).toBeNull();
  });
});
