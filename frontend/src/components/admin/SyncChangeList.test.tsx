/**
 * Tests for the run changeset list.
 *
 * The default filter is the behaviour worth pinning: a run card that opens
 * showing 1200 cosmetic edits has buried the two that matter.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../api/admin', () => ({
  getSyncLogChanges: vi.fn(),
}));

import { getSyncLogChanges } from '../../api/admin';
import { SyncChangeList } from './SyncChangeList';

const mockedGet = getSyncLogChanges as unknown as ReturnType<typeof vi.fn>;

const MAJOR_CHANGE = {
  id: 1,
  experience_id: 501,
  external_id: '156',
  name_snapshot: 'Serengeti National Park',
  change_type: 'updated' as const,
  changed_fields: [
    { field: 'metadata.inDanger', old: false, new: true, significance: 'major' as const, curatedConflict: false },
  ],
  significance: 'major' as const,
  error: null,
};

function renderList() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SyncChangeList logId={9} />
    </QueryClientProvider>
  );
}

describe('SyncChangeList', () => {
  beforeEach(() => {
    mockedGet.mockReset();
    mockedGet.mockResolvedValue({ changes: [MAJOR_CHANGE], total: 1, limit: 50, offset: 0 });
  });

  it('asks for significant changes only by default', async () => {
    renderList();

    await waitFor(() => expect(mockedGet).toHaveBeenCalled());
    expect(mockedGet).toHaveBeenCalledWith(9, expect.objectContaining({ significantOnly: true }));
  });

  it('does not filter on significance, which would hide created and missing rows', async () => {
    renderList();

    await waitFor(() => expect(mockedGet).toHaveBeenCalled());
    expect(mockedGet).toHaveBeenCalledWith(9, expect.not.objectContaining({ significance: 'major' }));
  });

  it('shows the object and the field that changed', async () => {
    renderList();

    expect(await screen.findByText('Serengeti National Park')).toBeInTheDocument();
    expect(screen.getByText(/metadata\.inDanger/)).toBeInTheDocument();
    expect(screen.getByText(/false → true/)).toBeInTheDocument();
  });

  it('drops the significance filter when the toggle is turned off', async () => {
    renderList();

    await screen.findByText('Serengeti National Park');
    fireEvent.click(screen.getByRole('checkbox', { name: /significant only/i }));

    await waitFor(() => {
      expect(mockedGet).toHaveBeenLastCalledWith(9, expect.not.objectContaining({ significantOnly: true }));
    });
  });

  it('says so when the changes cannot be loaded', async () => {
    mockedGet.mockRejectedValue(new Error('network down'));
    renderList();

    expect(await screen.findByText(/could not load/i)).toBeInTheDocument();
  });

  it('summarises long text instead of printing it', async () => {
    mockedGet.mockResolvedValue({
      changes: [{
        ...MAJOR_CHANGE,
        significance: 'minor' as const,
        changed_fields: [{
          field: 'description',
          old: 'x'.repeat(340),
          new: 'y'.repeat(512),
          significance: 'minor' as const,
          curatedConflict: false,
        }],
      }],
      total: 1, limit: 50, offset: 0,
    });
    renderList();

    expect(await screen.findByText(/changed \(340 → 512 chars\)/)).toBeInTheDocument();
    expect(screen.queryByText('y'.repeat(512))).not.toBeInTheDocument();
  });

  it('marks a change the curator guard refused to apply', async () => {
    mockedGet.mockResolvedValue({
      changes: [{
        ...MAJOR_CHANGE,
        changed_fields: [{
          field: 'name', old: 'ours', new: 'theirs', significance: 'major' as const, curatedConflict: true,
        }],
      }],
      total: 1, limit: 50, offset: 0,
    });
    renderList();

    expect(await screen.findByText(/curated/i)).toBeInTheDocument();
  });

  it('says the filter emptied the list, not that the run recorded nothing', async () => {
    // The panel only mounts this component for runs that have changeset rows,
    // so "no changes recorded" would be false here
    mockedGet.mockResolvedValue({ changes: [], total: 0, limit: 50, offset: 0 });
    renderList();

    expect(await screen.findByText(/nothing significant in this run/i)).toBeInTheDocument();
  });
});
