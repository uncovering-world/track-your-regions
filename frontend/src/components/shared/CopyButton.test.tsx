/**
 * The one copy control: it copies what it is handed, and says so where a
 * screen reader hears it too (#1190).
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { COPIED_TEXT, COPY_FAILED_TEXT, CopyButton } from './CopyButton';

function setClipboard(value: unknown) {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true });
}

describe('CopyButton', () => {
  it('copies its text and says so aloud', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    render(<CopyButton text="Q637248" label="Copy Q637248" />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy Q637248' }));

    expect(writeText).toHaveBeenCalledWith('Q637248');
    expect(await screen.findByRole('status')).toHaveTextContent(COPIED_TEXT);
  });

  it('says it could not copy when the browser refuses', async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error('denied')) });
    render(<CopyButton text="Q637248" label="Copy Q637248" />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy Q637248' }));

    expect(await screen.findByRole('status')).toHaveTextContent(COPY_FAILED_TEXT);
  });

  it('says so too where there is no clipboard at all', async () => {
    setClipboard(undefined);
    render(<CopyButton text="Q637248" label="Copy Q637248" />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy Q637248' }));

    expect(await screen.findByRole('status')).toHaveTextContent(COPY_FAILED_TEXT);
  });
});
