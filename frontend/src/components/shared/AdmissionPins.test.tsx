/**
 * A curator's admission pins, shown and handed back (#1369). Villa Farnesina was
 * put back into Art Museums over "probe: site class villa"; the British Museum
 * was kept out of it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AdmissionPin } from '../../api/curation';

vi.mock('../../utils/queryInvalidation', () => ({ invalidateExperiences: vi.fn() }));
vi.mock('../../api/curation', () => ({ fetchAdmissionPins: vi.fn(), handBackAdmissionPin: vi.fn() }));

import { fetchAdmissionPins, handBackAdmissionPin } from '../../api/curation';
import { PinnedAnswers, PlacePins } from './AdmissionPins';

const mockedPins = fetchAdmissionPins as unknown as ReturnType<typeof vi.fn>;
const mockedHandBack = handBackAdmissionPin as unknown as ReturnType<typeof vi.fn>;

const FARNESINA: AdmissionPin = {
  experienceId: 6287, name: 'Villa Farnesina', membershipId: 6260, kindName: 'Art Museums', answer: 'admitted',
  answeredReason: 'probe: site class villa', answeredAt: '2026-08-08T18:29:09Z', note: 'Raphael’s frescoes',
  systemNote: null, curatorName: 'Ada', added: false, questioned: false, canHandBack: true,
};
const BRITISH: AdmissionPin = {
  ...FARNESINA, experienceId: 6205, name: 'British Museum', membershipId: 6178, answer: 'refused',
  answeredReason: 'editorial exclusion: British Museum', note: null, curatorName: null, questioned: true,
};

function show(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('admission pins', () => {
  beforeEach(() => {
    mockedPins.mockReset();
    mockedHandBack.mockReset();
  });

  it("names on a place who answered what, when, and with which note, and what handing back leaves to the run", async () => {
    mockedPins.mockResolvedValue({ pins: [FARNESINA], more: false });
    show(<PlacePins experienceId={6287} regionId={5} />);

    expect(await screen.findByText(/Ada put it back in Art Museums on .* — “Raphael’s frescoes”/)).toBeTruthy();
    expect(screen.getByText(/stays in Art Museums until the next run; a run that still turns it down asks you again/)).toBeTruthy();
    expect(mockedPins).toHaveBeenCalledWith(6287);
  });

  it("says what the system recorded about an answer apart from the curator's words (#2195)", async () => {
    mockedPins.mockResolvedValue({ pins: [{
      ...FARNESINA, name: 'Equestrian statue of Gattamelata', kindName: 'Public art', note: null,
      systemNote: 'kept when the batch answer of 14 September 2026 was read',
    }], more: false });
    show(<PlacePins experienceId={6287} regionId={null} />);
    expect(await screen.findByText(/recorded by the system: kept when the batch answer of 14 September 2026 was read/)).toBeInTheDocument();
    expect(screen.queryByText(/“/)).not.toBeInTheDocument();
  });

  it('says a curator added a place no rule turned down, once a run lists it', async () => {
    mockedPins.mockResolvedValue({ pins: [{
      ...FARNESINA, experienceId: 6285, name: 'East Side Gallery', membershipId: 41450, kindName: 'Public art',
      answeredReason: null, note: 'A mile of murals on the Berlin Wall', added: true,
    }], more: false });
    show(<PlacePins experienceId={6285} regionId={5} />);

    expect(await screen.findByText(/Ada added it to Public art on .* — “A mile of murals on the Berlin Wall”/)).toBeTruthy();
  });

  it('hands a pin back for the membership it is on', async () => {
    mockedPins.mockResolvedValue({ pins: [FARNESINA], more: false });
    mockedHandBack.mockResolvedValue({ experienceId: 6287, membershipId: 6260, admission: 'admitted' });
    show(<PlacePins experienceId={6287} regionId={5} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Hand the pin back' }));
    await waitFor(() => expect(mockedHandBack).toHaveBeenCalledWith(6287, { membershipId: 6260 }));
  });

  it('shows nothing on a place with no pin', async () => {
    mockedPins.mockResolvedValue({ pins: [], more: false });
    show(<PlacePins experienceId={1} regionId={null} />);
    await waitFor(() => expect(mockedPins).toHaveBeenCalled());
    expect(screen.queryByText(/Pinned against/)).toBeNull();
  });

  it("lists every pin in scope on the review page, collapsed, naming a curator it may not name as 'A curator'", async () => {
    mockedPins.mockResolvedValue({ pins: [FARNESINA, BRITISH], more: false });
    show(<PinnedAnswers />);

    fireEvent.click(await screen.findByRole('button', { name: 'Show the answers pinned against a rule (2)' }));
    expect(screen.getByText('British Museum')).toBeTruthy();
    expect(screen.getByText(/A curator kept it out of Art Museums/)).toBeTruthy();
    // A kept-out answer agreed with the rule; a put-back stood against it.
    expect(screen.getByText('as the rule had decided:')).toBeTruthy();
    expect(screen.getByText('against the rule’s objection:')).toBeTruthy();
    expect(screen.getByText(/A run asks again about this answer/)).toBeTruthy();
  });

  it("offers no hand-back on a curator's own refusal of an arrival, and says the put-back is its way back", async () => {
    mockedPins.mockResolvedValue({ pins: [{ ...BRITISH, answer: 'refused', answeredReason: null, canHandBack: false }], more: false });
    show(<PlacePins experienceId={6205} regionId={null} />);

    expect(await screen.findByText(/put it back from the place’s Kinds or the kept-out list/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Hand the pin back' })).toBeNull();
  });

  it('groups the review page list under its kinds', async () => {
    mockedPins.mockResolvedValue({
      pins: [FARNESINA, { ...FARNESINA, membershipId: 1, name: 'Victory Arch', kindName: 'Public art' }],
      more: false,
    });
    show(<PinnedAnswers />);
    fireEvent.click(await screen.findByRole('button', { name: 'Show the answers pinned against a rule (2)' }));
    expect(screen.getByText('Art Museums')).toBeTruthy();
    expect(screen.getByText('Public art')).toBeTruthy();
  });
});
