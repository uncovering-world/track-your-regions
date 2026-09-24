import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EditRefusedSnackbar } from './EditRefusedSnackbar';

const REFUSAL = 'Travellers have recorded 2 visits on this region or a region this change would delete. '
  + 'A hierarchy edit does not delete a visit, so this edit was not made.';

describe('EditRefusedSnackbar', () => {
  it('says why the edit was refused, in the server\'s words', () => {
    render(<EditRefusedSnackbar error={new Error(REFUSAL)} onClose={() => {}} />);
    expect(screen.getByRole('alert')).toHaveTextContent(REFUSAL);
  });

  it('says first what a run of edits had already done', () => {
    render(<EditRefusedSnackbar error={new Error(REFUSAL)} lead="2 of 5 subregions were flattened before this one." onClose={() => {}} />);
    expect(screen.getByRole('alert')).toHaveTextContent(`2 of 5 subregions were flattened before this one. ${REFUSAL}`);
  });

  it('shows nothing while no edit has failed', () => {
    render(<EditRefusedSnackbar error={null} onClose={() => {}} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('lets the curator dismiss it', () => {
    const onClose = vi.fn();
    render(<EditRefusedSnackbar error={new Error(REFUSAL)} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
