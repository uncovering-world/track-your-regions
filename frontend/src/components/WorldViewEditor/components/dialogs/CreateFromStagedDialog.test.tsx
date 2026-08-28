/**
 * The dialog suggests a name for the region it is about to make -- what the
 * staged divisions' names share -- and until #282 it kept suggesting it: the
 * seed ran on every render whose field was empty, so the admin who deleted
 * the "M" that Monroe County and Miami-Dade County share saw it come straight
 * back. A suggestion is offered once, when the dialog opens; after that the
 * field is the admin's, and an emptied field is a choice, not a gap to refill.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { AdministrativeDivision } from '../../../../types';
import { CreateFromStagedDialog } from './CreateFromStagedDialog';

vi.mock('../../../../api', () => ({
  fetchDivisionGeometry: vi.fn().mockResolvedValue(null),
}));

// The drawing surface is a map; the detour through it is what matters here,
// not what is drawn. The stand-in shows the title it was given and a way back.
vi.mock('../../../CustomBoundaryDialog', () => ({
  CustomBoundaryDialog: ({ open, onClose, title }: { open: boolean; onClose: () => void; title: string }) =>
    open ? (
      <div>
        <span>{title}</span>
        <button onClick={onClose}>Leave drawing</button>
      </div>
    ) : null,
}));

const division = (id: number, name: string): AdministrativeDivision => ({ id, name, parentId: null, hasChildren: false });

/** The issue's own example: two Florida counties whose names share one letter. */
const FLORIDA_COUNTIES = [division(1, 'Monroe County'), division(2, 'Miami-Dade County')];
/** GADM splits Kazakhstan across two continents; both rows carry the country's name. */
const KAZAKHSTAN_PARTS = [division(3, 'Kazakhstan'), division(4, 'Kazakhstan')];

function dialog(open: boolean, staged: AdministrativeDivision[], onConfirm = vi.fn(), onClose = vi.fn()) {
  return (
    <CreateFromStagedDialog
      open={open}
      stagedDivisions={staged}
      selectedRegion={null}
      inheritParentColor={false}
      onInheritParentColorChange={vi.fn()}
      onClose={onClose}
      onConfirm={onConfirm}
      isPending={false}
    />
  );
}

const nameField = () => screen.getByLabelText('Region Name');
const typeName = (value: string) => fireEvent.change(nameField(), { target: { value } });

describe('CreateFromStagedDialog', () => {
  it('suggests what the staged names share when it opens', () => {
    render(dialog(true, FLORIDA_COUNTIES));
    expect(nameField()).toHaveValue('M');
  });

  it('lets the admin clear the suggestion', () => {
    render(dialog(true, FLORIDA_COUNTIES));
    typeName('');
    expect(nameField()).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Create Region with 2 Divisions' })).toBeDisabled();
  });

  it('creates the region under the name the admin typed over the suggestion', () => {
    const onConfirm = vi.fn();
    render(dialog(true, FLORIDA_COUNTIES, onConfirm));
    typeName('Florida Keys');
    fireEvent.click(screen.getByRole('button', { name: 'Create Region with 2 Divisions' }));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ name: 'Florida Keys' }));
  });

  it('suggests afresh for the next staging, not what was typed last time', () => {
    const onClose = vi.fn();
    const { rerender } = render(dialog(true, FLORIDA_COUNTIES, vi.fn(), onClose));
    typeName('Florida Keys');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    rerender(dialog(false, FLORIDA_COUNTIES, vi.fn(), onClose));
    rerender(dialog(true, KAZAKHSTAN_PARTS, vi.fn(), onClose));
    expect(nameField()).toHaveValue('Kazakhstan');
  });

  it('keeps the typed name if the staged set changes under the open dialog', () => {
    // Unreachable through the modal today; the invariant is that a suggestion
    // is made on opening and never over what the admin has since typed.
    const { rerender } = render(dialog(true, FLORIDA_COUNTIES));
    typeName('Florida Keys');
    rerender(dialog(true, KAZAKHSTAN_PARTS));
    expect(nameField()).toHaveValue('Florida Keys');
  });

  it('keeps the typed name through the boundary-drawing detour', async () => {
    render(dialog(true, FLORIDA_COUNTIES));
    typeName('Florida Keys');
    fireEvent.click(screen.getByLabelText('Draw custom boundary (for partial divisions)'));
    fireEvent.click(screen.getByRole('button', { name: 'Draw Boundary' }));
    // Drawing takes the dialog's place, under the name being drawn for. The
    // way back is reachable once the dialog has finished leaving.
    await screen.findByText('Redefine Boundaries for "Florida Keys"');
    fireEvent.click(await screen.findByRole('button', { name: 'Leave drawing' }));
    expect(await screen.findByLabelText('Region Name')).toHaveValue('Florida Keys');
  });
});
