/**
 * The new-place dialog goes through the form layer (ADR-0076, #1129).
 *
 * The rules themselves are held by `useEditForm.test.tsx`; this holds that the
 * dialog's create reaches them: what a curator left blank is not sent, and a
 * refusal lands on the field it names — the coordinates box for `latitude`,
 * which the body splits out of one field — or, naming none, above the button.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../utils/queryInvalidation', () => ({
  invalidateExperiences: vi.fn(),
}));

vi.mock('../../api/curation', () => ({
  assignExperienceToRegion: vi.fn(),
  createManualExperience: vi.fn(),
}));
vi.mock('../../api/experiences', () => ({
  searchExperiences: vi.fn(async () => ({ results: [] })),
  fetchExperienceKinds: vi.fn(async () => [
    { id: 1, name: 'World Heritage Sites', display_priority: 1 },
  ]),
}));
// The auto-fill finds nothing: what is sent is what the curator filled in.
vi.mock('../../api/geocode', () => ({
  searchPlaces: vi.fn(async () => []),
  suggestImageUrl: vi.fn(async () => { throw new Error('No image found'); }),
}));

// The picker draws a map, which jsdom cannot; here it only has to set the pin.
// The pin is passed per test: a right one, and one whose latitude was mistyped.
let pin = { lat: 34.3964, lng: 64.5161 };
vi.mock('./LocationPicker', () => ({
  LocationPicker: ({ onChange }: { onChange: (c: { lat: number; lng: number }) => void }) => (
    <div data-testid="location-picker">
      <button type="button" onClick={() => onChange(pin)}>Drop pin</button>
    </div>
  ),
}));

import { createManualExperience } from '../../api/curation';
import { ApiError } from '../../api/fetchUtils';
import { AddExperienceDialog } from './AddExperienceDialog';

const mockedCreate = createManualExperience as unknown as ReturnType<typeof vi.fn>;

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AddExperienceDialog open onClose={vi.fn()} regionId={5} regionName="Afghanistan" defaultKindId={1} />
    </QueryClientProvider>,
  );
}

/** The Minaret of Jam, filled in with its name and a pin and nothing else. */
function fillMinaret() {
  fireEvent.change(screen.getByRole('textbox', { name: /^Name/ }), { target: { value: 'Minaret of Jam' } });
  fireEvent.click(screen.getByRole('button', { name: 'Drop pin' }));
  fireEvent.click(screen.getByRole('button', { name: 'Create Experience' }));
}

beforeEach(() => {
  mockedCreate.mockReset();
  pin = { lat: 34.3964, lng: 64.5161 };
});

describe('AddExperienceDialog create', () => {
  it('sends what was filled in and no blank key for what was not', async () => {
    mockedCreate.mockResolvedValue({ id: 900 });
    renderDialog();

    fillMinaret();

    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1));
    // Strict: a key sent as `undefined` or `''` fails here, where toEqual would pass it.
    expect(mockedCreate.mock.calls[0][0]).toStrictEqual({
      name: 'Minaret of Jam',
      kindId: 1,
      latitude: 34.3964,
      longitude: 64.5161,
      regionId: 5,
    });
  });

  it('shows a refusal naming latitude under the coordinates', async () => {
    pin = { lat: 94.3964, lng: 64.5161 };
    const message = 'Number must be less than or equal to 90';
    mockedCreate.mockRejectedValue(new ApiError(
      `Validation error — latitude: ${message}`, 400, 'Validation error', undefined,
      [{ path: 'latitude', message }],
    ));
    renderDialog();

    fillMinaret();

    const shown = await screen.findByText(message);
    expect(screen.getByTestId('location-picker').parentElement).toContainElement(shown);
    // On its field, and nowhere else.
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows a refusal naming no field as the form error', async () => {
    mockedCreate.mockRejectedValue(new ApiError('Curator access required', 403, 'Curator access required', undefined));
    renderDialog();

    fillMinaret();

    expect(await screen.findByRole('alert')).toHaveTextContent('Curator access required');
  });
});
