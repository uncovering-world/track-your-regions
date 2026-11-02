/**
 * A Wikipedia link in the reader's language (#2209): the Altes Museum's
 * English article opens in Russian for a reader who reads Russian first, says
 * so, and stays English for one who reads English first.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const { order, fetchEdition } = vi.hoisted(() => ({ order: { current: ['ru', 'en'] }, fetchEdition: vi.fn() }));
vi.mock('../../hooks/useReadingLanguages', () => ({
  useReadingLanguages: () => ({ order: order.current }),
}));
vi.mock('../../api/wikipediaEditions', () => ({ fetchReaderEdition: fetchEdition }));

import { PlaceLinks } from './PlaceLinks';
import { ReaderEditionBeside } from './WikipediaArticleLink';

const ALTES = 'https://en.wikipedia.org/wiki/Altes_Museum';
const RU = 'https://ru.wikipedia.org/wiki/%D0%A1%D1%82%D0%B0%D1%80%D1%8B%D0%B9_%D0%BC%D1%83%D0%B7%D0%B5%D0%B9';

beforeEach(() => {
  fetchEdition.mockReset();
});

describe('a Wikipedia link in the reader\'s language', () => {
  it('opens the item\'s article in the reader\'s first language and says which', async () => {
    order.current = ['ru', 'en'];
    fetchEdition.mockResolvedValue({ url: RU, language: 'ru' });
    render(<PlaceLinks metadata={{ wikipediaUrl: ALTES }} />);

    expect(await screen.findByRole('link', { name: 'Wikipedia (ru)' })).toHaveAttribute('href', RU);
    expect(fetchEdition).toHaveBeenCalledWith(ALTES, ['ru']);
  });

  it('keeps the English article where the item has none in the reader\'s languages', async () => {
    order.current = ['ja', 'en'];
    fetchEdition.mockResolvedValue(null);
    render(<PlaceLinks metadata={{ wikipediaUrl: 'https://en.wikipedia.org/wiki/Pergamon_Altar' }} />);

    await vi.waitFor(() => expect(fetchEdition).toHaveBeenCalled());
    expect(screen.getByRole('link', { name: 'Wikipedia' })).toHaveAttribute('href', 'https://en.wikipedia.org/wiki/Pergamon_Altar');
  });

  it('asks nothing for a reader who reads English first', () => {
    order.current = ['en', 'ru'];
    render(<PlaceLinks metadata={{ wikipediaUrl: ALTES }} />);

    expect(screen.getByRole('link', { name: 'Wikipedia' })).toHaveAttribute('href', ALTES);
    expect(fetchEdition).not.toHaveBeenCalled();
  });

  it('offers a curator the reader\'s edition beside the English reference, and nothing where it is English', async () => {
    order.current = ['de', 'en'];
    fetchEdition.mockResolvedValue({ url: 'https://de.wikipedia.org/wiki/Altes_Museum', language: 'de' });
    const { unmount } = render(<ReaderEditionBeside article="https://en.wikipedia.org/wiki/Altes_Museum_(Berlin)" />);
    expect(await screen.findByRole('link', { name: 'The same article in de' })).toHaveTextContent('(de)');
    unmount();

    order.current = ['en'];
    const { container } = render(<ReaderEditionBeside article={ALTES} />);
    expect(container).toBeEmptyDOMElement();
  });
});
