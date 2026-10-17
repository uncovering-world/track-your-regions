/**
 * The card for two near places with similar names (#1249), on Durham: the
 * World Heritage site "Durham Castle and Cathedral" has Durham Cathedral
 * 139 m off under a name two thirds alike, and a public-art row named
 * "Durham Castle and Cathedral" 20 m off under the same name.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReviewQueueItem } from '../../api/reviewQueue';

vi.mock('../../api/curation', () => ({ answerMergeProposals: vi.fn(), suggestMergeProposals: vi.fn() }));
vi.mock('../shared/PointPreviewDialog', () => ({ PointPreviewDialog: () => null }));

import { answerMergeProposals, suggestMergeProposals } from '../../api/curation';
import { MergeProposalsCard } from './MergeProposalsCard';

const mockedAnswer = answerMergeProposals as unknown as ReturnType<typeof vi.fn>;
const mockedSuggest = suggestMergeProposals as unknown as ReturnType<typeof vi.fn>;

const DURHAM = {
  id: 1225, external_id: '370', name: 'Durham Castle and Cathedral', kind_id: 1, kind_name: 'World Heritage Sites',
  missing_since: null, source_membership: 'present', existence: 'extant', kind: 'merge-proposals', proposed: null,
  merge_pairs: [
    {
      proposalId: 41, otherId: 13341, otherName: 'Durham Cathedral', otherKinds: ['Places of worship'],
      otherImageUrl: null, otherImageCredit: null, otherLatitude: 54.7733, otherLongitude: -1.5755,
      otherWikidataItem: 'Q1250209', anchorWikidataItem: 'Q1250209', distanceM: 139, nameSimilarity: 0.6486,
      exact: false, reachM: 300, proposedAt: '2026-10-17T10:00:00.000Z',
    },
    {
      proposalId: 42, otherId: 11800, otherName: 'Durham Castle and Cathedral', otherKinds: ['Public Art & Monuments'],
      otherImageUrl: null, otherImageCredit: null, otherLatitude: 54.7745, otherLongitude: -1.5760,
      otherWikidataItem: 'Q5316567', anchorWikidataItem: 'Q1250209', distanceM: 20, nameSimilarity: 1,
      exact: true, reachM: 300, proposedAt: '2026-10-17T10:00:00.000Z',
    },
  ],
} as unknown as ReviewQueueItem;

function renderCard(onDone = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MergeProposalsCard item={DURHAM} onDone={onDone} />
    </QueryClientProvider>,
  );
  return onDone;
}

describe('two near places with similar names', () => {
  beforeEach(() => {
    mockedAnswer.mockReset();
    mockedSuggest.mockReset();
    // A deployment without Jev: no judgement beside any pair.
    mockedSuggest.mockResolvedValue({ configured: false, suggestions: [] });
  });

  it('lists each pair with how the two stand to each other, and saves nothing until something is answered', () => {
    renderCard();
    expect(screen.getByText('2 places within reach of this one carry a name alike. For each, say whether the two are one place, two places, or one part of the other. One place keeps this entry, the older, and folds the other into it.')).toBeTruthy();
    expect(screen.getByText(/139 m apart · names 65 % alike/)).toBeTruthy();
    expect(screen.getByText(/20 m apart · the same name/)).toBeTruthy();
    expect(screen.getByText('same name, same spot')).toBeTruthy();
    // Two different Wikidata items on the public-art pair, and not on the cathedral's.
    expect(screen.getAllByText(/two different Wikidata items/)).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Q1250209' })).toHaveAttribute('href', 'https://www.wikidata.org/wiki/Q1250209');
    expect(screen.getByRole('button', { name: 'Save answers' })).toBeDisabled();
  });

  it('answers one place for every exact pair at once, and sends only what was answered', async () => {
    mockedAnswer.mockResolvedValue({ experienceId: 1225, merged: [{ proposalId: 42, mergeId: 7 }], two: 0, partOf: 0, refused: [] });
    const onDone = renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'One place for the exact pair' }));
    expect(screen.getByRole('button', { name: 'One place: Durham Castle and Cathedral' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Save 1 answer' }));
    await waitFor(() => expect(mockedAnswer).toHaveBeenCalledWith(1225, [{ proposalId: 42, answer: 'one' }]));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('Durham Castle and Cathedral: 1 place merged into it', 1225));
  });

  it('records which place is the part, the other place first and turned round on a click', async () => {
    mockedAnswer.mockResolvedValue({ experienceId: 1225, merged: [], two: 0, partOf: 1, refused: [] });
    const onDone = renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'One part of the other: Durham Cathedral' }));
    const which = screen.getByRole('group', { name: 'Which is the part: Durham Cathedral or Durham Castle and Cathedral' });
    expect(which).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Durham Castle and Cathedral is part of Durham Cathedral' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save 1 answer' }));
    await waitFor(() => expect(mockedAnswer).toHaveBeenCalledWith(1225, [{ proposalId: 41, answer: 'part_of', partId: 1225 }]));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('Durham Castle and Cathedral: 1 pair recorded as part of the other', 1225));
  });

  it('keeps a pair as two places, and says so once saved', async () => {
    mockedAnswer.mockResolvedValue({ experienceId: 1225, merged: [], two: 1, partOf: 0, refused: [] });
    const onDone = renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Two places: Durham Cathedral' }));
    // A second click on the same answer takes it back.
    fireEvent.click(screen.getByRole('button', { name: 'Two places: Durham Cathedral' }));
    expect(screen.getByRole('button', { name: 'Save answers' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Two places: Durham Cathedral' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save 1 answer' }));
    await waitFor(() => expect(mockedAnswer).toHaveBeenCalledWith(1225, [{ proposalId: 41, answer: 'two' }]));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('Durham Castle and Cathedral: 1 pair kept as two places', 1225));
  });

  it('says a merged pair whose answer went unrecorded once, as a merge with a note, never as a refusal beside it', async () => {
    mockedAnswer.mockResolvedValue({
      experienceId: 1225, merged: [{ proposalId: 42, mergeId: 7 }], two: 0, partOf: 0,
      refused: [{ proposalId: 42, error: 'Merged, but the answer could not be recorded: This pair was answered already — reload to see where it stands' }],
    });
    const onDone = renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'One place: Durham Castle and Cathedral' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save 1 answer' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(
      'Durham Castle and Cathedral: 1 place merged into it (1 with the answer unrecorded: Merged, but the answer could not be recorded: This pair was answered already — reload to see where it stands)',
      1225,
    ));
  });

  it('names a refused pair with its reason', async () => {
    mockedAnswer.mockResolvedValue({
      experienceId: 1225, merged: [], two: 1, partOf: 0,
      refused: [{ proposalId: 42, error: 'Both places belong to the same kind, which one place cannot hold twice' }],
    });
    const onDone = renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Two places: Durham Cathedral' }));
    fireEvent.click(screen.getByRole('button', { name: 'One place: Durham Castle and Cathedral' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save 2 answers' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(
      'Durham Castle and Cathedral: 1 pair kept as two places, 1 pair refused: Both places belong to the same kind, which one place cannot hold twice',
      1225,
    ));
  });
});

describe("Jev's judgement on the card (#1249)", () => {
  beforeEach(() => {
    mockedAnswer.mockReset();
    mockedSuggest.mockReset();
    mockedSuggest.mockResolvedValue({
      configured: true,
      suggestions: [
        { proposalId: 41, judgement: 'part_of', confidence: 0.84 },
        { proposalId: 42, judgement: 'one', confidence: 0.95 },
      ],
    });
  });

  it('says what Jev makes of each pair, a low confidence as leaning, and chooses nothing for the curator', async () => {
    mockedSuggest.mockResolvedValue({
      configured: true,
      suggestions: [
        // A margin of 42 points between its options: a near coin toss, said as leaning.
        { proposalId: 41, judgement: 'two', confidence: 0.42 },
        { proposalId: 42, judgement: 'one', confidence: 0.95 },
      ],
    });
    renderCard();
    expect(await screen.findByText('Jev says one place · 95 %')).toBeTruthy();
    expect(screen.getByText('Jev is unsure, leans two places · 42 %')).toBeTruthy();
    expect(mockedSuggest).toHaveBeenCalledWith(1225);
    expect(screen.getByRole('button', { name: 'Save answers' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'One place: Durham Castle and Cathedral' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('answers one place at one press only for the pairs Jev calls one place and is sure of', async () => {
    mockedAnswer.mockResolvedValue({ experienceId: 1225, merged: [{ proposalId: 42, mergeId: 7 }], two: 0, partOf: 0, refused: [] });
    renderCard();
    expect(await screen.findByText('Jev says one part of the other · 84 %')).toBeTruthy();
    const button = screen.getByRole('button', { name: 'One place for the pair Jev is sure of' });
    fireEvent.click(button);
    expect(button).toBeDisabled();
    expect(screen.getByRole('button', { name: 'One place: Durham Castle and Cathedral' })).toHaveAttribute('aria-pressed', 'true');
    // The part-of pair is left to the curator, whatever Jev's confidence.
    expect(screen.getByRole('button', { name: 'One part of the other: Durham Cathedral' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Save 1 answer' }));
    await waitFor(() => expect(mockedAnswer).toHaveBeenCalledWith(1225, [{ proposalId: 42, answer: 'one' }]));
  });

  it('offers no such button when Jev is sure of no pair being one place', async () => {
    mockedSuggest.mockResolvedValue({
      configured: true,
      suggestions: [
        { proposalId: 41, judgement: 'part_of', confidence: 0.95 },
        { proposalId: 42, judgement: 'one', confidence: 0.6 },
      ],
    });
    renderCard();
    expect(await screen.findByText('Jev says one place · 60 %')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Jev is sure of/ })).toBeNull();
    // The exact pair's own button stands regardless of Jev.
    expect(screen.getByRole('button', { name: 'One place for the exact pair' })).toBeTruthy();
  });
});
