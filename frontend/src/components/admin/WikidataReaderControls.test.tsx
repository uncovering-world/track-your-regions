import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ExperienceSource } from '../../api/admin';
import { queryKeys } from '../../api/queryKeys';

/** The switch between the live Wikidata and the local subset on a source's card (#1459). */

const api = vi.hoisted(() => ({ setWikidataReader: vi.fn(async () => ({})) }));
vi.mock('../../api/admin', async (importOriginal) => ({ ...(await importOriginal<object>()), setWikidataReader: api.setWikidataReader }));

const { WikidataReaderControls } = await import('./WikidataReaderControls');

const source = (over: Partial<ExperienceSource>) => ({ id: 3, subsetReady: true, wikidataReader: 'live', ...over }) as ExperienceSource;

function renderWith(s: ExperienceSource, client = new QueryClient()) {
  return render(
    <QueryClientProvider client={client}>
      <WikidataReaderControls source={s} />
    </QueryClientProvider>,
  );
}

describe('WikidataReaderControls (#1459)', () => {
  it('draws nothing for a source the subset cannot answer', () => {
    const { container } = renderWith(source({ subsetReady: false }));
    expect(container).toBeEmptyDOMElement();
  });

  it('switches a ready source to the local subset', async () => {
    renderWith(source({}));
    fireEvent.click(screen.getByRole('button', { name: 'Local subset' }));
    await vi.waitFor(() => expect(api.setWikidataReader).toHaveBeenCalled());
    expect(api.setWikidataReader).toHaveBeenCalledWith(3, 'subset');
  });

  it('reads the cache section again, which names the dump and keeps fewer kinds on the subset (ADR-0119)', async () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    renderWith(source({}), client);
    fireEvent.click(screen.getByRole('button', { name: 'Local subset' }));
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.admin.wikidataCache(3) }));
  });

  it('says where a source on the subset reads from', () => {
    renderWith(source({ wikidataReader: 'subset' }));
    expect(screen.getByText(/local copy built under Public Dumps/)).toBeInTheDocument();
  });
});
