/**
 * Jev's reading of which kind an arriving place belongs to (#2342), on places
 * of the monuments-category entrance's candidates (#2171): Wewelsburg read as
 * a castle, the Cellular Jail as a historical site, a highway as no kind, and
 * the Monument to the Battle of the Nations as the monument it arrives as.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../api/curation', () => ({ suggestKind: vi.fn(), answerPlannedKind: vi.fn() }));

import { answerPlannedKind, suggestKind } from '../../api/curation';
import { KindReadingLine, suggestedKindOf } from './KindReadingLine';

const mockedSuggest = vi.mocked(suggestKind);
const mockedAnswer = vi.mocked(answerPlannedKind);
const MONUMENTS = 6;

function renderLine(id: number, name: string) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <KindReadingLine experienceId={id} name={name} arrivingKindId={MONUMENTS} />
    </QueryClientProvider>,
  );
}

const planned = (belongs: boolean | null) => ({
  configured: true,
  suggestion: {
    reading: 'planned' as const, kind: null, confidence: 0.85,
    plannedKind: { slug: 'historical-sites', name: 'Historical sites', issue: 1820, belongs },
  },
});

beforeEach(() => {
  mockedSuggest.mockReset();
  mockedAnswer.mockReset();
});

describe("Jev's reading of an arriving place's kind", () => {
  it('names a live kind in words, with no control of its own', async () => {
    mockedSuggest.mockResolvedValue({
      configured: true,
      suggestion: { reading: 'live', kind: { id: 7, name: 'Towers', held: null }, plannedKind: null, confidence: 0.82 },
    });

    renderLine(55216, 'Denny Chimes');

    expect(await screen.findByText('Jev reads this as Towers · 82 %')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it.each([
    ['offered', 'it is in Public art already'],
    ['arriving', 'it is arriving in Public art too'],
    ['kept_out', 'it was kept out of Public art earlier'],
  ] as const)('says where the place stands in a kind it holds (%s), and offers no move', async (held, words) => {
    mockedSuggest.mockResolvedValue({
      configured: true,
      suggestion: { reading: 'live', kind: { id: 3, name: 'Public art', held }, plannedKind: null, confidence: 0.85 },
    });

    renderLine(55102, 'Spire of Dublin');

    expect(await screen.findByText(words, { exact: false })).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('names a planned kind with its issue, and records whether the place belongs there', async () => {
    mockedSuggest.mockResolvedValueOnce(planned(null)).mockResolvedValueOnce(planned(true));
    mockedAnswer.mockResolvedValue({ experienceId: 54996, plannedKind: 'historical-sites', belongs: true });

    renderLine(54996, 'Cellular Jail');

    expect(await screen.findByText('Jev reads this as Historical sites — a kind not built yet, issue #1820 · 85 %'))
      .toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'It belongs there' }));
    await waitFor(() => expect(mockedAnswer).toHaveBeenCalledWith(54996, { plannedKind: 'historical-sites', belongs: true }));
    expect(await screen.findByText(/You said it belongs there; it is listed for when Historical sites is built/))
      .toBeInTheDocument();
  });

  it('says no kind fits, and keeps one under one half as leaning', async () => {
    mockedSuggest.mockResolvedValue({
      configured: true, suggestion: { reading: 'none', kind: null, plannedKind: null, confidence: 0.42 },
    });

    renderLine(55211, 'Saskatchewan Highway 2');

    expect(await screen.findByText(
      'Jev is unsure which kind this is, leans to no kind of the catalogue, built or planned · 42 %',
    )).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('draws nothing where Jev names the kind the place is arriving in', async () => {
    mockedSuggest.mockResolvedValue({
      configured: true,
      suggestion: { reading: 'live', kind: { id: MONUMENTS, name: 'Monuments & memorials', held: 'arriving' }, plannedKind: null, confidence: 0.79 },
    });

    renderLine(54971, 'Monument to the Battle of the Nations');

    await waitFor(() => expect(mockedSuggest).toHaveBeenCalledWith(54971));
    expect(screen.queryByRole('note')).toBeNull();
  });
});

describe('the kind "Belongs in another kind…" opens with', () => {
  const live = (id: number, held: 'offered' | 'arriving' | 'kept_out' | null) =>
    ({ reading: 'live' as const, kind: { id, name: 'Towers', held }, plannedKind: null, confidence: 0.82 });

  it('is the live kind Jev names, where the form can offer it', () => {
    expect(suggestedKindOf(live(7, null), MONUMENTS)).toBe(7);
  });

  it('is none for the arriving kind, a kind the place holds, a planned kind, no reading or no kind', () => {
    expect(suggestedKindOf(live(MONUMENTS, null), MONUMENTS)).toBeUndefined();
    expect(suggestedKindOf(live(7, 'offered'), MONUMENTS)).toBeUndefined();
    expect(suggestedKindOf(planned(null).suggestion, MONUMENTS)).toBeUndefined();
    expect(suggestedKindOf(null, MONUMENTS)).toBeUndefined();
    expect(suggestedKindOf({ reading: 'none', kind: null, plannedKind: null, confidence: 0.42 }, MONUMENTS)).toBeUndefined();
  });
});
