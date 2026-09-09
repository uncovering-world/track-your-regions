/**
 * The form that corrects one place: what it sends, and what it says.
 *
 * The endpoint's contract is the thing to pin — a name and/or a coordinate pair,
 * never half a move and never an empty body — and the sentences around the button,
 * because a claim is not obvious from a text field and the outcome is read off the
 * reply rather than promised. The picker is stubbed: its map cannot mount in jsdom,
 * and what it hands back is a coordinate, which a button can hand back just as well.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../api/experiences', () => ({
  editLocation: vi.fn(),
}));

vi.mock('./LocationPicker', () => ({
  LocationPicker: ({ onChange }: { onChange: (c: { lat: number; lng: number }) => void }) => (
    <button onClick={() => onChange({ lat: 49.0442, lng: 3.97 })}>move-east</button>
  ),
}));

import { PointCorrection, correctionOutcome, type PlaceToCorrect } from './PointCorrection';
import { editLocation } from '../../api/experiences';

const mockedEdit = editLocation as unknown as ReturnType<typeof vi.fn>;

/** One of the nine unread components of Champagne Hillsides, as the review page lists it. */
function place(over: Partial<PlaceToCorrect> = {}): PlaceToCorrect {
  return {
    locationId: 6001,
    experienceId: 1345,
    objectName: 'Champagne Hillsides, Houses and Cellars',
    name: 'Coteaux de la Marne',
    latitude: 49.0442,
    longitude: 3.955,
    ...over,
  };
}

function renderForm(p: PlaceToCorrect = place()) {
  const onDone = vi.fn();
  const onCancel = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PointCorrection place={p} onDone={onDone} onCancel={onCancel} />
    </QueryClientProvider>,
  );
  return { onDone, onCancel };
}

beforeEach(() => {
  mockedEdit.mockReset();
  mockedEdit.mockResolvedValue({ success: true, locationId: 6001, anchorMoved: false });
});

