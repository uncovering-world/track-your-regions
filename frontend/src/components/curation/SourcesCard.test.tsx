/**
 * The card for two data sources that describe one place differently (#1246),
 * on Rila Monastery: UNESCO calls it "Rila Monastery", Wikidata "Monastery of
 * Saint John of Rila", each with its own photograph; the points stand 8 m apart
 * and only Wikidata has a subtitle, so neither is asked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReviewQueueItem } from '../../api/reviewQueue';

vi.mock('../../api/curation', () => ({ chooseSourceViews: vi.fn(), suggestSourceViews: vi.fn() }));

import { chooseSourceViews, suggestSourceViews } from '../../api/curation';
import { SourcesCard } from './SourcesCard';

const mockedChoose = chooseSourceViews as unknown as ReturnType<typeof vi.fn>;
const mockedSuggest = suggestSourceViews as unknown as ReturnType<typeof vi.fn>;

const UNESCO = { kind_name: 'World Heritage Sites', source_name: 'UNESCO World Heritage Sites', latitude: null, longitude: null };
const WIKIDATA = { kind_name: 'Places of worship', source_name: 'Places of worship', latitude: null, longitude: null };

const RILA = {
  id: 450, external_id: '216', name: 'Rila Monastery', kind_id: 1, kind_name: 'World Heritage Sites',
  missing_since: null, source_membership: 'present', existence: 'extant', kind: 'sources', proposed: null,
  source_views: [
    {
      field: 'name',
      views: [
        { ...UNESCO, membership_id: 379, value: 'Rila Monastery', image_url: null, image_credit: null, shown: true },
        { ...WIKIDATA, membership_id: 3045, value: 'Monastery of Saint John of Rila', image_url: null, image_credit: null, shown: false },
      ],
    },
    {
      field: 'imageUrl',
      views: [
        { ...UNESCO, membership_id: 379, value: null, image_url: 'http://commons.wikimedia.org/wiki/Special:FilePath/Klosterkirche%20des%20Rilaklosters.jpg', image_credit: null, shown: true },
        { ...WIKIDATA, membership_id: 3045, value: null, image_url: 'http://commons.wikimedia.org/wiki/Special:FilePath/Rila%20Monastery%2C%20August%202013.jpg', image_credit: { author: 'Raggatt2000', license: 'CC BY-SA 3.0' }, shown: false },
      ],
    },
  ],
  quiet_fields: [
    { field: 'subtitle', why: 'one_source', metres: null },
    { field: 'location', why: 'agree', metres: 8 },
  ],
} as unknown as ReviewQueueItem;

/**
 * The Statue of Liberty (#1975): the World Heritage list resolves its site to
 * Liberty Island, Public art reads the statue, and each links its own article.
 */
const LIBERTY = {
  ...RILA, id: 382, external_id: '307', name: 'Statue of Liberty',
  source_views: [{
    field: 'wikipediaUrl',
    views: [
      { ...UNESCO, membership_id: 327, value: 'https://en.wikipedia.org/wiki/Liberty_Island', image_url: null, image_credit: null, shown: true },
      { ...WIKIDATA, kind_name: 'Public art', source_name: 'Public art', membership_id: 542, value: 'https://en.wikipedia.org/wiki/Statue_of_Liberty', image_url: null, image_credit: null, shown: false },
    ],
  }],
  quiet_fields: [],
} as unknown as ReviewQueueItem;

function renderCard(onDone = vi.fn(), item = RILA) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SourcesCard item={item} onDone={onDone} />
    </QueryClientProvider>,
  );
  return onDone;
}

describe('a place two sources describe differently', () => {
  beforeEach(() => {
    mockedChoose.mockReset();
    mockedSuggest.mockReset();
    mockedSuggest.mockResolvedValue({ configured: false, suggestions: [] });
  });

  it("shows each source's view side by side, readers' one chosen, and says what it does not ask", () => {
    renderCard();

    expect(screen.getByRole('button', { name: /Monastery of Saint John of Rila/ }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getAllByRole('button', { name: /Readers see this · keeping it/ })).toHaveLength(2);
    expect(screen.getByText('Not asked: subtitle (only one source has it), where it is (the points are 8 m apart).')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Keep what readers see' })).toBeTruthy();
  });

  it("publishes Wikidata's name and keeps UNESCO's picture", async () => {
    mockedChoose.mockResolvedValue({ experienceId: 450, fields: ['name', 'imageUrl'], changed: ['name'] });
    const onDone = renderCard();

    fireEvent.click(screen.getByRole('button', { name: /Monastery of Saint John of Rila/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Publish 1 change' }));

    await waitFor(() => expect(mockedChoose).toHaveBeenCalledWith(450, [
      { field: 'name', membershipId: 3045 }, { field: 'imageUrl', membershipId: 379 },
    ]));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(
      'Rila Monastery: now shows name from the source you chose', 450,
    ));
  });

  it("shows Jev's suggestion beside the view it picks, and chooses nothing for the curator", async () => {
    mockedSuggest.mockResolvedValue({ configured: true, suggestions: [{ field: 'name', membershipId: 379, confidence: 0.96 }] });
    renderCard();

    expect(await screen.findByText('Jev suggests this · 96 %')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Monastery of Saint John of Rila/ }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'Keep what readers see' })).toBeTruthy();
  });

  it('offers the article each source links, by its title, with a way to read each (#1975)', async () => {
    mockedChoose.mockResolvedValue({ experienceId: 382, fields: ['wikipediaUrl'], changed: ['wikipediaUrl'] });
    renderCard(vi.fn(), LIBERTY);

    expect(screen.getByText('Wikipedia article')).toBeTruthy();
    const statue = screen.getByRole('link', { name: 'read Statue of Liberty' });
    expect(statue.getAttribute('href')).toBe('https://en.wikipedia.org/wiki/Statue_of_Liberty');
    expect(screen.getByRole('link', { name: 'read Liberty Island' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /^Statue of Liberty/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Publish 1 change' }));
    await waitFor(() => expect(mockedChoose).toHaveBeenCalledWith(382, [{ field: 'wikipediaUrl', membershipId: 542 }]));
  });
});
