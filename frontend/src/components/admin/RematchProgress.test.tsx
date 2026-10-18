/** The running re-match's notice and its Cancel (#1613). */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { RematchProgress } from './RematchProgress';

const RUNNING = { status: 'matching' as const, statusMessage: 'Scoring the leaves the names left by their shape and points' };

describe('RematchProgress', () => {
  it('offers Cancel while a re-match runs, and asks for the stop', () => {
    const onCancel = vi.fn();
    render(<RematchProgress status={RUNNING} onCancel={onCancel} cancelling={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(screen.getByText(RUNNING.statusMessage)).toBeInTheDocument();
  });

  it('waits once a stop was asked for, since the run ends at its next check', () => {
    render(<RematchProgress status={RUNNING} onCancel={vi.fn()} cancelling />);
    expect(screen.getByRole('button', { name: 'Stopping...' })).toBeDisabled();
  });
});
