/**
 * A merge is undone from the history of the place that stayed (#1247,
 * ADR-0086). The Pantheon as an archaeological site (9701) was folded into the
 * Pantheon as a place of worship (9700) by the catalogue's own pass; its row
 * reads by name and offers the undo, and once undone it offers nothing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CurationLogEntry } from '../../api/curation';

vi.mock('../../utils/queryInvalidation', () => ({ invalidateExperiences: vi.fn() }));
vi.mock('../../api/curation', () => ({
  fetchCurationLog: vi.fn(), undoPlaceMerge: vi.fn(), undoSeparation: vi.fn(), takeBackPointItem: vi.fn(), takeBackMergeProposal: vi.fn(),
}));

import { fetchCurationLog, takeBackMergeProposal, takeBackPointItem, undoPlaceMerge } from '../../api/curation';
import { CurationHistory } from './CurationHistory';

const mockedLog = fetchCurationLog as unknown as ReturnType<typeof vi.fn>;
const mockedUndo = undoPlaceMerge as unknown as ReturnType<typeof vi.fn>;

const MERGED = {
  id: 1, action: 'merged', curator_name: null, region_name: null, folded_id: null, folded_name: null, created_at: '2026-10-07T10:00:00Z',
  details: {
    mergeId: 12, survivorId: 9700, foldedId: 9701, survivorName: 'Pantheon', foldedName: 'Pantheon',
    kinds: ['Archaeology'], reason: 'equal_wikidata_item', qid: 'Q99309',
  },
} as unknown as CurationLogEntry;

const UNDONE = {
  id: 2, action: 'merge_undone', curator_name: 'Ada', region_name: 'Lazio', folded_id: null, folded_name: null, created_at: '2026-10-07T11:00:00Z',
  details: { mergeId: 12, survivorId: 9700, foldedId: 9701, foldedName: 'Pantheon', kinds: ['Archaeology'] },
} as unknown as CurationLogEntry;

function openHistory(experienceId = 9700) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CurationHistory experienceId={experienceId} regionId={5} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: /Curation History/ }));
  return client;
}

describe('a merge in the history of the place that stayed', () => {
  beforeEach(() => {
    mockedLog.mockReset();
    mockedUndo.mockReset();
  });

  it('names both places and the kind that moved, and offers the undo', async () => {
    mockedLog.mockResolvedValue([MERGED]);
    mockedUndo.mockResolvedValue({ mergeId: 12, survivorId: 9700, foldedId: 9701 });
    openHistory();

    expect(await screen.findByText('Pantheon (#9701) merged into Pantheon (#9700), bringing Archaeology')).toBeTruthy();
    expect(screen.getByText('The catalogue — one Wikidata item')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Undo this merge/ }));
    await waitFor(() => expect(mockedUndo).toHaveBeenCalledWith(12, expect.anything()));
  });

  it('reads the place given back afresh, its card and where its address led', async () => {
    // A link to 9701 followed while it was folded read 9700's detail; once 9701
    // is a place again that answer must not stand for it.
    mockedLog.mockResolvedValue([MERGED]);
    mockedUndo.mockResolvedValue({ mergeId: 12, survivorId: 9700, foldedId: 9701 });
    const client = openHistory();
    client.setQueryData(['experience', 9701], { id: 9700 });
    client.setQueryData(['experience', 'survivor', 9701], { id: 9700 });

    fireEvent.click(await screen.findByRole('button', { name: /Undo this merge/ }));

    await waitFor(() => expect(client.getQueryState(['experience', 9701])?.isInvalidated).toBe(true));
    expect(client.getQueryState(['experience', 'survivor', 9701])?.isInvalidated).toBe(true);
  });

  it('offers no undo for a merge already undone', async () => {
    mockedLog.mockResolvedValue([UNDONE, MERGED]);
    openHistory();

    expect(await screen.findByText('Pantheon (#9701) is its own place again, with Archaeology')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Undo this merge/ })).toBeNull();
  });

  it("shows what was decided about the folded entry, marked as its, with nothing to undo there (#1366)", async () => {
    // The Tower of Hercules (761) holds the Public Art membership a merge
    // brought from 1430; the pin on it was decided about 1430.
    const PINNED = {
      id: 5, action: 'admission_overridden', curator_name: 'Ada', region_name: null, folded_id: 9701,
      folded_name: 'Pantheon', created_at: '2026-09-14T16:33:52Z',
      details: { reason: 'not an artwork', note: null },
    } as unknown as CurationLogEntry;
    const ANSWERED = {
      id: 6, action: 'component_items_answered', curator_name: 'Ada', region_name: null, folded_id: 9701,
      folded_name: 'Pantheon', created_at: '2026-09-20T10:00:00Z',
      details: { accepted: [{ locationId: 503, point: 'Portico', item: 'Q98505', label: 'Portico' }], refused: [] },
    } as unknown as CurationLogEntry;
    mockedLog.mockResolvedValue([MERGED, ANSWERED, PINNED]);
    openHistory();

    expect(await screen.findAllByText('About Pantheon (#9701), since merged into this place')).toHaveLength(2);
    // The merge row is where this place's history is changed; a row about the
    // folded entry is read, never acted on from here.
    expect(screen.getAllByRole('button', { name: /Undo this merge/ })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /Take back/ })).toBeNull();
  });

  it('says why the server refused, where the undo was asked', async () => {
    mockedLog.mockResolvedValue([MERGED]);
    mockedUndo.mockRejectedValue(new Error('A later merge into the same place is still in effect — undo that merge first'));
    openHistory();

    fireEvent.click(await screen.findByRole('button', { name: /Undo this merge/ }));
    expect(await screen.findByText(/undo that merge first/)).toBeTruthy();
  });
});

/**
 * A confirmed component item is taken back from the history of its site
 * (#1317): the row that confirmed the fort of Bologa for the point Bologa
 * offers the take-back, and once taken back it offers nothing.
 */
