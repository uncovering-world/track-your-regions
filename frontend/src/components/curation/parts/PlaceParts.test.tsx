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
  replacePartLine: vi.fn(),
}));

import { addPart, fetchPlaceParts, findPartCandidates, replacePartLine, takeOutPart } from '../../../api/parts';
import { PlaceParts } from './PlaceParts';

const mockedParts = vi.mocked(fetchPlaceParts);
const mockedFind = vi.mocked(findPartCandidates);
const mockedAdd = vi.mocked(addPart);
const mockedTakeOut = vi.mocked(takeOutPart);
const mockedReplace = vi.mocked(replacePartLine);

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

  it('says when the parts could not be read, and reads them again on asking', async () => {
    mockedParts.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(SITE);
    show();
    expect(await screen.findByText('The parts of this place could not be loaded.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Parts (1)')).toBeInTheDocument();
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

describe('moving a list line to the place it names (#2527)', () => {
  // Thessaloniki's site: the list's line 456-002 "Rotunda" is held by the Arch of Galerius and Rotunda.
  const THESSALONIKI = 146;
  const ARCH = row(place(15409, 'Arch of Galerius and Rotunda', 'Archaeology'), { list: { reference: '456-002', name: 'Rotunda' } });
  const SOPHIA = row(place(13723, 'Hagia Sophia', 'Places of worship'));
  const ROTUNDA: PartCandidate = {
    place: place(44213, 'Rotunda', 'Places of worship'), distance_m: 151, near_name: 'Arch of Galerius and Rotunda',
    taken: null, kept_out: false, also_part_of: null,
  };
  const moved = (fromId: number, toId: number, points = 1, logId = 7001) => ({
    wholeId: THESSALONIKI, fromId, toId, reference: '456-002', keptOut: false, points, logId,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockedParts.mockResolvedValue({
      experienceId: THESSALONIKI, name: 'Paleochristian and Byzantine Monuments of Thessalonika', in_kind: true, merged_onto: false,
      parts: [ARCH, SOPHIA], wholes: [],
    });
    mockedFind.mockResolvedValue({ experienceId: THESSALONIKI, role: 'line', near: true, candidates: [ROTUNDA] });
  });

  it('offers Replace with… only on a part that holds a line of the list', async () => {
    show(THESSALONIKI);
    expect(await screen.findAllByRole('button', { name: 'Take out…' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Replace with…' })).toHaveLength(1);
  });

  it('moves the line to the place chosen in one act, and Undo moves it back', async () => {
    mockedReplace.mockResolvedValueOnce(moved(15409, 44213)).mockResolvedValueOnce(moved(44213, 15409));
    show(THESSALONIKI);
    fireEvent.click(await screen.findByRole('button', { name: 'Replace with…' }));
    expect(screen.getByText(/UNESCO’s list names the line 456-002 “Rotunda” here/)).toBeInTheDocument();
    // The line's search, which offers a part that holds no line of the list.
    await waitFor(() => expect(mockedFind).toHaveBeenCalledWith(THESSALONIKI, 'line', ''));
    fireEvent.click(await screen.findByRole('button', { name: 'Move the line here' }));
    await waitFor(() => expect(mockedReplace).toHaveBeenCalledWith(THESSALONIKI, {
      partId: 15409, withId: 44213, reference: '456-002', undoes: undefined, note: undefined,
    }));
    expect(await screen.findByText('The line 456-002 moved from Arch of Galerius and Rotunda to Rotunda.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    // The Undo names the line and the move it reverses.
    await waitFor(() => expect(mockedReplace).toHaveBeenLastCalledWith(THESSALONIKI, {
      partId: 44213, withId: 15409, reference: '456-002', undoes: 7001, note: undefined,
    }));
  });

  it('says a place that holds a line already cannot take this one', async () => {
    mockedFind.mockResolvedValue({
      experienceId: THESSALONIKI, role: 'line', near: false,
      candidates: [{ ...ROTUNDA, place: place(13723, 'Hagia Sophia', 'Places of worship'), taken: 'already' }],
    });
    show(THESSALONIKI);
    fireEvent.click(await screen.findByRole('button', { name: 'Replace with…' }));
    expect(await screen.findByText('Holds a line of the list already')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Move the line here' })).not.toBeInTheDocument();
  });

  it('says so when the line\'s point stayed where it was', async () => {
    mockedReplace.mockResolvedValue(moved(15409, 44213, 0));
    show(THESSALONIKI);
    fireEvent.click(await screen.findByRole('button', { name: 'Replace with…' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Move the line here' }));
    expect(await screen.findByText(/Its point stayed where it was\./)).toBeInTheDocument();
  });
});
