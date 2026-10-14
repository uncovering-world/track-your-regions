/**
 * The new-place dialog goes through the form layer (ADR-0076, #1129).
 *
 * The rules themselves are held by `useEditForm.test.tsx`; this holds that the
 * dialog's create reaches them: what a curator left blank is not sent, and a
 * refusal lands on the field it names — the coordinates box for `latitude`,
 * which the body splits out of one field — or, naming none, above the button.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

// The picker draws a map, which happy-dom cannot; here it only has to set the pin.
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
import { searchPlaces, suggestImageUrl } from '../../api/geocode';
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
    await waitFor(() => expect(mockedSearch).toHaveBeenCalledWith('Minaret of Jam Afghanistan', 1));
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

/**
 * The location a lookup fills in (#270): the matched item's own coordinate
 * where the item is the place — no place was found, or the item is the one the
 * found place links to — and the found place's point otherwise; a lookup that
 * finds neither says so. The place search is asked with the region's name first and
 * by the name alone when that finds nothing: *Europe*, the region the defect
 * was found in, is no part of an address, and "Charles Bridge Europe" finds
 * nothing.
 */
describe('the location a lookup fills in', () => {
  const mockedSearch = searchPlaces as unknown as ReturnType<typeof vi.fn>;
  const mockedSuggest = suggestImageUrl as unknown as ReturnType<typeof vi.fn>;
  // Charles Bridge as Wikidata holds it (Q204871), with its coordinate (P625).
  const CHARLES_BRIDGE = {
    imageUrl: 'https://commons.wikimedia.org/wiki/Special:FilePath/Prague%2007-2016%20View%20from%20Petrinska%20Tower%20img2.jpg',
    source: 'wikidata_search',
    entityLabel: 'Charles Bridge',
    wikidataId: 'Q204871',
    description: 'bridge in Prague, Czech Republic',
    coordinates: { lat: 50.086388888889, lng: 14.411944444444 },
  };
  // The Mona Lisa (Q12418): a picture and a description, and no coordinate of its own.
  const MONA_LISA = {
    imageUrl: 'https://commons.wikimedia.org/wiki/Special:FilePath/Mona%20Lisa%2C%20by%20Leonardo%20da%20Vinci%2C%20from%20C2RMF%20retouched.jpg',
    source: 'wikidata_search',
    entityLabel: 'Mona Lisa',
    wikidataId: 'Q12418',
    description: 'oil painting by Leonardo da Vinci in the Louvre, Paris',
  };

  beforeEach(() => {
    mockedSearch.mockReset();
    mockedSearch.mockImplementation(async () => []);
    mockedSuggest.mockReset();
  });
  afterEach(() => {
    mockedSuggest.mockImplementation(async () => { throw new Error('No image found'); });
  });

  function renderIn(regionName: string) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <AddExperienceDialog open onClose={vi.fn()} regionId={7} regionName={regionName} defaultKindId={1} />
      </QueryClientProvider>,
    );
  }
  function lookUpIn(regionName: string, name: string) {
    renderIn(regionName);
    fireEvent.change(screen.getByRole('textbox', { name: /^Name/ }), { target: { value: name } });
    fireEvent.click(screen.getByRole('button', { name: 'Look up' }));
  }
  const lookUpInEurope = (name: string) => lookUpIn('Europe', name);

  it("asks once, with the region's name, where the search can use it", async () => {
    // What Nominatim answers for "Old Town Hall Czechia": Brno's, where the name
    // alone finds the one in Hemel Hempstead.
    const BRNO = { display_name: 'Stará radnice, Mečová, Brno-město', lat: 49.193013, lng: 16.6080704, type: 'townhall', wikidataId: 'Q439347' };
    mockedSearch.mockImplementation(async (query: string) => (query === 'Old Town Hall Czechia' ? [BRNO] : []));
    mockedSuggest.mockImplementation(async () => { throw new Error('No image found'); });
    mockedCreate.mockResolvedValue({ id: 904 });
    lookUpIn('Czechia', 'Old Town Hall');

    expect(await screen.findByText(/Found: Stará radnice/)).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Create Experience' }));

    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1));
    expect(mockedSearch.mock.calls).toEqual([['Old Town Hall Czechia', 1]]);
    expect(mockedCreate.mock.calls[0][0]).toMatchObject({ latitude: BRNO.lat, longitude: BRNO.lng });
  });

  it("asks again by the name alone where the region's name finds nothing", async () => {
    // Karlův most as Nominatim answers "Charles Bridge", linked to Q204871.
    const KARLUV_MOST = { display_name: 'Karlův most, Křižovnické náměstí, Staré Město', lat: 50.0866258, lng: 14.4101485, type: 'bridge', wikidataId: 'Q204871' };
    mockedSearch.mockImplementation(async (query: string) => (query === 'Charles Bridge' ? [KARLUV_MOST] : []));
    mockedSuggest.mockImplementation(async () => ({ ...CHARLES_BRIDGE, source: 'wikidata_direct' }));
    mockedCreate.mockResolvedValue({ id: 905 });
    lookUpInEurope('Charles Bridge');

    expect(await screen.findByText('Charles Bridge', { selector: 'strong' })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Create Experience' }));

    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1));
    expect(mockedSearch.mock.calls).toEqual([['Charles Bridge Europe', 1], ['Charles Bridge', 1]]);
    expect(mockedSuggest).toHaveBeenCalledWith(expect.objectContaining({ wikidataId: 'Q204871' }));
    // The item's own coordinate, not Nominatim's point for the same bridge.
    expect(mockedCreate.mock.calls[0][0]).toMatchObject({ latitude: 50.086388888889, longitude: 14.411944444444 });
  });

  it("places the pin at the matched item's coordinate when the place search finds nothing", async () => {
    mockedSuggest.mockImplementation(async () => CHARLES_BRIDGE);
    mockedCreate.mockResolvedValue({ id: 903 });
    lookUpInEurope('Charles Bridge');

    expect(await screen.findByText('Charles Bridge', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.queryByText(/No location found/)).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Create Experience' }));

    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1));
    expect(mockedCreate.mock.calls[0][0]).toMatchObject({
      name: 'Charles Bridge', latitude: 50.086388888889, longitude: 14.411944444444, regionId: 7,
    });
  });

  it('says beside the match that no location was found, until the curator sets one', async () => {
    mockedSuggest.mockImplementation(async () => MONA_LISA);
    lookUpInEurope('Mona Lisa');

    expect(await screen.findByText('Mona Lisa', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText(/No location found/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create Experience' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Drop pin' }));
    expect(screen.queryByText(/No location found/)).not.toBeInTheDocument();
  });

  it('says no location was found when nothing matched at all', async () => {
    mockedSuggest.mockImplementation(async () => { throw new Error('No image found'); });
    lookUpInEurope('Charles Bridge');

    expect(await screen.findByText(/No location found/)).toBeInTheDocument();
  });

  it('keeps a pin the curator drops while the lookup runs', async () => {
    let answer!: (suggestion: typeof CHARLES_BRIDGE) => void;
    mockedSuggest.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
    mockedCreate.mockResolvedValue({ id: 906 });
    pin = { lat: 50.0865, lng: 14.4114 };
    lookUpInEurope('Charles Bridge');

    await waitFor(() => expect(mockedSuggest).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Drop pin' }));
    answer(CHARLES_BRIDGE);
    expect(await screen.findByText('Charles Bridge', { selector: 'strong' })).toBeInTheDocument();

    // The pin is the curator's, not the lookup's: a lookup asked again leaves it.
    mockedSuggest.mockImplementation(async () => CHARLES_BRIDGE);
    fireEvent.click(await screen.findByRole('button', { name: 'Look up again' }));
    await waitFor(() => expect(mockedSuggest).toHaveBeenCalledTimes(2));
    fireEvent.click(await screen.findByRole('button', { name: 'Create Experience' }));

    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1));
    expect(mockedCreate.mock.calls[0][0]).toMatchObject({ latitude: pin.lat, longitude: pin.lng });
  });

  it("keeps the found place's point over an item matched by the bare name elsewhere", async () => {
    // Brno's Old Town Hall as Nominatim answers "Old Town Hall Czechia", here
    // without its wikidata tag; the name layer then matches Hanover's (Q439391).
    const BRNO = { display_name: 'Stará radnice, Mečová, Brno-město', lat: 49.193013, lng: 16.6080704, type: 'townhall', wikidataId: null };
    const HANOVER = {
      imageUrl: 'https://commons.wikimedia.org/wiki/Special:FilePath/L1040840b%20Altes%20Rathaus%20Hannover%20v%20W.jpg',
      source: 'wikidata_search',
      entityLabel: 'Old Town Hall',
      wikidataId: 'Q439391',
      description: 'old town hall in Hanover, Germany',
      coordinates: { lat: 52.37122549513791, lng: 9.736017726780437 },
    };
    mockedSearch.mockImplementation(async (query: string) => (query === 'Old Town Hall Czechia' ? [BRNO] : []));
    mockedSuggest.mockImplementation(async () => HANOVER);
    mockedCreate.mockResolvedValue({ id: 907 });
    lookUpIn('Czechia', 'Old Town Hall');

    // The match is still shown for the curator to judge; only the pin stays.
    expect(await screen.findByText('(Q439391)', { exact: false })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Create Experience' }));

    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1));
    expect(mockedCreate.mock.calls[0][0]).toMatchObject({ latitude: BRNO.lat, longitude: BRNO.lng });
  });

  it("places the pin at the matched item's coordinate and keeps the curator's own picture", async () => {
    const own = 'https://commons.wikimedia.org/wiki/Special:FilePath/Karl%C5%AFv%20most%20at%20dawn.jpg';
    mockedSuggest.mockImplementation(async () => CHARLES_BRIDGE);
    mockedCreate.mockResolvedValue({ id: 908 });
    renderIn('Europe');
    fireEvent.change(screen.getByRole('textbox', { name: /^Image URL/ }), { target: { value: own } });
    fireEvent.change(screen.getByRole('textbox', { name: /^Name/ }), { target: { value: 'Charles Bridge' } });
    fireEvent.click(screen.getByRole('button', { name: 'Look up' }));

    expect(await screen.findByText('Charles Bridge', { selector: 'strong' })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Create Experience' }));

    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1));
    expect(mockedCreate.mock.calls[0][0]).toMatchObject({
      latitude: 50.086388888889, longitude: 14.411944444444, imageUrl: own,
    });
  });

  it('does not suggest by an item a lookup took for another name', async () => {
    // The Minaret of Jam as Nominatim answers it, linked to Q192981.
    const JAM = { display_name: 'Minaret of Jam, Ghor, Afghanistan', lat: 34.3964, lng: 64.5161, type: 'tower', wikidataId: 'Q192981' };
    mockedSearch.mockImplementation(async (query: string) => (query.startsWith('Minaret') ? [JAM] : []));
    mockedSuggest.mockImplementation(async () => { throw new Error('No image found'); });
    lookUpIn('Afghanistan', 'Minaret of Jam');
    await waitFor(() => expect(mockedSuggest).toHaveBeenCalledTimes(1));

    // A new name the place search finds nothing for: the minaret's id goes with it.
    fireEvent.change(screen.getByRole('textbox', { name: /^Name/ }), { target: { value: 'Buddhas of Bamiyan' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Look up again' }));
    await waitFor(() => expect(mockedSuggest).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Suggest' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Suggest' }));

    await waitFor(() => expect(mockedSuggest).toHaveBeenCalledTimes(3));
    expect(mockedSuggest.mock.calls[2][0].wikidataId).toBeUndefined();
  });
});