describe('a confirmed component item in the history of its site', () => {
  const CONFIRMED = {
    id: 3, action: 'component_items_answered', curator_name: 'Ada', region_name: null, folded_id: null, folded_name: null, created_at: '2026-10-09T18:00:00Z',
    details: {
      accepted: [{ locationId: 501, point: 'Bologa', item: 'Q98501', label: 'Castrul Bologa', pictured: true }],
      refused: [{ locationId: 502, point: 'Buciumi', item: 'Q98503', label: 'Castrul Buciumi' }],
    },
  } as unknown as CurationLogEntry;
  const TAKEN_BACK = {
    id: 4, action: 'component_item_taken_back', curator_name: 'Ada', region_name: null, folded_id: null, folded_name: null, created_at: '2026-10-10T09:00:00Z',
    details: { locationId: 501, point: 'Bologa', item: 'Q98501', label: 'Castrul Bologa', cleared: ['image_url', 'description'] },
  } as unknown as CurationLogEntry;
  const mockedTakeBack = takeBackPointItem as unknown as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockedLog.mockReset();
    mockedTakeBack.mockReset();
  });

  it('offers the take-back for each item the row confirmed, and not for the ones it turned down', async () => {
    mockedLog.mockResolvedValue([CONFIRMED]);
    mockedTakeBack.mockResolvedValue({ locationId: 501, item: 'Q98501', cleared: ['image_url', 'description'] });
    openHistory(9850);

    // The line breaks the panel keeps (pre-line) are one space to the query's normaliser.
    expect(await screen.findByText('Bologa: Castrul Bologa (Q98501) confirmed Buciumi: Castrul Buciumi (Q98503) not it')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Take back: Bologa ← Castrul Bologa' }));
    // The point and the item the row showed, so a stale row cannot take a newer item off.
    await waitFor(() => expect(mockedTakeBack).toHaveBeenCalledWith(501, 'Q98501'));
    expect(screen.queryByRole('button', { name: /Buciumi/ })).toBeNull();
  });

  it('offers no take-back once the item was taken back, and says what came off with it', async () => {
    mockedLog.mockResolvedValue([TAKEN_BACK, CONFIRMED]);
    openHistory(9850);

    expect(await screen.findByText('Bologa: Castrul Bologa (Q98501) taken back; the picture and the description came off with it')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Take back/ })).toBeNull();
  });
});

/**
 * A near pair's part of is taken back from the history of the place it is
 * recorded on (#1991): the pass read the Sassi di Matera (15334) as part of
 * Matera's World Heritage site (202) off Wikidata, and a curator who disagrees
 * opens the pair again from that row.
 */
describe("a near pair's answer in the history of the place it is recorded on", () => {
  const ANSWERED = {
    id: 7, action: 'merge_proposal_answered', curator_name: null, region_name: null, folded_id: null, folded_name: null, created_at: '2026-10-25T21:00:00Z',
    details: {
      proposalId: 51, otherId: 15334, otherName: 'Sassi di Matera', answer: 'part_of', partId: 15334, catalogue: 'wikidata',
      statement: { property: 'P361', subject: 'Q2350404', value: 'Q55739617' },
    },
  } as unknown as CurationLogEntry;
  const TAKEN_BACK = {
    id: 8, action: 'merge_proposal_taken_back', curator_name: 'Ada', region_name: null, folded_id: null, folded_name: null, created_at: '2026-10-25T22:00:00Z',
    details: { proposalId: 51, otherId: 15334, otherName: 'Sassi di Matera', answer: 'part_of', partId: 15334, catalogue: 'wikidata' },
  } as unknown as CurationLogEntry;
  const mockedTakeBackPair = takeBackMergeProposal as unknown as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockedLog.mockReset();
    mockedTakeBackPair.mockReset();
  });

  it('names the catalogue, says the statement, and offers the take-back of the pair', async () => {
    mockedLog.mockResolvedValue([ANSWERED]);
    mockedTakeBackPair.mockResolvedValue({ proposalId: 51, answer: 'part_of', partId: 15334, catalogue: true });
    openHistory(202);

    expect(await screen.findByText('The catalogue — Wikidata')).toBeTruthy();
    expect(screen.getByText(/its item Q2350404 states “part of” \(P361\) this place's item Q55739617/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Take back this answer' }));
    await waitFor(() => expect(mockedTakeBackPair).toHaveBeenCalledWith(202, 51));
  });

  it('offers nothing once the answer was taken back', async () => {
    mockedLog.mockResolvedValue([TAKEN_BACK, ANSWERED]);
    openHistory(202);

    expect(await screen.findByText('Sassi di Matera (#15334): part of this place — taken back from Wikidata, asked again')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Take back/ })).toBeNull();
  });
});
