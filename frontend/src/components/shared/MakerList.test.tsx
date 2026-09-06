/**
 * The makers of a work, as objects a curator moves rather than text they retype.
 *
 * The keyboard path is what is pinned here. Dragging is the other one and needs a
 * pointer with real coordinates, which jsdom does not give — so the arrows carry
 * the guarantee: every reordering this component allows is reachable without a
 * mouse, and both paths end in the same `arrayMove`.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MakerList } from './MakerList';

/** The Visitation in the Prado, in the order the museum run stored it. */
const VISITATION = ['Gianfrancesco Penni', 'Giulio Romano', 'Raphael'];

describe('MakerList', () => {
  it('moves a maker with the keyboard, naming who is being moved', () => {
    const onChange = vi.fn();
    render(<MakerList makers={VISITATION} onChange={onChange} />);

    // Named, because a list of three bare "Move up"s tells a screen reader
    // nothing about which name it is about to move.
    fireEvent.click(screen.getByRole('button', { name: 'Move Raphael up' }));
    expect(onChange).toHaveBeenCalledWith(['Gianfrancesco Penni', 'Raphael', 'Giulio Romano']);
  });

  it('will not move the ends off the list', () => {
    render(<MakerList makers={VISITATION} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Move Gianfrancesco Penni up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Raphael down' })).toBeDisabled();
  });

  it('says which name leads, and only where that means something', () => {
    const { unmount } = render(<MakerList makers={VISITATION} onChange={vi.fn()} />);
    expect(screen.getByText('leads')).toBeTruthy();
    unmount();
    // One maker is not a collaboration, so nothing about them leads.
    render(<MakerList makers={['Katsushika Hokusai']} onChange={vi.fn()} />);
    expect(screen.queryByText('leads')).toBeNull();
  });

  it('removes a maker who did not make it', () => {
    const onChange = vi.fn();
    // Nicolas Cordier restored an arm of the Borghese Gladiator in the 17th
    // century; Agasias of Ephesus carved it.
    render(<MakerList makers={['Nicolas Cordier', 'Agasias of Ephesus']} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Nicolas Cordier' }));
    expect(onChange).toHaveBeenCalledWith(['Agasias of Ephesus']);
  });

  it('adds a maker the catalogue was missing', () => {
    const onChange = vi.fn();
    // The Tretyakov's Morning in a Pine Forest stores Savitsky, who painted the
    // bears; Shishkin painted the forest.
    render(<MakerList makers={['Konstantin Savitsky']} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Add a maker'), { target: { value: 'Ivan Shishkin' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onChange).toHaveBeenCalledWith(['Konstantin Savitsky', 'Ivan Shishkin']);
  });

  it('refuses the same maker twice, where the endpoint would', () => {
    const onChange = vi.fn();
    render(<MakerList makers={['Edward Savage']} onChange={onChange} />);
    // Folded, as the importer's own dedupe is — otherwise a card could read
    // "Edward Savage and Edward Savage".
    fireEvent.change(screen.getByLabelText('Add a maker'), { target: { value: 'edward  savage'.replace('  ', ' ') } });
    expect(screen.getByText('This work already names them.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('refuses a repeat the server would, not merely one that differs in case', () => {
    const onChange = vi.fn();
    render(<MakerList makers={['Vincent van Gogh']} onChange={onChange} />);

    // What a wrapped line pastes. Compared on case alone this was a new name to
    // the form and a repeat to the endpoint, which answers "Validation error"
    // with the reason in a `details` array no screen reads.
    fireEvent.change(screen.getByLabelText('Add a maker'), {
      target: { value: 'Vincent  van Gogh' },
    });
    expect(screen.getByText('This work already names them.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('says what an empty list means rather than showing an empty frame', () => {
    render(<MakerList makers={[]} onChange={vi.fn()} />);
    expect(screen.getByText(/No maker recorded/)).toBeTruthy();
  });
});
