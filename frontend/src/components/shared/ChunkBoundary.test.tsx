/**
 * A chunk that never arrives costs the part of the page it was for, not the
 * page (#643): a curator who presses Edit after a deployment keeps the map and
 * is offered the reload. A bug inside a screen is not a missing download, and
 * it still reaches whatever is above.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ChunkBoundary } from './ChunkBoundary';
import { lazyChunk } from '../../utils/lazyChunk';

describe('ChunkBoundary', () => {
  // React reports a caught render error on the console; the assertions below
  // are about what is on screen, not about that report.
  beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('keeps the rest of the page and offers a reload when the chunk fails to load', async () => {
    const Missing = lazyChunk<() => null>(() => Promise.reject(
      new TypeError('Failed to fetch dynamically imported module: /assets/CurationDialog-old.js'),
    ));
    render(
      <>
        <p>the map</p>
        <ChunkBoundary><Missing /></ChunkBoundary>
      </>,
    );

    expect(await screen.findByText(/could not be loaded/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    expect(screen.getByText('the map')).toBeInTheDocument();
  });

  it('can be closed, leaving the page without that part', async () => {
    const Missing = lazyChunk<() => null>(() => Promise.reject(new TypeError('Failed to fetch')));
    render(<ChunkBoundary><Missing /></ChunkBoundary>);

    fireEvent.click(await screen.findByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByText(/could not be loaded/)).not.toBeInTheDocument());
  });

  it('renders the chunk once it arrives', async () => {
    const Loaded = lazyChunk(() => Promise.resolve({ default: () => <p>the dialog</p> }));
    render(<ChunkBoundary fallback={<p>loading</p>}><Loaded /></ChunkBoundary>);

    expect(await screen.findByText('the dialog')).toBeInTheDocument();
  });

  it('lets an error from inside the screen through', () => {
    function Broken(): never {
      throw new Error('a bug in the dialog');
    }
    expect(() => render(<ChunkBoundary><Broken /></ChunkBoundary>)).toThrow('a bug in the dialog');
  });
});
