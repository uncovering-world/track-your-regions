import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useLayoutEffect } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { mockFetchParams } = vi.hoisted(() => ({ mockFetchParams: vi.fn() }));

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchRegionGeometry: vi.fn().mockResolvedValue(null),
  fetchSavedHullParams: mockFetchParams,
  previewHull: vi.fn(),
  saveHull: vi.fn(),
}));

import { HullEditorDialog } from './HullEditorDialog';

/** Fiji's hull, tuned wider than the 50 km default. */
const TUNED = { bufferKm: 80, concavity: 0.9, simplifyTolerance: 0.02 };

function open() {
  return render(<HullEditorDialog open onClose={() => {}} regionId={42} onSaved={() => {}} />);
}

describe('HullEditorDialog when the saved parameters cannot be read (#1013)', () => {
  beforeEach(() => {
    mockFetchParams.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('says so and keeps Preview off, rather than offering the defaults as the region\'s own', async () => {
    mockFetchParams.mockRejectedValue(new Error('HTTP 500'));
    open();

    expect(await screen.findByText(/saved hull settings could not be loaded/i)).toBeInTheDocument();
    // Preview's gate is what this proves; Save already waits on a preview.
    expect(screen.getByRole('button', { name: 'Preview' })).toBeDisabled();
  });

  it('loads the tuned parameters on Retry and turns Preview back on', async () => {
    mockFetchParams.mockRejectedValueOnce(new Error('HTTP 500')).mockResolvedValueOnce(TUNED);
    open();

    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Preview' })).toBeEnabled());
    expect(screen.queryByText(/could not be loaded/i)).toBeNull();
    expect(screen.getByText('Buffer: 80 km')).toBeInTheDocument();
  });

  it('opens on the defaults, with Preview on, for a hull nobody has tuned', async () => {
    mockFetchParams.mockResolvedValue(null);
    open();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Preview' })).toBeEnabled());
    expect(screen.getByText('Buffer: 50 km')).toBeInTheDocument();
  });

  it('does not offer one region\'s settings for another, not even for the render before the reload', async () => {
    mockFetchParams.mockResolvedValueOnce(TUNED).mockReturnValueOnce(new Promise(() => {}));
    // What the committed DOM says before the dialog's own effects run: a
    // layout effect of a sibling runs after the commit and before them, so it
    // sees the render a click could land on.
    const committed: boolean[] = [];
    function Probe() {
      useLayoutEffect(() => {
        const preview = screen.queryByRole('button', { name: 'Preview' });
        if (preview) committed.push((preview as HTMLButtonElement).disabled);
      });
      return null;
    }
    const dialogFor = (regionId: number) => (
      <>
        <HullEditorDialog open onClose={() => {}} regionId={regionId} onSaved={() => {}} />
        <Probe />
      </>
    );
    const { rerender } = render(dialogFor(42));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Preview' })).toBeEnabled());

    committed.length = 0;
    rerender(dialogFor(43));

    // Fiji's 80 km was loaded for region 42; region 43's first commit must
    // not offer it.
    expect(committed[0]).toBe(true);
  });
});
