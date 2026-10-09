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
import { searchPlaces } from '../../api/geocode';
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

/**
 * A draft kept across a close (#1147): the lazy wrapper keeps the dialog
 * mounted so a half-typed place survives, and the reopened draft behaves as
 * it did before — its kind and type stay, and a value auto-fill wrote for the
 * old name still moves with a new one.
 */
describe('a draft kept across a close', () => {
  const mockedSearch = searchPlaces as unknown as ReturnType<typeof vi.fn>;
  beforeEach(() => { mockedSearch.mockClear(); });
  const JAM = { lat: 34.3964, lng: 64.5161, display_name: 'Minaret of Jam, Ghor, Afghanistan' };
  const BAMIYAN = { lat: 34.8318, lng: 67.8273, display_name: 'Buddhas of Bamiyan, Bamyan, Afghanistan' };

  function renderKept(defaultKindId?: number) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = (open: boolean, kind: number | undefined) => (
      <QueryClientProvider client={client}>
        <AddExperienceDialog open={open} onClose={vi.fn()} regionId={5} regionName="Afghanistan" defaultKindId={kind} />
      </QueryClientProvider>
    );
    const { rerender } = render(view(true, defaultKindId));
    return {
      /**
       * Close with the Close button and open again: from the same button by
       * default, from a kind's "+" when given a kind, from one naming none on null.
       */
      closeAndReopen: (reopenWith: number | null = defaultKindId ?? null) => {
        fireEvent.click(screen.getByRole('button', { name: 'Close' }));
        rerender(view(false, defaultKindId));
        rerender(view(true, reopenWith ?? undefined));
      },
    };
  }

  const kindSelect = async () => (await screen.findAllByRole('combobox'))[0];
  const typeSelect = async () => (await screen.findAllByRole('combobox'))[1];

  const nameBox = () => screen.getByRole('textbox', { name: /^Name/ });

  it('keeps the kind the curator chose', async () => {
    const { closeAndReopen } = renderKept(undefined);
    fireEvent.mouseDown((await screen.findAllByRole('combobox'))[0]);
    fireEvent.click(await screen.findByRole('option', { name: 'World Heritage Sites' }));

    closeAndReopen();

    expect(await kindSelect()).toHaveTextContent('World Heritage Sites');
  });

  it('starts the draft after a create with no kind, for the next opening to name', async () => {
    mockedCreate.mockResolvedValue({ id: 902 });
    const { closeAndReopen } = renderKept(1);
    fireEvent.change(nameBox(), { target: { value: 'Minaret of Jam' } });
    fireEvent.click(screen.getByRole('button', { name: 'Drop pin' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Create Experience' }));
    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1));

    // Reopened from the list's generic button, which names no kind.
    closeAndReopen(null);

    expect(await kindSelect()).not.toHaveTextContent('World Heritage Sites');
  });

  it('keeps the kind when reopened from a button that names none', async () => {
    const { closeAndReopen } = renderKept(1);
    // The kinds arrive from a query; the select reads blank until they do.
    await waitFor(async () => expect(await kindSelect()).toHaveTextContent('World Heritage Sites'));

    closeAndReopen(null);

    await waitFor(async () => expect(await kindSelect()).toHaveTextContent('World Heritage Sites'));
    fireEvent.change(nameBox(), { target: { value: 'Minaret of Jam' } });
    fireEvent.click(screen.getByRole('button', { name: 'Drop pin' }));
    // The kind is the form's value, not only the select's label.
    expect(screen.getByRole('button', { name: 'Create Experience' })).toBeEnabled();
  });

  it('keeps the type when reopened from the kind it already has', async () => {
    const { closeAndReopen } = renderKept(undefined);
    fireEvent.mouseDown(await kindSelect());
    fireEvent.click(await screen.findByRole('option', { name: 'World Heritage Sites' }));
    fireEvent.mouseDown(await typeSelect());
    fireEvent.click(await screen.findByRole('option', { name: 'Cultural' }));

    closeAndReopen(1);

    expect(await typeSelect()).toHaveTextContent('Cultural');
  });

  it('looks a place up only when asked, never as the name is typed', async () => {
    renderKept(1);

    fireEvent.change(nameBox(), { target: { value: 'Minaret of Jam' } });
    await new Promise((resolve) => { setTimeout(resolve, 1000); });
    expect(mockedSearch).not.toHaveBeenCalled();

    fireEvent.keyDown(nameBox(), { key: 'Enter' });
    await waitFor(() => expect(mockedSearch).toHaveBeenCalledTimes(1));
  });

  it('drops a lookup still running when the name changes under it', async () => {
    let answer!: (places: typeof JAM[]) => void;
    mockedSearch.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
    renderKept(1);

    fireEvent.change(nameBox(), { target: { value: 'Minaret of Jam' } });
    fireEvent.click(screen.getByRole('button', { name: 'Look up' }));
    await waitFor(() => expect(mockedSearch).toHaveBeenCalledTimes(1));
    fireEvent.change(nameBox(), { target: { value: 'Buddhas of Bamiyan' } });
    answer([JAM]);

    await new Promise((resolve) => { setTimeout(resolve, 50); });
    expect(screen.queryByText(/Minaret of Jam, Ghor/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Look up' })).not.toBeDisabled();
    mockedSearch.mockImplementation(async () => []);
  });

  it("looks up again without moving a pin the curator placed since", async () => {
    mockedSearch.mockImplementation(async (query: string) => [query.startsWith('Minaret') ? JAM : BAMIYAN]);
    mockedCreate.mockResolvedValue({ id: 902 });
    pin = { lat: 34.3967, lng: 64.5158 };
    renderKept(1);

    fireEvent.change(nameBox(), { target: { value: 'Minaret of Jam' } });
    fireEvent.click(screen.getByRole('button', { name: 'Look up' }));
    await waitFor(() => expect(mockedSearch).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Drop pin' }));
    fireEvent.change(nameBox(), { target: { value: 'Buddhas of Bamiyan' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Look up again' }));
    await waitFor(() => expect(mockedSearch).toHaveBeenCalledTimes(2));
    fireEvent.click(await screen.findByRole('button', { name: 'Create Experience' }));

    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1));
    expect(mockedCreate.mock.calls[0][0]).toMatchObject({ latitude: pin.lat, longitude: pin.lng });
    mockedSearch.mockImplementation(async () => []);
  });

  it('moves a pin a lookup placed when the name is replaced after reopening', async () => {
    mockedSearch.mockImplementation(async (query: string) => [query.startsWith('Minaret') ? JAM : BAMIYAN]);
    mockedCreate.mockResolvedValue({ id: 901 });
    const { closeAndReopen } = renderKept(1);

    fireEvent.change(nameBox(), { target: { value: 'Minaret of Jam' } });
    fireEvent.click(screen.getByRole('button', { name: 'Look up' }));
    await waitFor(() => expect(mockedSearch).toHaveBeenCalledTimes(1));
    closeAndReopen();

    // Replaced by clearing it first, which forgets the last lookup.
    fireEvent.change(nameBox(), { target: { value: '' } });
    fireEvent.change(nameBox(), { target: { value: 'Buddhas of Bamiyan' } });
    fireEvent.click(screen.getByRole('button', { name: 'Look up' }));
    await waitFor(() => expect(mockedSearch).toHaveBeenCalledTimes(2));
    fireEvent.click(await screen.findByRole('button', { name: 'Create Experience' }));

    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1));
    expect(mockedCreate.mock.calls[0][0]).toMatchObject({
      name: 'Buddhas of Bamiyan', latitude: BAMIYAN.lat, longitude: BAMIYAN.lng,
    });
    mockedSearch.mockImplementation(async () => []);
  });
});
