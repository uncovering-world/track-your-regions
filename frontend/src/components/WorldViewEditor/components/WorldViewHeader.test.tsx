import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AppThemeProvider } from '../../../theme';
import type { WorldView } from '../../../api/worldViews';
import { WorldViewHeader } from './WorldViewHeader';

const worldView = { id: 5, name: 'Cultural Regions', description: 'By culture', source: null } as unknown as WorldView;

function renderHeader(onUpdate: (data: object) => Promise<unknown>) {
  render(
    <AppThemeProvider>
      <WorldViewHeader worldView={worldView} onUpdate={onUpdate} isPending={false} onClose={() => {}} />
    </AppThemeProvider>,
  );
}

function renameTo(name: string) {
  fireEvent.click(screen.getByText('Cultural Regions'));
  fireEvent.change(screen.getByDisplayValue('Cultural Regions'), { target: { value: name } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
}

/**
 * The inline editor closes on a save that landed and stays open, with the
 * reason, on one the server refused — closing on the press reported a refused
 * rename as done (#448).
 */
describe('the world view header editor', () => {
  it('stays open with the reason when the save is refused', async () => {
    renderHeader(vi.fn().mockRejectedValue(new Error('Validation error — name: Too big')));

    renameTo('x'.repeat(300));

    expect(await screen.findByText('Validation error — name: Too big')).toBeInTheDocument();
    expect(screen.getByDisplayValue('x'.repeat(300))).toBeInTheDocument();
  });

  it('shows nothing for a save refused after its editor was dismissed', async () => {
    let refuse: (err: Error) => void = () => {};
    renderHeader(() => new Promise((_, reject) => { refuse = reject; }));

    renameTo('x'.repeat(300));
    fireEvent.keyDown(screen.getByDisplayValue('x'.repeat(300)), { key: 'Escape' });
    fireEvent.click(screen.getByText('By culture'));
    refuse(new Error('Validation error — name: Too big'));

    await screen.findByDisplayValue('By culture');
    await Promise.resolve();
    expect(screen.queryByText('Validation error — name: Too big')).not.toBeInTheDocument();
  });

  it('sends an emptied description as empty, so the stored one is cleared (#1133)', async () => {
    const onUpdate = vi.fn().mockResolvedValue({});
    renderHeader(onUpdate);

    fireEvent.click(screen.getByText('By culture'));
    fireEvent.change(screen.getByDisplayValue('By culture'), { target: { value: '  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onUpdate).toHaveBeenCalledWith({ description: '' });
  });

  it('closes when the save lands', async () => {
    const onUpdate = vi.fn().mockResolvedValue({});
    renderHeader(onUpdate);

    renameTo('Cultural Areas');

    expect(onUpdate).toHaveBeenCalledWith({ name: 'Cultural Areas' });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument());
  });
});
