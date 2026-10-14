import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ExperienceSource } from '../../api/admin';

/** The switch between the live Wikidata and the local subset on a source's card (#1459). */

const api = vi.hoisted(() => ({ setWikidataReader: vi.fn(async () => ({})) }));
vi.mock('../../api/admin', async (importOriginal) => ({ ...(await importOriginal<object>()), setWikidataReader: api.setWikidataReader }));

const { WikidataReaderControls } = await import('./WikidataReaderControls');

const source = (over: Partial<ExperienceSource>) => ({ id: 3, subsetReady: true, wikidataReader: 'live', ...over }) as ExperienceSource;

function renderWith(s: ExperienceSource) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
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

  it('says where a source on the subset reads from', () => {
    renderWith(source({ wikidataReader: 'subset' }));
    expect(screen.getByText(/local copy built under Public Dumps/)).toBeInTheDocument();
  });
});
