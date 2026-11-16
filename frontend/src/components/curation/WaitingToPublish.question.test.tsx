/**
 * An arrival's card opens with the kind's question and shows the place itself
 * (#2185): "Is this a tower?", then the Dormition Cathedral in Kharkiv in its
 * article's first sentence, its type, and the three answers in the question's
 * words.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReviewQueueItem } from '../../api/reviewQueue';

vi.mock('../../api/articleLeads', () => ({ fetchArticleLead: vi.fn() }));

import { fetchArticleLead } from '../../api/articleLeads';
import { GatedCard, leadStaleTime } from './WaitingToPublish';
import type { GatedGroup } from './gatedGroup';

const mockedLead = vi.mocked(fetchArticleLead);

const DORMITION = { id: 47120, external_id: 'Q4129512', name: 'Dormition Cathedral, Kharkiv' };
const ARTICLE = 'https://en.wikipedia.org/wiki/Dormition_Cathedral,_Kharkiv';

function arrival(over: Partial<ReviewQueueItem> = {}): ReviewQueueItem {
  return {
    ...DORMITION, kind_id: 7, kind_name: 'Towers', kind_type: 'bell-tower', membership_id: 88,
    missing_since: null, source_membership: 'present', existence: 'extant',
    kind: 'arrival', proposed: null, wikipedia_url: ARTICLE,
    object_description: 'cathedral in Kharkiv, Ukraine',
    pending_locations: 0, pending_treasures: 0, pending_points: [], pending_works: [],
    ...over,
  };
}

let client: QueryClient;

function renderCard(item: ReviewQueueItem, reuse?: QueryClient) {
  const sections: GatedGroup[] = [{ ...DORMITION, membershipId: item.membership_id ?? null, arrival: item }];
  client = reuse ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <GatedCard sections={sections} onDone={() => {}} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockedLead.mockReset();
});

describe("an arrival's card asks its kind's question first (#2185)", () => {
  it('opens with "Is this a tower?" ahead of the place and its answers', async () => {
    mockedLead.mockResolvedValue(null);
    renderCard(arrival());

    const question = screen.getByRole('heading', { name: 'Is this a tower?' });
    const place = screen.getByText('Dormition Cathedral, Kharkiv');
    expect(question.compareDocumentPosition(place) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(mockedLead).toHaveBeenCalledWith(DORMITION.id);
  });

  it("shows the place in its article's first sentence, the article named by its title", async () => {
    mockedLead.mockResolvedValue({
      placeId: DORMITION.id, title: 'Dormition Cathedral, Kharkiv', url: ARTICLE,
      sentence: 'The Dormition Cathedral is an Orthodox cathedral in Kharkiv, with a 90 m bell tower.',
    });
    renderCard(arrival());

    expect(await screen.findByText(/The Dormition Cathedral is an Orthodox cathedral in Kharkiv/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Dormition Cathedral, Kharkiv ↗' })).toHaveAttribute('href', ARTICLE);
    // The article is linked once, by its title, and the source's description gives way to the sentence.
    expect(screen.queryByRole('link', { name: 'Wikipedia' })).toBeNull();
    expect(screen.queryByText('cathedral in Kharkiv, Ukraine')).toBeNull();
  });

  it("keeps the source's description where no article's sentence was read", async () => {
    mockedLead.mockResolvedValue(null);
    renderCard(arrival());

    expect(await screen.findByText('cathedral in Kharkiv, Ukraine')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Wikipedia' })).toHaveAttribute('href', ARTICLE);
  });

  it('reads the sentence again once the place names another article', async () => {
    mockedLead.mockResolvedValue(null);
    const { rerender } = renderCard(arrival());
    await vi.waitFor(() => expect(mockedLead).toHaveBeenCalledTimes(1));
    rerender(
      <QueryClientProvider client={client}>
        <GatedCard sections={[{ ...DORMITION, membershipId: 88, arrival: arrival({ wikipedia_url: `${ARTICLE}_(church)` }) }]}
          onDone={() => {}} />
      </QueryClientProvider>,
    );
    await vi.waitFor(() => expect(mockedLead).toHaveBeenCalledTimes(2));
  });

  it("drops a sentence and its link once the place's article is cleared", async () => {
    mockedLead.mockResolvedValue({
      placeId: DORMITION.id, title: 'Dormition Cathedral, Kharkiv', url: ARTICLE,
      sentence: 'The Dormition Cathedral is an Orthodox cathedral in Kharkiv.',
    });
    const { rerender } = renderCard(arrival());
    expect(await screen.findByText(/The Dormition Cathedral is an Orthodox cathedral/)).toBeInTheDocument();

    rerender(
      <QueryClientProvider client={client}>
        <GatedCard sections={[{ ...DORMITION, membershipId: 88, arrival: arrival({ wikipedia_url: null }) }]} onDone={() => {}} />
      </QueryClientProvider>,
    );
    expect(screen.queryByText(/The Dormition Cathedral is an Orthodox cathedral/)).toBeNull();
    expect(screen.queryByRole('link', { name: 'Dormition Cathedral, Kharkiv ↗' })).toBeNull();
    expect(screen.getByText('cathedral in Kharkiv, Ukraine')).toBeInTheDocument();
  });

  it('keeps a sentence for good, and asks again a minute after Wikipedia gave none', () => {
    expect(leadStaleTime({ state: { data: { sentence: 'The Dormition Cathedral is a cathedral.' } } })).toBe(Infinity);
    expect(leadStaleTime({ state: { data: null } })).toBe(60_000);
  });

  it('shows the sentence when the card opens again a minute after Wikipedia gave none', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      mockedLead.mockResolvedValueOnce(null);
      const first = renderCard(arrival());
      const kept = client;
      // The empty answer is in the cache before the card closes.
      await vi.waitFor(() => expect(kept.getQueryCache().findAll({ queryKey: ['curation', 'articleLead'] })[0]?.state.status)
        .toBe('success'));
      first.unmount();

      vi.setSystemTime(Date.now() + 61_000);
      mockedLead.mockResolvedValueOnce({
        placeId: DORMITION.id, title: 'Dormition Cathedral, Kharkiv', url: ARTICLE,
        sentence: 'The Dormition Cathedral is an Orthodox cathedral in Kharkiv.',
      });
      renderCard(arrival(), kept);
      expect(await screen.findByText(/The Dormition Cathedral is an Orthodox cathedral/)).toBeInTheDocument();
      expect(mockedLead).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('asks for no sentence for a place with no article', () => {
    renderCard(arrival({ wikipedia_url: null }));
    expect(mockedLead).not.toHaveBeenCalled();
  });

  it('says its type and answers Keep, Not a tower or Another kind', async () => {
    mockedLead.mockResolvedValue(null);
    renderCard(arrival());

    expect(screen.getByText('Type: Bell tower')).toBeInTheDocument();
    const answers = screen.getAllByRole('button').map(button => button.textContent);
    expect(answers).toEqual(expect.arrayContaining(['Keep', 'Not a tower', 'Another kind…']));
  });

  it('asks a square or street, and a kind with no types says none', async () => {
    mockedLead.mockResolvedValue(null);
    renderCard(arrival({
      id: 51004, name: 'Boulevard Périphérique', kind_id: 9, kind_name: 'Squares & streets', kind_type: 'street',
    }));
    expect(screen.getByRole('heading', { name: 'Is this a square or street?' })).toBeInTheDocument();
    expect(within(screen.getByRole('heading', { name: 'Is this a square or street?' }).parentElement!)
      .getByRole('button', { name: 'Not a square or street' })).toBeInTheDocument();
  });

  it('asks an art museum, with no type line for a kind that files none', async () => {
    mockedLead.mockResolvedValue(null);
    renderCard(arrival({
      id: 4012, name: 'Buckingham Palace', kind_id: 2, kind_name: 'Art Museums', kind_type: null,
    }));
    expect(screen.getByRole('heading', { name: 'Is this an art museum?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Not an art museum' })).toBeInTheDocument();
    expect(screen.queryByText(/^Type:/)).toBeNull();
  });
});
