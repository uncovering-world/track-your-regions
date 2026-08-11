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
          field: 'name', old: 'ours', new: 'theirs', significance: 'major' as const,
          curatedConflict: true, held: false,
        }],
      }],
      total: 1, limit: 50, offset: 0,
    });
    renderList();

    expect(await screen.findByText(/curated/i)).toBeInTheDocument();
  });

  /** The one field line for `field`, chip included. */
  async function fieldLine(field: string): Promise<HTMLElement> {
    const label = await screen.findByText(`${field}:`);
    return label.parentElement as HTMLElement;
  }

  const HELD_ROW = {
    ...MAJOR_CHANGE,
    change_type: 'held' as const,
    changed_fields: [{
      field: 'name', old: 'what a reader sees', new: 'what the source offers',
      significance: 'major' as const, curatedConflict: false, held: true,
    }],
  };

  it('marks a field the gate held, so it cannot be read as the value now live', async () => {
    mockedGet.mockResolvedValue({ changes: [HELD_ROW], total: 1, limit: 50, offset: 0 });
    renderList();

    // Without a chip the line renders `old → new` and the held value reads as
    // the one now live — the exact opposite of the truth (#519). Asserted on the
    // field's own line rather than the page, so the row's chip a few pixels
    // above cannot satisfy it.
    const line = await fieldLine('name');
    expect(line.textContent).toContain('held');
    // And not as a curator's own edit: that word says a person's value won on
    // purpose and nothing is waiting, while a verdict is waiting on this one.
    expect(line.textContent).not.toContain('curated');
  });

  it('tells a held field apart from a curated conflict in the same row', async () => {
    mockedGet.mockResolvedValue({
      changes: [{
        ...HELD_ROW,
        changed_fields: [
          {
            field: 'name', old: 'ours', new: 'theirs', significance: 'major' as const,
            curatedConflict: true, held: false,
          },
          {
            field: 'description', old: 'a', new: 'b', significance: 'minor' as const,
            curatedConflict: false, held: true,
          },
        ],
      }],
      total: 1, limit: 50, offset: 0,
    });
    renderList();

    // One field a person claimed on purpose, one nobody has looked at. Both
    // refused, and a screen that painted them alike would cost the curator the
    // difference between "I already decided this" and "this is waiting for me".
    const claimed = await fieldLine('name');
    expect(claimed.textContent).toContain('curated');
    expect(claimed.textContent).not.toContain('held');
    const held = await fieldLine('description');
    expect(held.textContent).toContain('held');
    expect(held.textContent).not.toContain('curated');

    // The paint as well as the word, and this is the one decision here that a
    // screenshot overturned: painting both chips the same colour leaves a
    // mixed row like this one saying "refused" twice in the same ink, and the
    // curator loses the at-a-glance difference between "I already decided this"
    // and "this is waiting for me" — which is the whole reason for the second
    // word. Two literals rather than "they differ", so the pair cannot drift
    // together into a colour that means something else on this screen.
    const chip = (line: HTMLElement) => line.querySelector('.MuiChip-root') as HTMLElement;
    expect(chip(claimed).className).toMatch(/colorWarning/);
    expect(chip(held).className).toMatch(/colorInfo/);
  });

  it('names a held row held rather than a decision somebody took', async () => {
    mockedGet.mockResolvedValue({ changes: [HELD_ROW], total: 1, limit: 50, offset: 0 });
    renderList();

    // The row's own chip, on the header line beside the object's name — the
    // summary of what happened to it. `conflict` there would say a person had
    // already decided, and `updated` that the value is live.
    const header = (await screen.findByText('Serengeti National Park')).parentElement as HTMLElement;
    const chip = header.querySelector('.MuiChip-root') as HTMLElement;
    expect(chip.textContent).toBe('held');
    // The colour as well as the word: a change type the palette has never heard
    // of renders grey, which on this screen reads as "nothing to see" next to
    // the blue `updated` rows it is sitting among.
    expect(chip.className).toMatch(/colorWarning/);
  });

  it('does not paint a filtered reason red, since nothing failed', async () => {
    mockedGet.mockResolvedValue({
      changes: [{
        ...MAJOR_CHANGE,
        change_type: 'filtered' as const,
        significance: null,
        changed_fields: null,
        name_snapshot: 'Royal Collection',
        error: 'No coordinates after resolution — a collection rather than a museum',
      }],
      total: 1, limit: 50, offset: 0,
    });
    renderList();

    const reason = await screen.findByText(/a collection rather than a museum/i);
    // MUI maps color="error" to this class; a filter working is not a failure
    expect(reason.className).not.toMatch(/colorError/);
  });

  it('says the filter emptied the list, not that the run recorded nothing', async () => {
    // The panel only mounts this component for runs that have changeset rows,
    // so "no changes recorded" would be false here
    mockedGet.mockResolvedValue({ changes: [], total: 0, limit: 50, offset: 0 });
    renderList();

    expect(await screen.findByText(/nothing significant in this run/i)).toBeInTheDocument();
  });
});
