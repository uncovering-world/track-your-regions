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
      otherWikidataItem: 'Q1250209', anchorWikidataItem: 'Q1250209', anchorKinds: ['World Heritage Sites'],
      otherWikidataLabel: null, otherWikidataDescription: null, anchorWikidataLabel: null, anchorWikidataDescription: null,
      distanceM: 139, nameSimilarity: 0.6486,
      exact: false, reachM: 300, foundBy: 'similar', proposedAt: '2026-10-17T10:00:00.000Z',
    },
    {
      proposalId: 42, otherId: 11800, otherName: 'Durham Castle and Cathedral', otherKinds: ['Public art'],
      otherImageUrl: null, otherImageCredit: null, otherLatitude: 54.7745, otherLongitude: -1.5760,
      otherWikidataItem: 'Q5316567', anchorWikidataItem: 'Q1250209', anchorKinds: ['World Heritage Sites'],
      otherWikidataLabel: null, otherWikidataDescription: null, anchorWikidataLabel: null, anchorWikidataDescription: null,
      distanceM: 20, nameSimilarity: 1,
      exact: true, reachM: 300, foundBy: 'similar', proposedAt: '2026-10-17T10:00:00.000Z',
    },
  ],
} as unknown as ReviewQueueItem;

/**
 * Babylon on dev, 2026-10-24 (#1970): the World Heritage site resolves to the
 * item of its listing, the Archaeology row to the ancient city's, and the two
 * names are the same, so only the items' descriptions tell them apart.
 */
const BABYLON = {
  id: 183, external_id: '278', name: 'Babylon', kind_id: 1, kind_name: 'World Heritage Sites',
  missing_since: null, source_membership: 'present', existence: 'extant', kind: 'merge-proposals', proposed: null,
  merge_pairs: [{
    proposalId: 37, otherId: 14711, otherName: 'Babylon', otherKinds: ['Archaeology'],
    otherImageUrl: null, otherImageCredit: null, otherLatitude: 32.5363, otherLongitude: 44.4209,
    otherWikidataItem: 'Q5684', anchorWikidataItem: 'Q100329356', anchorKinds: ['World Heritage Sites'],
    otherWikidataLabel: 'Babylon', otherWikidataDescription: 'capital city of Babylonia and an archaeological site in modern-day Iraq',
    anchorWikidataLabel: 'Babylon', anchorWikidataDescription: 'archaeological site of ancient Babylon, Iraq',
    distanceM: 64, nameSimilarity: 1, exact: false, reachM: 3000, foundBy: 'similar', proposedAt: '2026-10-17T10:00:00.000Z',
  }],
} as unknown as ReviewQueueItem;

function renderCard(onDone = vi.fn(), item = DURHAM) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MergeProposalsCard item={item} onDone={onDone} />
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
    // Two different Wikidata items on the public-art pair, and one shared item on the cathedral's.
    expect(screen.getAllByText('Two different Wikidata items:')).toHaveLength(1);
    expect(screen.getByText(/Both are Wikidata/)).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Q1250209' })[0]).toHaveAttribute('href', 'https://www.wikidata.org/wiki/Q1250209');
    expect(screen.getByRole('button', { name: 'Save answers' })).toBeDisabled();
  });

  it('names each place beside its own Wikidata item, with what the item is', () => {
    renderCard(vi.fn(), BABYLON);
    expect(screen.getByText('Two different Wikidata items:')).toBeTruthy();
    const anchor = screen.getByText(/Babylon \(this card, World Heritage Sites\):/);
    expect(anchor.textContent).toContain('Q100329356 — Babylon, archaeological site of ancient Babylon, Iraq');
    const other = screen.getByText(/Babylon \(Archaeology\):/);
    expect(other.textContent).toContain('Q5684 — Babylon, capital city of Babylonia and an archaeological site in modern-day Iraq');
    expect(screen.getByRole('link', { name: 'Q5684' })).toHaveAttribute('href', 'https://www.wikidata.org/wiki/Q5684');
    expect(screen.getByRole('link', { name: 'Q100329356' })).toHaveAttribute('href', 'https://www.wikidata.org/wiki/Q100329356');
  });

  it("names a serial site's part by the site it is part of, which is in no kind of its own (#1250)", () => {
    // Mtskheta on dev, 2026-10-27: the Places of worship row and the site's part, 62 m apart.
    const svetitskhoveli = {
      ...BABYLON, id: 13221, name: 'Svetitskhoveli Cathedral', kind_name: 'Places of worship',
      merge_pairs: [{
        ...BABYLON.merge_pairs![0], proposalId: 51, otherId: 37310, otherName: 'Svetitskhoveli Cathedral', otherKinds: [],
        otherPartOf: 'Historical Monuments of Mtskheta', anchorPartOf: null, anchorKinds: ['Places of worship'],
        otherWikidataItem: 'Q1152972', anchorWikidataItem: 'Q42587240',
        otherWikidataLabel: null, otherWikidataDescription: null, anchorWikidataLabel: null, anchorWikidataDescription: null,
        distanceM: 62,
      }],
    } as unknown as ReviewQueueItem;
    renderCard(vi.fn(), svetitskhoveli);
    expect(screen.getByText('Part of Historical Monuments of Mtskheta')).toBeTruthy();
    expect(screen.getByText(/Svetitskhoveli Cathedral \(part of Historical Monuments of Mtskheta\):/)).toBeTruthy();
    expect(screen.queryByText(/This place is part of/)).toBeNull();
  });

  it('says which place has no item when only one resolves to one', () => {
    const [pair] = BABYLON.merge_pairs!;
    renderCard(vi.fn(), { ...BABYLON, merge_pairs: [{ ...pair, anchorWikidataItem: null, anchorWikidataLabel: null, anchorWikidataDescription: null }] });
    expect(screen.getByText('Only one of the two has a Wikidata item:')).toBeTruthy();
    expect(screen.getByText(/Babylon \(this card, World Heritage Sites\):/).textContent).toContain('no item');
    expect(screen.getByRole('link', { name: 'Q5684' })).toBeTruthy();
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

describe('a pair found because one name stands within the other (#1652)', () => {
  beforeEach(() => {
    mockedAnswer.mockReset();
    mockedSuggest.mockReset();
    mockedSuggest.mockResolvedValue({ configured: false, suggestions: [] });
  });

  it('says so instead of a share that would read as a reason not to ask', () => {
    const geghard = {
      ...DURHAM, id: 407, name: 'Monastery of Geghard and the Upper Azat Valley',
      merge_pairs: [{
        ...(DURHAM.merge_pairs ?? [])[0], proposalId: 51, otherId: 13263, otherName: 'Geghard', distanceM: 7,
        nameSimilarity: 0.17, exact: false, foundBy: 'words',
      }],
    } as unknown as ReviewQueueItem;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MergeProposalsCard item={geghard} onDone={vi.fn()} />
      </QueryClientProvider>,
    );
    expect(screen.getByText(/7 m apart · one name within the other/)).toBeTruthy();
    expect(screen.queryByText(/17 % alike/)).toBeNull();
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
