/**
 * A place's kinds on its curation dialog, taking it out of one (#2022) and
 * adding it to one no run offers it in (#2035). The Temple of Concord is
 * offered by Places of worship and by Archaeology; the Theatre of Pompey by
 * Archaeology alone; the East Side Gallery, which Wikidata types an art
 * museum, is kept out of Art Museums by its rule and, here, in no other kind.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PlaceKindStanding } from '../../api/curation';

vi.mock('../../utils/queryInvalidation', () => ({ invalidateExperiences: vi.fn() }));
vi.mock('../../api/curation', () => ({
  fetchPlaceKinds: vi.fn(),
  keepOutOfKind: vi.fn(),
  setExperienceAdmission: vi.fn(),
  addToKind: vi.fn(),
}));

import { addToKind, fetchPlaceKinds, keepOutOfKind, setExperienceAdmission } from '../../api/curation';
import { PlaceKinds } from './PlaceKinds';

const mockedKinds = vi.mocked(fetchPlaceKinds);
const mockedKeepOut = vi.mocked(keepOutOfKind);
const mockedPutBack = vi.mocked(setExperienceAdmission);
const mockedAdd = vi.mocked(addToKind);

const WORSHIP: PlaceKindStanding = {
  membershipId: 3529, kindId: 4, kindName: 'Places of worship', type: 'temple', state: 'offered',
  reason: null, added: false, answeredAt: null, note: null, curatorName: null, canAnswer: true, crowding: null,
};
const ARCHAEOLOGY: PlaceKindStanding = {
  ...WORSHIP, membershipId: 5039, kindId: 5, kindName: 'Archaeology', type: null,
};

function show(experienceId = 13761, unsavedEdits = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <PlaceKinds experienceId={experienceId} regionId={5} unsavedEdits={unsavedEdits} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("a place's kinds on its curation dialog", () => {
  beforeEach(() => {
    mockedKinds.mockReset();
    mockedKeepOut.mockReset();
    mockedPutBack.mockReset();
    mockedAdd.mockReset();
  });

  it('links a kind that shows a crowded city’s best known to the Crowded cities tab, open on the place (#2487)', async () => {
    // Schloßplatz in Berlin: a square of Squares & streets, 22 squares within 10 km, and in Public art, which has no rule.
    const SQUARES: PlaceKindStanding = {
      ...WORSHIP, membershipId: 14, kindId: 9, kindName: 'Squares & streets', type: 'square',
      crowding: { limit: 10, radiusKm: 10, around: 22, shadowed: true, outrankedBy: 13, measured: true, betterKnown: 15, measuringRun: null, measurable: true },
    };
    const PUBLIC_ART: PlaceKindStanding = { ...WORSHIP, membershipId: 15, kindId: 3, kindName: 'Public art', type: null };
    mockedKinds.mockResolvedValue({ kinds: [SQUARES, PUBLIC_ART], addable: [] });
    show(1014);

    expect(await screen.findByRole('link', { name: 'Squares around (22)' })).toHaveAttribute('href', '/review?view=crowded&place=14');
    expect(screen.getAllByRole('link', { name: /around \(/ })).toHaveLength(1);
  });

  it('holds the crowded city’s link while the dialog has unsaved edits, which leaving would drop (#2487)', async () => {
    const SQUARES: PlaceKindStanding = {
      ...WORSHIP, membershipId: 14, kindId: 9, kindName: 'Squares & streets', type: 'square',
      crowding: { limit: 10, radiusKm: 10, around: 22, shadowed: true, outrankedBy: 13, measured: true, betterKnown: 15, measuringRun: null, measurable: true },
    };
    mockedKinds.mockResolvedValue({ kinds: [SQUARES], addable: [] });
    show(1014, true);

    expect(await screen.findByRole('button', { name: 'Squares around (22)' })).toBeDisabled();
    expect(screen.queryByRole('link', { name: 'Squares around (22)' })).toBeNull();
  });

  it('lists each kind with its type and where it stands', async () => {
    mockedKinds.mockResolvedValue({ kinds: [WORSHIP, ARCHAEOLOGY], addable: [] });
    show();

    expect(await screen.findByText('Places of worship')).toBeTruthy();
    expect(screen.getByText('temple · offered')).toBeTruthy();
    expect(screen.getByText('offered')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Take out' })).toHaveLength(2);
  });

  it('offers a refusal\'s reasons, says it stays in the others, and takes it out with the one picked (#863)', async () => {
    mockedKinds.mockResolvedValue({ kinds: [WORSHIP, ARCHAEOLOGY], addable: [] });
    mockedKeepOut.mockResolvedValue({ experienceId: 13761, membershipId: 5039, admission: 'refused' });
    show();

    fireEvent.click((await screen.findAllByRole('button', { name: 'Take out' }))[1]);
    expect(screen.getByText('It leaves Archaeology and stays in its other kinds.')).toBeTruthy();
    expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual([
      'Not this kind of place', 'Nothing to see', 'Not one place', 'Gone or not built', 'Same as another', 'Wrong place',
      'Other…',
    ]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Nothing to see' }));

    // The region the curator has open goes with the act, for its log entry.
    await waitFor(() => expect(mockedKeepOut).toHaveBeenCalledWith(13761, {
      membershipId: 5039, reasonCode: 'not-worth-a-visit', regionId: 5,
    }));
  });

  it('keeps the curator\'s words under Other…', async () => {
    mockedKinds.mockResolvedValue({ kinds: [ARCHAEOLOGY, WORSHIP], addable: [] });
    mockedKeepOut.mockResolvedValue({ experienceId: 13761, membershipId: 5039, admission: 'refused' });
    show();

    fireEvent.click((await screen.findAllByRole('button', { name: 'Take out' }))[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Other…' }));
    fireEvent.change(screen.getByLabelText('A few words'), { target: { value: 'Not a must: only the podium is left' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Take out' }));

    await waitFor(() => expect(mockedKeepOut).toHaveBeenCalledWith(13761, {
      membershipId: 5039, reasonCode: 'other', note: 'Not a must: only the podium is left', regionId: 5,
    }));
  });

  it('warns that taking out the only kind hides the place everywhere', async () => {
    mockedKinds.mockResolvedValue({ kinds: [{ ...ARCHAEOLOGY, membershipId: 4877 }], addable: [] });
    show(15110);

    fireEvent.click(await screen.findByRole('button', { name: 'Take out' }));
    expect(screen.getByText(/Its only kind: it leaves every list, the map and the counts/)).toBeTruthy();
  });

  it('sends no region where none is open', async () => {
    mockedKinds.mockResolvedValue({ kinds: [ARCHAEOLOGY], addable: [] });
    mockedKeepOut.mockResolvedValue({ experienceId: 13761, membershipId: 5039, admission: 'refused' });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <MemoryRouter>
        <QueryClientProvider client={client}><PlaceKinds experienceId={13761} regionId={null} /></QueryClientProvider>
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Take out' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Gone or not built' }));

    await waitFor(() => expect(mockedKeepOut).toHaveBeenCalled());
    expect(mockedKeepOut.mock.calls[0][1].regionId).toBeUndefined();
  });

  it('says who kept a kind out and why, and puts it back with the override and the reason picked', async () => {
    mockedKinds.mockResolvedValue({ kinds: [WORSHIP, {
      ...ARCHAEOLOGY, state: 'kept-out', reason: 'kept out by a curator', answeredAt: '2026-10-25T12:00:00Z',
      note: 'Not a must: only the podium is left', curatorName: 'Ada',
    }], addable: [] });
    mockedPutBack.mockResolvedValue({} as Awaited<ReturnType<typeof setExperienceAdmission>>);
    show();

    expect(await screen.findByText(/kept out by Ada ·/)).toBeTruthy();
    expect(screen.getByText('“Not a must: only the podium is left”')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Put back' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'The rule missed it' }));
    await waitFor(() => expect(mockedPutBack).toHaveBeenCalledWith(13761, {
      decision: 'override', membershipId: 5039, reasonCode: 'missing-from-rule', regionId: 5,
    }));
  });

  it('offers nothing on a kind outside the caller\'s scope, an arrival or a rule\'s refusal', async () => {
    mockedKinds.mockResolvedValue({ kinds: [
      { ...WORSHIP, canAnswer: false },
      { ...ARCHAEOLOGY, state: 'waiting' },
      { ...ARCHAEOLOGY, membershipId: 1, kindName: 'Public art', state: 'refused', reason: 'no public art class' },
    ], addable: [] });
    show();

    expect(await screen.findByText('waiting for a curator, on the review page')).toBeTruthy();
    expect(screen.getByText('kept out by its rule: no public art class')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Take out' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Put back' })).toBeNull();
  });

  describe('adding the place to a kind no run offers it in', () => {
    const ART_MUSEUMS: PlaceKindStanding = {
      ...WORSHIP, membershipId: 6301, kindId: 2, kindName: 'Art Museums', type: null, state: 'refused',
      reason: 'a stretch of the Berlin Wall that Wikidata types art museum',
    };
    const ADDABLE = [{ kindId: 3, kindName: 'Public art' }, { kindId: 6, kindName: 'Monuments & memorials' }];

    async function choose(label: string, option: string) {
      fireEvent.mouseDown(await screen.findByRole('combobox', { name: label }));
      fireEvent.click(await screen.findByRole('option', { name: option }));
    }

    /** The Kind and its Type chosen for Public art: street art. */
    async function chooseStreetArt() {
      fireEvent.click(await screen.findByRole('button', { name: '+ Add to a kind…' }));
      await choose('Kind', 'Public art');
      expect(screen.getByText(/Readers find it in Public art from now on/)).toBeTruthy();
      // A kind with types waits for one, as a run files every place under one.
      expect((screen.getByRole('button', { name: 'Add to Public art' }) as HTMLButtonElement).disabled).toBe(true);
      await choose('Type', 'Street art');
    }

    it('files it under the kind and type chosen, with the reason picked and the open region (#863)', async () => {
      mockedKinds.mockResolvedValue({ kinds: [ART_MUSEUMS], addable: ADDABLE });
      mockedAdd.mockResolvedValue({ experienceId: 6285, membershipId: 41450, kindId: 3 });
      show(6285);

      await chooseStreetArt();
      fireEvent.click(screen.getByRole('button', { name: 'Add to Public art' }));
      expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['The rule missed it', 'Other…']);
      fireEvent.click(screen.getByRole('menuitem', { name: 'The rule missed it' }));

      await waitFor(() => expect(mockedAdd).toHaveBeenCalledWith(6285, {
        kindId: 3, type: 'street-art', reasonCode: 'missing-from-rule', regionId: 5,
      }));
    });

    it("keeps the curator's words under Other…", async () => {
      mockedKinds.mockResolvedValue({ kinds: [ART_MUSEUMS], addable: ADDABLE });
      mockedAdd.mockResolvedValue({ experienceId: 6285, membershipId: 41450, kindId: 3 });
      show(6285);

      await chooseStreetArt();
      fireEvent.click(screen.getByRole('button', { name: 'Add to Public art' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Other…' }));
      fireEvent.change(screen.getByLabelText('A few words'), { target: { value: 'A mile of murals on the Berlin Wall' } });
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add to Public art' }));

      await waitFor(() => expect(mockedAdd).toHaveBeenCalledWith(6285, {
        kindId: 3, type: 'street-art', reasonCode: 'other', note: 'A mile of murals on the Berlin Wall', regionId: 5,
      }));
    });

    it('says who added a kind, and offers taking it out again', async () => {
      mockedKinds.mockResolvedValue({ kinds: [{
        ...WORSHIP, membershipId: 41450, kindId: 3, kindName: 'Public art', type: 'street-art', added: true,
        answeredAt: '2026-10-26T12:00:00Z', note: 'A mile of murals on the Berlin Wall', curatorName: 'Ada',
      }, ART_MUSEUMS], addable: [] });
      show(6285);

      expect(await screen.findByText(/added by Ada ·/)).toBeTruthy();
      expect(screen.getByText('street art · offered')).toBeTruthy();
      expect(screen.getByText('“A mile of murals on the Berlin Wall”')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Take out' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: '+ Add to a kind…' })).toBeNull();
    });

    it('shows the section for a place in no kind yet, with only the add', async () => {
      mockedKinds.mockResolvedValue({ kinds: [], addable: ADDABLE });
      show(6285);

      expect(await screen.findByRole('button', { name: '+ Add to a kind…' })).toBeTruthy();
      expect(screen.getByText('Kinds')).toBeTruthy();
    });
  });
});
