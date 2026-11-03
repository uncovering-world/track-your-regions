/**
 * A place's kinds on its curation dialog, taking it out of one (#2022) and
 * adding it to one no run offers it in (#2035). The Temple of Concord is
 * offered by Places of worship and by Archaeology; the Theatre of Pompey by
 * Archaeology alone; the East Side Gallery, which Wikidata types an art
 * museum, is kept out of Art Museums by its rule and, here, in no other kind.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PlaceKindStanding } from '../../api/curation';

vi.mock('../../utils/queryInvalidation', () => ({ invalidateExperiences: vi.fn() }));
vi.mock('../../api/curation', () => ({
  fetchPlaceKinds: vi.fn(),
  keepOutOfKind: vi.fn(),
  setExperienceAdmission: vi.fn(),
  addToKind: vi.fn(),
}));

/** The crowded city's window, as the row opens it: on which membership, and what it reports on close. */
function CrowdingWindowStub({ memberships, onClose }: { memberships: readonly number[]; onClose: (message?: string) => void }) {
  return (
    <div data-testid="crowding-window">
      {`around ${memberships.join(',')}`}
      <button type="button" onClick={() => onClose('1 place kept in the list: Schloßplatz.')}>apply and close</button>
    </div>
  );
}

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

function show(experienceId = 13761) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PlaceKinds experienceId={experienceId} regionId={5} crowdingWindow={CrowdingWindowStub} />
    </QueryClientProvider>,
  );
}

describe("a place's kinds on its curation dialog", () => {
  beforeEach(() => {
    mockedKinds.mockReset();
    mockedKeepOut.mockReset();
    mockedPutBack.mockReset();
    mockedAdd.mockReset();
  });

  it('opens the crowded city’s window from a kind that shows a crowded city’s best known', async () => {
    // Schloßplatz in Berlin: a square of Squares & streets, 22 squares within 10 km, and in Public art, which has no rule.
    const SQUARES: PlaceKindStanding = {
      ...WORSHIP, membershipId: 14, kindId: 9, kindName: 'Squares & streets', type: 'square',
      crowding: { limit: 10, radiusKm: 10, around: 22, shadowed: true, outrankedBy: 13 },
    };
    const PUBLIC_ART: PlaceKindStanding = { ...WORSHIP, membershipId: 15, kindId: 3, kindName: 'Public art', type: null };
    mockedKinds.mockResolvedValue({ kinds: [SQUARES, PUBLIC_ART], addable: [] });
    show(1014);

    fireEvent.click(await screen.findByRole('button', { name: 'Squares around (22)' }));
    expect(screen.getAllByRole('button', { name: /around \(/ })).toHaveLength(1);
    expect(screen.getByTestId('crowding-window')).toHaveTextContent('around 14');

    fireEvent.click(screen.getByRole('button', { name: 'apply and close' }));
    expect(screen.queryByTestId('crowding-window')).toBeNull();
    expect(screen.getByText('1 place kept in the list: Schloßplatz.')).toBeTruthy();
    // The kinds are read again: an answer can publish the place or move it to the shadow.
    await waitFor(() => expect(mockedKinds).toHaveBeenCalledTimes(2));
  });

  it('lists each kind with its type and where it stands', async () => {
    mockedKinds.mockResolvedValue({ kinds: [WORSHIP, ARCHAEOLOGY], addable: [] });
    show();

    expect(await screen.findByText('Places of worship')).toBeTruthy();
    expect(screen.getByText('temple · offered')).toBeTruthy();
    expect(screen.getByText('offered')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Take out…' })).toHaveLength(2);
  });

  it("takes the place out of one kind with the curator's note, after saying it stays in the others", async () => {
    mockedKinds.mockResolvedValue({ kinds: [WORSHIP, ARCHAEOLOGY], addable: [] });
    mockedKeepOut.mockResolvedValue({ experienceId: 13761, membershipId: 5039, admission: 'refused' });
    show();

    fireEvent.click((await screen.findAllByRole('button', { name: 'Take out…' }))[1]);
    expect(screen.getByText(/leaves Archaeology’s lists, counts and map now, and stays in its other kinds/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Why (optional, kept in its history)'), {
      target: { value: 'Not a must: only the podium is left' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Take out of Archaeology' }));

    await waitFor(() => expect(mockedKeepOut).toHaveBeenCalledWith(13761, {
      membershipId: 5039, note: 'Not a must: only the podium is left',
    }));
  });

  it('warns that taking out the only kind hides the place everywhere', async () => {
    mockedKinds.mockResolvedValue({ kinds: [{ ...ARCHAEOLOGY, membershipId: 4877 }], addable: [] });
    show(15110);

    fireEvent.click(await screen.findByRole('button', { name: 'Take out…' }));
    expect(screen.getByText(/Archaeology is the only kind that offers it/)).toBeTruthy();
  });

  it('says who kept a kind out and why, and puts it back with the override', async () => {
    mockedKinds.mockResolvedValue({ kinds: [WORSHIP, {
      ...ARCHAEOLOGY, state: 'kept-out', reason: 'kept out by a curator', answeredAt: '2026-10-25T12:00:00Z',
      note: 'Not a must: only the podium is left', curatorName: 'Ada',
    }], addable: [] });
    mockedPutBack.mockResolvedValue({} as Awaited<ReturnType<typeof setExperienceAdmission>>);
    show();

    expect(await screen.findByText(/kept out by Ada ·/)).toBeTruthy();
    expect(screen.getByText('“Not a must: only the podium is left”')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Put it back' }));
    await waitFor(() => expect(mockedPutBack).toHaveBeenCalledWith(13761, { decision: 'override', membershipId: 5039 }));
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
    expect(screen.queryByRole('button', { name: 'Take out…' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Put it back' })).toBeNull();
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

    it("files it under the kind and type chosen, with the curator's words", async () => {
      mockedKinds.mockResolvedValue({ kinds: [ART_MUSEUMS], addable: ADDABLE });
      mockedAdd.mockResolvedValue({ experienceId: 6285, membershipId: 41450, kindId: 3 });
      show(6285);

      fireEvent.click(await screen.findByRole('button', { name: '+ Add to a kind…' }));
      await choose('Kind', 'Public art');
      expect(screen.getByText(/Readers find it in Public art from now on/)).toBeTruthy();
      // A kind with types waits for one, as a run files every place under one.
      expect((screen.getByRole('button', { name: 'Add to Public art' }) as HTMLButtonElement).disabled).toBe(true);
      await choose('Type', 'Street art');
      fireEvent.change(screen.getByLabelText('Why (optional, kept in its history)'), {
        target: { value: 'A mile of murals on the Berlin Wall' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Add to Public art' }));

      await waitFor(() => expect(mockedAdd).toHaveBeenCalledWith(6285, {
        kindId: 3, type: 'street-art', note: 'A mile of murals on the Berlin Wall',
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
      expect(screen.getByRole('button', { name: 'Take out…' })).toBeTruthy();
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