describe('PointCorrection', () => {
  it('offers nothing to save until something changed', () => {
    renderForm();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('sends a rename as the name alone', async () => {
    const { onDone } = renderForm();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Coteaux de la Marne (west)' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockedEdit).toHaveBeenCalledTimes(1));
    // No coordinate: the endpoint would take the pair and claim a move nobody made.
    expect(mockedEdit).toHaveBeenCalledWith(6001, { name: 'Coteaux de la Marne (west)' });
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(onDone.mock.calls[0][0]).toContain('renamed to “Coteaux de la Marne (west)”');
    expect(onDone.mock.calls[0][0]).toContain('no longer overwrite its name');
  });

  it('sends a move as the pair, and says how far before saving', async () => {
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: 'move-east' }));
    // The queue's own sentence for a moved coordinate — 0.015° of longitude at 49°N.
    expect(screen.getByText('Moved 1.1 km east — may fall in a different region; check the pin.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockedEdit).toHaveBeenCalledTimes(1));
    expect(mockedEdit).toHaveBeenCalledWith(6001, { latitude: 49.0442, longitude: 3.97 });
  });

  it('does not send a name that differs from the stored one only by whitespace', () => {
    // The endpoint stores a name as a person would type it (#835), so a run
    // of spaces typed into the stored name is the same name and no claim.
    renderForm(place({ name: 'Coteaux de la Marne' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: ' Coteaux  de la Marne ' } });
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('does not send a name that was only cleared', () => {
    renderForm();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '   ' } });
    // Clearing is not a correction this form can make: the endpoint's name is min(1).
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('keeps the form open with the reason when the save is refused', async () => {
    mockedEdit.mockRejectedValue(new Error('You do not have curator permissions for this experience'));
    const { onDone } = renderForm();
    fireEvent.click(screen.getByRole('button', { name: 'move-east' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('You do not have curator permissions for this experience')).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('says the pin stays unseen where readers do not see the place, and what would show it', () => {
    renderForm(place({ unseen: 'withdrawn' }));
    expect(screen.getByText(/shows nobody anything — only answering “false alarm” shows it/)).toBeInTheDocument();
  });

  it('names publication as the remedy for an unread place, not the withdrawn verdict', () => {
    // Two causes, two remedies: an unread point under a gated source is shown by
    // publishing, and "false alarm" is the wrong door to point at.
    renderForm(place({ unseen: 'unread' }));
    expect(screen.getByText(/shows nobody anything — only publishing it shows it/)).toBeInTheDocument();
  });

  it('parts the three ways a turned-down place stays unseen, which take three different steps', () => {
    // The whole point of a reason is the remedy it names, and these three differ:
    // asking again then publishing; nothing at all until the source lists it; and
    // the object's own question first, because the take-back is refused outright
    // (#859). One sentence for all three would be wrong on two of them.
    renderForm(place({ unseen: 'refused' }));
    expect(screen.getByText(
      /asking about it again and then publishing it shows it/)).toBeInTheDocument();

    renderForm(place({ unseen: 'dropped' }));
    expect(screen.getByText(
      /nothing will show it until the source lists it again/)).toBeInTheDocument();

    renderForm(place({ unseen: 'blocked' }));
    expect(screen.getByText(
      /answering this place’s own question first, and then asking about the point again/))
      .toBeInTheDocument();
  });
});

describe('correctionOutcome', () => {
  const reply = { success: true as const, locationId: 6001, anchorMoved: false };

  it('leads with the object and the place, and names the move', () => {
    const line = correctionOutcome(place(), { latitude: 49.0442, longitude: 3.97 }, reply);
    expect(line).toBe(
      'Champagne Hillsides, Houses and Cellars: Coteaux de la Marne moved 1.1 km east. '
      + 'The source will no longer overwrite where it is.',
    );
  });

  it('says the object moved with its one place only when the server says so', () => {
    const line = correctionOutcome(place(), { latitude: 49.0442, longitude: 3.97 }, { ...reply, anchorMoved: true });
    expect(line).toContain('The object’s own position moved with it.');
  });

  it('says readers still see nothing for a place that is withdrawn', () => {
    const line = correctionOutcome(place({ unseen: 'withdrawn' }), { name: 'Bilbao' }, reply);
    expect(line).toContain('Readers still do not see this place; only answering “false alarm” shows it.');
    expect(line).toContain('no longer overwrite its name.');
  });

  it('says publishing is what shows an unread place', () => {
    const line = correctionOutcome(place({ unseen: 'unread' }), { name: 'Fort Chabrol' }, reply);
    expect(line).toContain('Readers still do not see this place; only publishing it shows it.');
  });

  it('does not promise publication for a turned-down place the source has since dropped', () => {
    // The outcome is printed on every rename, `anchorMoved` being false for one
    // always — so a sentence naming a step that cannot work is read after every
    // correction of such a place, not occasionally.
    const dropped = correctionOutcome(place({ unseen: 'dropped' }), { name: 'North arch' }, reply);
    expect(dropped).toContain(
      'Readers still do not see this place; nothing will show it until the source lists it again.');

    const blocked = correctionOutcome(place({ unseen: 'blocked' }), { name: 'North arch' }, reply);
    expect(blocked).toContain('answering this place’s own question first');
  });

  it('carries the placement handover where the regions did not follow', () => {
    const line = correctionOutcome(place(), { latitude: 49.0442, longitude: 3.97 }, {
      ...reply,
      placementFailed: true,
      placementFailedWorldViews: [{ id: 4, name: 'Base layer' }],
    });
    expect(line).toContain('could not be re-placed in Base layer (world view 4)');
  });

  it('claims both where both changed', () => {
    const line = correctionOutcome(place(), { name: 'X', latitude: 49.0442, longitude: 3.97 }, reply);
    expect(line).toContain('renamed to “X” and moved 1.1 km east.');
    expect(line).toContain('no longer overwrite its name or where it is.');
  });
});
