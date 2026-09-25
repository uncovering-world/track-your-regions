/**
 * When the curation dialogs' chunks are fetched, and what closing one keeps
 * (#643). The add-place dialog holds a half-typed new place across a close and
 * clears it only once the place is created, so the wrapper that loads it on
 * demand must not unmount it when it closes.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LazyAddExperienceDialog, LazyCurationDialog } from './lazyCurationDialogs';

vi.mock('./AddExperienceDialog', () => ({
  AddExperienceDialog: ({ open }: { open: boolean }) => <p>add dialog, {open ? 'open' : 'closed'}</p>,
}));
vi.mock('./CurationDialog', () => ({
  CurationDialog: () => <p>curation dialog</p>,
}));

describe('LazyAddExperienceDialog', () => {
  it('mounts nothing until it is first opened', () => {
    render(<LazyAddExperienceDialog open={false} onClose={() => {}} regionId={1} />);
    expect(screen.queryByText(/add dialog/)).not.toBeInTheDocument();
  });

  it('stays mounted after it closes, so the draft survives', async () => {
    const { rerender } = render(<LazyAddExperienceDialog open onClose={() => {}} regionId={1} />);
    expect(await screen.findByText('add dialog, open')).toBeInTheDocument();

    rerender(<LazyAddExperienceDialog open={false} onClose={() => {}} regionId={1} />);
    expect(screen.getByText('add dialog, closed')).toBeInTheDocument();
  });
});

describe('LazyCurationDialog', () => {
  it('mounts only while there is an experience to curate', async () => {
    const { rerender } = render(<LazyCurationDialog experience={null} regionId={null} onClose={() => {}} />);
    expect(screen.queryByText('curation dialog')).not.toBeInTheDocument();

    rerender(
      <LazyCurationDialog
        experience={{ id: 1, name: 'Cologne Cathedral' } as Parameters<typeof LazyCurationDialog>[0]['experience']}
        regionId={null}
        onClose={() => {}}
      />,
    );
    expect(await screen.findByText('curation dialog')).toBeInTheDocument();
  });
});
