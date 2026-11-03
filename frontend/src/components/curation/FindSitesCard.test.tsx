/**
 * The review page's card for a site a run proposed finds for (#2304): the
 * place's own questions, answered one find at a time, each answer said in the
 * page's notice for the site it was about.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { ReviewQueueItem } from '../../api/reviewQueue';
import { answerFindSiteLink, fetchFindSiteLinks } from '../../api/findSiteLinks';
import { FindSitesCard } from './FindSitesCard';

vi.mock('../../api/findSiteLinks', () => ({
  fetchFindSiteLinks: vi.fn(), answerFindSiteLink: vi.fn(), searchFindSiteCandidates: vi.fn(),
}));
vi.mock('../../hooks/useDebouncedValue', () => ({ useDebouncedValue: <T,>(value: T) => value }));
vi.mock('../../utils/queryInvalidation', () => ({ invalidateFindSiteLink: vi.fn() }));
vi.mock('./CuratePlaceButton', () => ({ CuratePlaceButton: () => null }));
vi.mock('../../hooks/useNavigation', () => ({
  useNavigation: () => ({ selectedWorldView: { id: 5, name: 'Administrative', isDefault: false }, isCustomWorldView: true }),
}));

/** The World Heritage site Ur is a component of, as the queue's card carries it. */
const UR = {
  id: 1469, external_id: '1481', name: 'The Ahwar of Southern Iraq', kind_id: 1, kind_name: 'World Heritage Sites',
  kind: 'find-sites', proposed: null, find_proposals: 1, missing_since: null, source_membership: 'present',
  existence: 'extant',
} as unknown as ReviewQueueItem;

const CODE = {
  treasure_id: 812, name: 'Code of Ur-Nammu', treasure_type: 'stele', year: -2100, state: 'proposed' as const,
  origin: 'coordinate' as const, distance_m: 120,
  shown_at: [{ id: 3301, name: 'Istanbul Archaeology Museums', kind_id: 5, regions: [] }],
  image_url: null, image_credit: null,
};

function renderCard(onDone = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><FindSitesCard item={UR} onDone={onDone} /></MemoryRouter>
    </QueryClientProvider>,
  );
  return onDone;
}

describe('the card for a site a run proposed finds for (#2304)', () => {
  beforeEach(() => {
    vi.mocked(fetchFindSiteLinks).mockReset().mockResolvedValue({ experienceId: UR.id, links: [CODE] });
    vi.mocked(answerFindSiteLink).mockReset().mockResolvedValue({ success: true, treasureId: 812, answer: 'refused' });
  });

  it("asks the site's questions, the place's dialog's own", async () => {
    renderCard();
    expect(screen.getByText(UR.name)).toBeInTheDocument();
    expect(await screen.findByText('May come from here (1)')).toBeInTheDocument();
    expect(fetchFindSiteLinks).toHaveBeenCalledWith(UR.id);
  });

  it('says each answer in the notice, for the site it was about', async () => {
    const onDone = renderCard();
    fireEvent.click(await screen.findByRole('button', { name: 'Not from here: Code of Ur-Nammu' }));

    await waitFor(() => expect(answerFindSiteLink).toHaveBeenCalledWith(UR.id, 812, 'refused'));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(`${UR.name}: Code of Ur-Nammu is not from here`, UR.id));
  });
});
