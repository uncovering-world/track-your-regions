/**
 * One part of a serial object on its own card (#1271), on Prehistoric Pile
 * Dwellings around the Alps: Riesi has its own picture, description and
 * Wikidata item; Spitz has none of them and shows the whole site's picture,
 * said to be the site's.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../api/experiences', () => ({ fetchExperienceLocations: vi.fn() }));
vi.mock('../../api/experienceCardQueries', () => ({
  experienceDetailsQuery: (id: number) => ({
    queryKey: ['experience', id],
    queryFn: async () => ({ id, metadata: { website: 'https://whc.unesco.org/en/list/1363' } }),
  }),
}));

import { PointCard } from './PointCard';
import { fetchExperienceLocations } from '../../api/experiences';

const mockedLocations = fetchExperienceLocations as unknown as ReturnType<typeof vi.fn>;

const SITE = {
  id: 418,
  name: 'Prehistoric Pile Dwellings around the Alps',
  image_url: 'https://commons.wikimedia.org/wiki/Special:FilePath/Pfahlbauten_Unteruhldingen_2005_05.jpg',
  image_credit: { author: 'Gerhard Schauber', license: 'Public domain', licenseUrl: null, detailsUrl: null },
};

function point(over: Record<string, unknown>) {
  return {
    id: 0, experience_id: 418, name: null, external_ref: null, ordinal: 1, latitude: 47.3, longitude: 8.2,
    created_at: '2026-08-04T00:00:00Z', curated_fields: [], in_region: true, curation_state: 'auto', refused_at: null,
    image_url: null, image_credit: null, description: null, wikidata_item: null,
    ...over,
  };
}

const RIESI = point({
  id: 8189, name: 'Riesi', external_ref: '1363-002', ordinal: 2,
  image_url: 'https://commons.wikimedia.org/wiki/Special:FilePath/KAAG_Nachlass_Bosch_Seengen-Riesi_005.jpg',
  image_credit: { author: 'Kantonsarchäologie Aargau', license: 'CC BY-SA 4.0', licenseUrl: null, detailsUrl: null },
  description: 'archaeological site in Seengen in the canton of Aargau, Switzerland',
  wikidata_item: 'Q3477679',
});
const SPITZ = point({ id: 8192, name: 'Spitz', external_ref: '1363-010', ordinal: 3 });
const UNREAD = point({ id: 9999, name: 'Unread', external_ref: '1363-099', ordinal: 4, curation_state: 'pending' });

function renderCard(pointId: number, extra: Partial<Parameters<typeof PointCard>[0]> = {}) {
  const handlers = { onBack: vi.fn(), onOpenPoint: vi.fn(), onPointGone: vi.fn() };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PointCard object={SITE} pointId={pointId} {...handlers} {...extra} />
    </QueryClientProvider>,
  );
  return handlers;
}

beforeEach(() => {
  mockedLocations.mockReset();
  mockedLocations.mockResolvedValue({
    experienceId: 418, experienceName: SITE.name, totalLocations: 3, regionId: null,
    locations: [point({ id: 8188, name: 'See', external_ref: '1363-061' }), RIESI, SPITZ, UNREAD],
  });
});

describe('PointCard', () => {
  it("shows a part's own picture, credit, description and links, and names its object", async () => {
    renderCard(8189);
    expect(await screen.findByRole('heading', { name: 'Riesi' })).toBeInTheDocument();
    expect(screen.getByText('1363-002')).toBeInTheDocument();
    expect(screen.getByText(/Kantonsarchäologie Aargau/)).toBeInTheDocument();
    expect(screen.getByText('archaeological site in Seengen in the canton of Aargau, Switzerland')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Wikidata Q3477679' })).toHaveAttribute('href', 'https://www.wikidata.org/wiki/Q3477679');
    expect(await screen.findByRole('link', { name: "The site's own page" }))
      .toHaveAttribute('href', 'https://whc.unesco.org/en/list/1363');
    // The steps count the parts a visitor sees, not the unread one a curator would.
    expect(screen.getByText('2 of 3')).toBeInTheDocument();
    expect(screen.queryByText(/whole site's picture/)).not.toBeInTheDocument();
  });

  it("shows the whole site's picture, said to be the site's, for a part with none", async () => {
    renderCard(8192);
    expect(await screen.findByRole('heading', { name: 'Spitz' })).toBeInTheDocument();
    expect(screen.getByText("The whole site's picture; this place has none of its own")).toBeInTheDocument();
    expect(screen.getByText(/Gerhard Schauber/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Wikidata/ })).not.toBeInTheDocument();
  });

  it('steps to the next part and back to the object', async () => {
    const { onOpenPoint, onBack } = renderCard(8189);
    await screen.findByRole('heading', { name: 'Riesi' });
    fireEvent.click(screen.getByRole('button', { name: 'Next place' }));
    expect(onOpenPoint).toHaveBeenCalledWith(8192, 'Spitz');
    expect(screen.getByRole('button', { name: 'Next place' })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Previous place' }));
    expect(onOpenPoint).toHaveBeenCalledWith(8188, 'See');
    fireEvent.click(screen.getAllByRole('button', { name: SITE.name })[0]);
    expect(onBack).toHaveBeenCalled();
  });

  it('says a part the object does not hold is gone, once the points have answered', async () => {
    const { onPointGone } = renderCard(4242);
    await waitFor(() => expect(onPointGone).toHaveBeenCalled());
  });

  it('opens an unread part for the curator it was served to, marked, and steps only through what visitors see', async () => {
    const { onPointGone } = renderCard(9999, { visited: { isVisited: false, onToggle: vi.fn() } });
    expect(await screen.findByRole('heading', { name: 'Unread' })).toBeInTheDocument();
    expect(screen.getByText(/Not published yet/)).toBeInTheDocument();
    expect(screen.getByText('3 places')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next place' })).toBeDisabled();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(onPointGone).not.toHaveBeenCalled();
  });

  it("records the visitor's own visit to the part", async () => {
    const onToggle = vi.fn();
    renderCard(8189, { visited: { isVisited: false, onToggle } });
    fireEvent.click(await screen.findByRole('checkbox', { name: 'I have been to Riesi' }));
    expect(onToggle).toHaveBeenCalled();
  });
});
