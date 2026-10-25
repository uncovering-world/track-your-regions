/**
 * A place's kinds on its curation dialog, and taking it out of one (#2022).
 * The Temple of Concord is offered by Places of worship and by Archaeology;
 * the Theatre of Pompey by Archaeology alone.
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
}));

import { fetchPlaceKinds, keepOutOfKind, setExperienceAdmission } from '../../api/curation';
import { PlaceKinds } from './PlaceKinds';

const mockedKinds = vi.mocked(fetchPlaceKinds);
const mockedKeepOut = vi.mocked(keepOutOfKind);
const mockedPutBack = vi.mocked(setExperienceAdmission);

const WORSHIP: PlaceKindStanding = {
  membershipId: 3529, kindId: 4, kindName: 'Places of worship', type: 'temple', state: 'offered',
  reason: null, answeredAt: null, note: null, curatorName: null, canAnswer: true,
};
const ARCHAEOLOGY: PlaceKindStanding = {
  ...WORSHIP, membershipId: 5039, kindId: 5, kindName: 'Archaeology', type: null,
};

function show(experienceId = 13761) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><PlaceKinds experienceId={experienceId} regionId={5} /></QueryClientProvider>);
}

describe("a place's kinds on its curation dialog", () => {
  beforeEach(() => {
    mockedKinds.mockReset();
    mockedKeepOut.mockReset();
    mockedPutBack.mockReset();
  });

  it('lists each kind with its type and where it stands', async () => {
    mockedKinds.mockResolvedValue({ kinds: [WORSHIP, ARCHAEOLOGY] });
    show();

    expect(await screen.findByText('Places of worship')).toBeTruthy();
    expect(screen.getByText('temple · offered')).toBeTruthy();
    expect(screen.getByText('offered')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Take out…' })).toHaveLength(2);
  });

  it("takes the place out of one kind with the curator's note, after saying it stays in the others", async () => {
    mockedKinds.mockResolvedValue({ kinds: [WORSHIP, ARCHAEOLOGY] });
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
    mockedKinds.mockResolvedValue({ kinds: [{ ...ARCHAEOLOGY, membershipId: 4877 }] });
    show(15110);

    fireEvent.click(await screen.findByRole('button', { name: 'Take out…' }));
    expect(screen.getByText(/Archaeology is the only kind that offers it/)).toBeTruthy();
  });

  it('says who kept a kind out and why, and puts it back with the override', async () => {
    mockedKinds.mockResolvedValue({ kinds: [WORSHIP, {
      ...ARCHAEOLOGY, state: 'kept-out', reason: 'kept out by a curator', answeredAt: '2026-10-25T12:00:00Z',
      note: 'Not a must: only the podium is left', curatorName: 'Ada',
    }] });
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
    ] });
    show();

    expect(await screen.findByText('waiting for a curator, on the review page')).toBeTruthy();
    expect(screen.getByText('kept out by its rule: no public art class')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Take out…' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Put it back' })).toBeNull();
  });
});
