import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AppThemeProvider } from '../../../../theme';
import { ApiError } from '../../../../api/fetchUtils';
import type { UpdateRegionBody } from '../../../../api/regions';
import type { Region } from '../../../../types';
import { EditRegionDialog } from './EditRegionDialog';

const europe = { id: 1, worldViewId: 5, name: 'Europe', description: null, parentRegionId: null, color: '#3366cc' } as Region;
const iberia = {
  id: 2, worldViewId: 5, name: 'Iberia', description: null, parentRegionId: 1, color: '#cc6633', usesHull: false,
} as Region;

function renderDialog(onSave: (changes: UpdateRegionBody) => Promise<unknown>) {
  const onClose = vi.fn();
  render(
    <AppThemeProvider>
      <EditRegionDialog region={iberia} regions={[europe, iberia]} onClose={onClose} onSave={onSave} />
    </AppThemeProvider>,
  );
  return onClose;
}

function renameTo(name: string) {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: name } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
}

/**
 * The region dialog goes through the form layer (ADR-0076): it sends the
 * fields that changed and nothing else, and a refused save stays open with
 * its reason — on the field it names, or as the form's own error.
 */
describe('the edit region dialog', () => {
  it('sends a rename alone, without the parent or the colour it did not touch', async () => {
    const onSave = vi.fn().mockResolvedValue({});
    const onClose = renderDialog(onSave);

    renameTo('Iberian Peninsula');

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith({ name: 'Iberian Peninsula' });
  });

  it('offers no save until a field changed', () => {
    renderDialog(vi.fn());

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  ' } });
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('shows a refusal that names the name under the Name field, and stays open', async () => {
    const onSave = vi.fn().mockRejectedValue(
      new ApiError('Validation error — name: Too big', 400, 'Validation error', undefined, [{ path: 'name', message: 'Too big' }]),
    );
    const onClose = renderDialog(onSave);

    renameTo('x'.repeat(300));

    expect(await screen.findByText('Too big')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByDisplayValue('x'.repeat(300))).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows a refusal that names no field as the form error', async () => {
    const onSave = vi.fn().mockRejectedValue(new ApiError('Region 2 not found', 404, 'Region 2 not found', undefined));
    const onClose = renderDialog(onSave);

    renameTo('Iberian Peninsula');

    expect(await screen.findByRole('alert')).toHaveTextContent('Region 2 not found');
    expect(onClose).not.toHaveBeenCalled();
  });
});
