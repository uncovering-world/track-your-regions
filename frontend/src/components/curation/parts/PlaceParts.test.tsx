/**
 * The curator's *Parts* and *Part of* sections on a place's card (#2118), on
 * the development catalogue's places of 2026-11-13: the Seville site and its
 * three places, the Giralda beside them, Thessaloniki's line "Rotunda" held by
 * the Arch of Galerius and Rotunda, and the Brâncuși ensemble with no part.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PartCandidate, PartRow, PlaceParts as Parts } from '../../../api/parts';

vi.mock('../../../utils/queryInvalidation', () => ({ invalidateExperiences: vi.fn() }));
vi.mock('../../../api/parts', () => ({
  fetchPlaceParts: vi.fn(),
  findPartCandidates: vi.fn(),
  addPart: vi.fn(),
  takeOutPart: vi.fn(),
}));

import { addPart, fetchPlaceParts, findPartCandidates, takeOutPart } from '../../../api/parts';
import { PlaceParts } from './PlaceParts';

const mockedParts = vi.mocked(fetchPlaceParts);
const mockedFind = vi.mocked(findPartCandidates);
const mockedAdd = vi.mocked(addPart);
const mockedTakeOut = vi.mocked(takeOutPart);

const place = (id: number, name: string, kind: string | null): PartRow['place'] => ({
  id, name, subtitle: null, kind_name: kind, waiting: false, image_url: null, image_credit: null, longitude: 0, latitude: 0,
});
const row = (p: PartRow['place'], extra: Partial<PartRow> = {}): PartRow => ({
  place: p, in_scope: true, standing: true, list: null, statement: false, curator: null, ...extra,
});
const SEVILLE = 1175;
const CATHEDRAL = row(place(13223, 'Seville Cathedral', 'Places of worship'), { list: { reference: '383bis-001', name: null } });
const SITE: Parts = {
  experienceId: SEVILLE, name: 'Cathedral, Alcázar and Archivo de Indias in Seville', in_kind: true, merged_onto: false,
  parts: [CATHEDRAL], wholes: [],
};
const GIRALDA: PartCandidate = {
  place: place(40598, 'Giralda', 'Towers'), distance_m: 77, near_name: 'Seville Cathedral', taken: null, kept_out: false, also_part_of: null,
};

function show(experienceId = SEVILLE, isSite = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PlaceParts experienceId={experienceId} regionId={5} isSite={isSite} />
    </QueryClientProvider>,
  );
}

const answer = (act: 'added' | 'put_back' | 'taken_out') => ({
  wholeId: SEVILLE, partId: 40598, act, standing: act !== 'taken_out', keptOut: false, recordId: null, becameWhole: false,
});

describe("the Parts section of a place made of parts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedFind.mockResolvedValue({ experienceId: SEVILLE, role: 'part', near: true, candidates: [GIRALDA] });
  });

  it('says whose word makes each part, and offers the places near the parts with their distance', async () => {
    mockedParts.mockResolvedValue(SITE);
    show();
    expect(await screen.findByText('Parts (1)')).toBeInTheDocument();
    expect(screen.getByText('Named on UNESCO’s list of its places')).toBeInTheDocument();
    expect(await screen.findByText('77 m from Seville Cathedral, a part')).toBeInTheDocument();
    expect(screen.getByText('Near it')).toBeInTheDocument();
  });

  it('adds a part at once, and Undo takes it out again', async () => {
    mockedParts.mockResolvedValue(SITE);
    mockedAdd.mockResolvedValue(answer('added'));
    mockedTakeOut.mockResolvedValue(answer('taken_out'));
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Add' }));
    await waitFor(() => expect(mockedAdd).toHaveBeenCalledWith(SEVILLE, { partId: 40598, note: undefined, makesWhole: undefined }));
    expect(await screen.findByText('Giralda added as a part.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(mockedTakeOut).toHaveBeenCalledWith(SEVILLE, { partId: 40598, note: undefined }));
  });

  it('asks before taking out a part the list names, says it stays out, and keeps the reason', async () => {
    mockedParts.mockResolvedValue(SITE);
    mockedTakeOut.mockResolvedValue({ ...answer('taken_out'), partId: 13223, keptOut: true });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Take out…' }));
    expect(screen.getByText(/UNESCO’s list still names it, so later runs keep it out/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Why'), { target: { value: 'Not this one' } });
    fireEvent.click(screen.getByRole('button', { name: 'Take out of this whole' }));
    await waitFor(() => expect(mockedTakeOut).toHaveBeenCalledWith(SEVILLE, { partId: 13223, note: 'Not this one' }));
  });

  it("shows a long whole's first five parts, and the rest on asking", async () => {
    const many = Array.from({ length: 7 }, (_, i) => row(place(40500 + i, `Wudang hall ${i + 1}`, null)));
    mockedParts.mockResolvedValue({ ...SITE, experienceId: 57, parts: many });
    show(57);
    expect(await screen.findByText('Parts (7)')).toBeInTheDocument();
    expect(screen.queryByText('Wudang hall 6')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show 2 more parts' }));
    expect(screen.getByText('Wudang hall 7')).toBeInTheDocument();
  });

  it('shows a kept-out part greyed with Put it back', async () => {
    const kept = row(place(15409, 'Arch of Galerius and Rotunda', 'Archaeology'), {
      standing: false, list: { reference: '456-005', name: 'Rotunda' },
      curator: { admission: 'refused', answered_at: '2026-11-13T10:00:00Z', by_you: true, note: null },
    });
    mockedParts.mockResolvedValue({ ...SITE, experienceId: 146, parts: [kept] });
    mockedAdd.mockResolvedValue(answer('put_back'));
    show(146);
    expect(await screen.findByText('Named on UNESCO’s list of its places as “Rotunda”')).toBeInTheDocument();
    expect(screen.getByText(/^Kept out by you/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Put it back' }));
    await waitFor(() => expect(mockedAdd).toHaveBeenCalledWith(146, { partId: 15409, note: undefined, makesWhole: undefined }));
  });
});

describe("places outside the caller's scope", () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists a part outside the scope with no way to answer it, and a candidate outside it as not addable', async () => {
    const elsewhere = row(place(45934, 'Zixiao Palace', 'Places of worship'), { in_scope: false });
    mockedParts.mockResolvedValue({ ...SITE, parts: [elsewhere] });
    mockedFind.mockResolvedValue({
      experienceId: SEVILLE, role: 'part', near: false,
      candidates: [{ ...GIRALDA, place: place(40534, 'Zixiao Palace part', null), taken: 'scope' }],
    });
    show();
    expect(await screen.findByText('Outside the regions you curate')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Take out…' })).not.toBeInTheDocument();
    expect(await screen.findByText('Outside the regions you curate. A curator of its region adds it.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument();
  });
});

describe('an empty whole and a part', () => {
  beforeEach(() => vi.clearAllMocks());

  it('warns before the first part of a place in a kind of its own, and says it knew', async () => {
    mockedParts.mockResolvedValue({ ...SITE, experienceId: 1145, name: 'Brâncuși Monumental Ensemble of Târgu Jiu', parts: [] });
    mockedFind.mockResolvedValue({
      experienceId: 1145, role: 'part', near: true,
      candidates: [{ ...GIRALDA, place: place(42802, 'Table of Silence', 'Public art'), distance_m: 972, near_name: null }],
    });
    mockedAdd.mockResolvedValue({ ...answer('added'), becameWhole: true });
    show(1145);
    expect(await screen.findByText(/Its first part makes Brâncuși Monumental Ensemble of Târgu Jiu a place made of parts/)).toBeInTheDocument();
    expect(await screen.findByText('972 m from it')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(mockedAdd).toHaveBeenCalledWith(1145, { partId: 42802, note: undefined, makesWhole: true }));
  });

  it("lists a part's wholes, and refuses a whole that is one of its own parts", async () => {
    mockedParts.mockResolvedValue({
      experienceId: 13223, name: 'Seville Cathedral', in_kind: true, merged_onto: true, parts: [],
      wholes: [row(place(SEVILLE, SITE.name, 'World Heritage Sites'), { list: { reference: '383bis-001', name: null } })],
    });
    mockedFind.mockResolvedValue({ experienceId: 13223, role: 'whole', near: true, candidates: [] });
    show(13223, false);
    expect(await screen.findByText('Part of')).toBeInTheDocument();
    expect(screen.getByText(SITE.name)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add a part to it…' }));
    expect(screen.getByText(/Another place was merged into Seville Cathedral/)).toBeInTheDocument();
  });
});
