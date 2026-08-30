/**
 * Tests for the preview a curator follows a waiting card through to.
 *
 * One promise, and it is invisible from outside: `GatedCard` is mounted without
 * a key and `showObject` survives moving between two waiting rows, so a new
 * `experienceId` reconciles into the *same* `ObjectPreview` instance. A picture
 * that refused to load therefore has to be remembered as a URL rather than as a
 * flag — held as a flag, one object's 403 would blank the next object's picture
 * and take its credit with it, which is a false statement about a photograph
 * that is there. On this screen the refusal is the ordinary case: most of what
 * the queue holds is UNESCO, and four of those URLs in five answer 403 (#557).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ExperienceDetail } from '../../api/experiences';

const fetchExperience = vi.fn();

vi.mock('../../api/experiences', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../api/experiences');
  return { ...actual, fetchExperience: (id: number) => fetchExperience(id) };
});

import { ObjectPreview } from './ObjectPreview';

function detail(over: Partial<ExperienceDetail> = {}): ExperienceDetail {
  return {
    id: 1, external_id: 'Q1', name: 'Aksum', short_description: null, category: null,
    country_codes: [], country_names: [], image_url: null, in_danger: false,
    longitude: 38.7, latitude: 14.1, category_name: 'UNESCO World Heritage Sites',
    category_id: 1, name_local: null, description: 'A place.', tags: null,
    metadata: null, boundary_geojson: null, area_km2: null, category_description: null,
    regions: [],
    ...over,
  } as ExperienceDetail;
}

/** A Commons picture with a photographer who must be named. */
function withPicture(id: number, file: string): ExperienceDetail {
  return detail({
    id,
    image_url: `http://commons.wikimedia.org/wiki/Special:FilePath/${file}`,
    metadata: {
      imageCredit: {
        author: 'Mbzt', license: 'CC BY-SA 4.0', licenseUrl: null,
        detailsUrl: `https://commons.wikimedia.org/wiki/File:${file}`,
      },
    },
  });
}

function renderPreview(experienceId: number) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = (id: number) => (
    <QueryClientProvider client={client}>
      <ObjectPreview experienceId={id} />
    </QueryClientProvider>
  );
  const utils = render(ui(experienceId));
  return { ...utils, show: (id: number) => utils.rerender(ui(id)) };
}

describe('the object a waiting card opens', () => {
  beforeEach(() => fetchExperience.mockReset());

  it('names the photographer of the picture it draws', async () => {
    fetchExperience.mockResolvedValue(withPicture(1, 'Mesha.jpg'));

    renderPreview(1);

    expect(await screen.findByRole('link', { name: 'Mbzt' })).toBeInTheDocument();
  });

  it('takes the credit away with a picture that did not arrive', async () => {
    fetchExperience.mockResolvedValue(withPicture(1, 'Mesha.jpg'));
    renderPreview(1);
    await screen.findByRole('link', { name: 'Mbzt' });

    fireEvent.error(screen.getByAltText('Aksum'));

    expect(screen.queryByRole('link', { name: 'Mbzt' })).not.toBeInTheDocument();
    // The card itself stays: this is a preview of an object, not of a picture.
    expect(screen.getByText('A place.')).toBeInTheDocument();
  });

  it('does not carry one object\'s failed picture onto the next', async () => {
    fetchExperience.mockImplementation(async (id: number) =>
      (id === 1 ? withPicture(1, 'Broken.jpg') : withPicture(2, 'Stonehenge.jpg')));

    const { show } = renderPreview(1);
    await screen.findByRole('link', { name: 'Mbzt' });
    fireEvent.error(screen.getByAltText('Aksum'));
    expect(screen.queryByRole('link', { name: 'Mbzt' })).not.toBeInTheDocument();

    // The same instance, a different object — which is what the bench does when a
    // curator moves between two waiting rows.
    show(2);

    expect(await screen.findByRole('link', { name: 'Mbzt' })).toBeInTheDocument();
    expect(screen.getByAltText('Aksum')).toBeInTheDocument();
  });
});
