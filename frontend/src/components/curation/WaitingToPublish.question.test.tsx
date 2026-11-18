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
vi.mock('../../api/kindNeighbours', () => ({ fetchKindNeighbours: vi.fn() }));
vi.mock('../../api/kindRule', () => ({ fetchKindRule: vi.fn() }));

import { fetchArticleLead } from '../../api/articleLeads';
import { fetchKindNeighbours } from '../../api/kindNeighbours';
import { fetchKindRule } from '../../api/kindRule';
import { GatedCard, leadStaleTime } from './WaitingToPublish';
import { queryKeys } from '../../api/queryKeys';
import type { GatedGroup } from './gatedGroup';

const mockedLead = vi.mocked(fetchArticleLead);
const mockedNeighbours = vi.mocked(fetchKindNeighbours);
const mockedRule = vi.mocked(fetchKindRule);

const DORMITION = { id: 47120, external_id: 'Q4129512', name: 'Dormition Cathedral, Kharkiv' };
const ARTICLE = 'https://en.wikipedia.org/wiki/Dormition_Cathedral,_Kharkiv';

function arrival(over: Partial<ReviewQueueItem> = {}): ReviewQueueItem {
  return {
    ...DORMITION, kind_id: 7, kind_name: 'Towers', kind_type: 'bell-tower', membership_id: 88,
    missing_since: null, source_membership: 'present', gone: false,
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
  mockedNeighbours.mockReset().mockResolvedValue({ kept: null, refused: null });
  mockedRule.mockReset().mockResolvedValue({ keptOut: null, world: null, surroundings: null });
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

  it("shows a kept and a refused place of its kind and type, each opening its own card", async () => {
    mockedLead.mockResolvedValue(null);
    mockedNeighbours.mockResolvedValue({
      kept: { placeId: 40682, name: 'Pagoda of Fogong Temple', imageUrl: null, imageCredit: null },
      refused: { placeId: 15020, name: 'Mast of a radio station', imageUrl: null, imageCredit: null, reason: 'kept out by a curator' },
    });
    renderCard(arrival());

    const block = await screen.findByRole('region', { name: 'Towers in the catalogue' });
    expect(await within(block).findByText('— kept')).toBeInTheDocument();
    expect(within(block).getByText('— kept out by a curator')).toBeInTheDocument();
    expect(within(block).getByRole('button', { name: 'Curate Pagoda of Fogong Temple' })).toBeInTheDocument();
    expect(mockedNeighbours).toHaveBeenCalledWith(88);
  });

  it("says a refused neighbour's own reason, never \"not a tower\" for a refusal about its fame", async () => {
    mockedLead.mockResolvedValue(null);
    mockedNeighbours.mockResolvedValue({
      kept: null,
      refused: {
        placeId: 51230, name: 'Torre Scappi', imageUrl: null, imageCredit: null,
        reason: '1 Wikipedia editions, under the 2 the surroundings tier asks for',
      },
    });
    renderCard(arrival());

    const block = await screen.findByRole('region', { name: 'Towers in the catalogue' });
    expect(await within(block).findByText(/— kept out: /)).toBeInTheDocument();
    expect(within(block).queryByText(/not a tower/)).toBeNull();
  });

  it('says a hand-written refusal once, with no second "kept out"', async () => {
    mockedLead.mockResolvedValue(null);
    mockedNeighbours.mockResolvedValue({
      kept: null,
      refused: { placeId: 51231, name: 'Old Water Tower', imageUrl: null, imageCredit: null, reason: 'editorial exclusion: a water tank, not a tower to visit' },
    });
    renderCard(arrival());

    const block = await screen.findByRole('region', { name: 'Towers in the catalogue' });
    expect(await within(block).findByText(/— kept out by hand: a water tank/i)).toBeInTheDocument();
    expect(within(block).queryByText(/kept out: kept out/i)).toBeNull();
  });

  it("keys the neighbours under the queue's key, so an answer or a closed card reads them again", () => {
    const queue = queryKeys.curation.reviewQueueAll;
    expect(queryKeys.curation.kindNeighbours(88).slice(0, queue.length)).toEqual([...queue]);
  });

  it("keeps the heading with the kind's rule behind ⓘ where no neighbour was answered yet", async () => {
    mockedLead.mockResolvedValue(null);
    mockedRule.mockResolvedValue({ keptOut: [{ reason: 'a lighthouse, not a tower', unless: null, unlessTypes: [] }], world: null, surroundings: null });
    renderCard(arrival());

    const block = await screen.findByRole('region', { name: 'Towers in the catalogue' });
    expect(within(block).getByRole('button', { name: 'how Towers decides' })).toBeInTheDocument();
    expect(mockedRule).toHaveBeenCalledWith(7);
    expect(within(block).queryByText(/— kept/)).toBeNull();
  });

  it('draws no block for a kind with no types, no rule read and no answered neighbour', async () => {
    mockedLead.mockResolvedValue(null);
    renderCard(arrival({ id: 4012, name: 'Buckingham Palace', kind_id: 2, kind_name: 'Art Museums', kind_type: null }));
    await vi.waitFor(() => expect(mockedRule).toHaveBeenCalled());
    await vi.waitFor(() => expect(mockedNeighbours).toHaveBeenCalled());
    expect(screen.queryByRole('region', { name: 'Art Museums in the catalogue' })).toBeNull();
  });
});
