/**
 * The curator's question on a site's card about where a find comes from
 * (#2242): the proposal reads as the find, where it is shown and how far its
 * point lies, and each answer is sent for that find and that site.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { FindSiteLink } from '../../api/findSiteLinks';
import { answerFindSiteLink, fetchFindSiteLinks, searchFindSiteCandidates } from '../../api/findSiteLinks';
import { invalidateFindSiteLink } from '../../utils/queryInvalidation';
import { SiteFindQuestions } from './SiteFindQuestions';

vi.mock('../../api/findSiteLinks', () => ({
  fetchFindSiteLinks: vi.fn(), answerFindSiteLink: vi.fn(), searchFindSiteCandidates: vi.fn(),
}));
vi.mock('../../hooks/useDebouncedValue', () => ({ useDebouncedValue: <T,>(value: T) => value }));
vi.mock('../../utils/queryInvalidation', () => ({ invalidateFindSiteLink: vi.fn() }));
vi.mock('../../hooks/useNavigation', () => ({
  useNavigation: () => ({
    selectedWorldView: { id: 5, name: 'Administrative', isDefault: false },
    isCustomWorldView: true,
  }),
}));

const DENDERA = 13584;
const LOUVRE = { id: 2101, name: 'Louvre', kind_id: 2, regions: [] };

function link(over: Partial<FindSiteLink> = {}): FindSiteLink {
  return {
    treasure_id: 501,
    name: 'Dendera zodiac',
    treasure_type: 'relief',
    year: -50,
    state: 'proposed',
    origin: 'coordinate',
    distance_m: 0,
    shown_at: [LOUVRE],
    ...over,
  };
}

function renderQuestions() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter><SiteFindQuestions siteId={DENDERA} /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SiteFindQuestions', () => {
  beforeEach(() => {
    vi.mocked(answerFindSiteLink).mockReset().mockResolvedValue({ success: true, treasureId: 501, answer: 'confirmed' });
    vi.mocked(invalidateFindSiteLink).mockReset();
  });

  it('asks about a proposed find with its museum and distance, and sends a yes for it', async () => {
    vi.mocked(fetchFindSiteLinks).mockResolvedValue({ experienceId: DENDERA, links: [link()] });
    renderQuestions();

    expect(await screen.findByText('May come from here (1)')).toBeInTheDocument();
    expect(screen.getByText('Dendera zodiac')).toBeInTheDocument();
    expect(screen.getByText(/Its own point is 0 m from this place/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Comes from here: Dendera zodiac' }));

    await waitFor(() => expect(answerFindSiteLink).toHaveBeenCalledWith(DENDERA, 501, 'confirmed'));
    await waitFor(() => expect(invalidateFindSiteLink).toHaveBeenCalledWith(expect.anything(), DENDERA, [LOUVRE.id]));
  });

  it('takes a confirmed link back with a no', async () => {
    vi.mocked(fetchFindSiteLinks).mockResolvedValue({
      experienceId: DENDERA, links: [link({ state: 'confirmed' })],
    });
    renderQuestions();

    fireEvent.click(await screen.findByRole('button', { name: 'Unlink: Dendera zodiac' }));
    await waitFor(() => expect(answerFindSiteLink).toHaveBeenCalledWith(DENDERA, 501, 'refused'));
    expect(screen.queryByText(/May come from here/)).not.toBeInTheDocument();
  });

  it('draws only the control that links a find by hand while there is nothing to ask', async () => {
    vi.mocked(fetchFindSiteLinks).mockResolvedValue({ experienceId: DENDERA, links: [] });
    renderQuestions();

    await waitFor(() => expect(fetchFindSiteLinks).toHaveBeenCalled());
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['Link a find to this place…']);
  });

  it('finds a work by name and links it by hand', async () => {
    vi.mocked(fetchFindSiteLinks).mockResolvedValue({ experienceId: DENDERA, links: [] });
    vi.mocked(searchFindSiteCandidates).mockResolvedValue({
      experienceId: DENDERA,
      candidates: [{ treasure_id: 777, name: 'Dendera Light relief', treasure_type: 'relief', year: null,
        shown_at: [LOUVRE] }],
    });
    renderQuestions();

    fireEvent.click(await screen.findByRole('button', { name: 'Link a find to this place…' }));
    fireEvent.change(screen.getByLabelText('Find, by name'), { target: { value: 'Dendera' } });
    await waitFor(() => expect(searchFindSiteCandidates).toHaveBeenCalledWith(DENDERA, 'Dendera'));
    fireEvent.click(await screen.findByRole('button', { name: 'Comes from here: Dendera Light relief' }));

    await waitFor(() => expect(answerFindSiteLink).toHaveBeenCalledWith(DENDERA, 777, 'confirmed'));
  });

  it('says the search did not answer, never that nothing was found, when it fails', async () => {
    vi.mocked(fetchFindSiteLinks).mockResolvedValue({ experienceId: DENDERA, links: [] });
    vi.mocked(searchFindSiteCandidates).mockRejectedValue(new Error('404'));
    renderQuestions();

    fireEvent.click(await screen.findByRole('button', { name: 'Link a find to this place…' }));
    fireEvent.change(screen.getByLabelText('Find, by name'), { target: { value: 'Rosetta' } });
    expect(await screen.findByText('The search did not answer. Try again.')).toBeInTheDocument();
    expect(screen.queryByText(/No find of that name/)).not.toBeInTheDocument();
  });
});
