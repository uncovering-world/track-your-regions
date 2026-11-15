/**
 * A guide's yes that opens the Wikivoyage articles behind it (#2520), on
 * Mantineia (Q1160195), which German and Italian Wikivoyage use, and on the
 * Old Town of Brest in Russian Wikivoyage, whose address is escaped.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GuideArticles } from '../../api/guideArticles';

vi.mock('../../api/guideArticles', () => ({ fetchGuideArticles: vi.fn() }));

import { fetchGuideArticles } from '../../api/guideArticles';
import { GuideArticlesButton } from './GuideArticlesButton';

const fetched = fetchGuideArticles as unknown as ReturnType<typeof vi.fn>;

const MANTINEIA: GuideArticles = {
  item: 'Q1160195',
  articlesKept: true,
  articles: [
    { site: 'dewikivoyage', language: 'de', title: 'Mantineia', url: 'https://de.wikivoyage.org/wiki/Mantineia' },
    { site: 'itwikivoyage', language: 'it', title: 'Mantinea', url: 'https://it.wikivoyage.org/wiki/Mantinea' },
    {
      site: 'ruwikivoyage', language: 'ru', title: 'Старый Брест',
      url: 'https://ru.wikivoyage.org/wiki/%D0%A1%D1%82%D0%B0%D1%80%D1%8B%D0%B9_%D0%91%D1%80%D0%B5%D1%81%D1%82',
    },
  ],
  truncated: false,
};

/** The button inside a row that answers a click and a key of its own, as a queue row and a crowded-city row do. */
function show() {
  const onRowClick = vi.fn();
  const onRowKey = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <div role="row" tabIndex={0} onClick={onRowClick} onKeyDown={onRowKey}>
        <GuideArticlesButton membershipId={41} placeName="Mantineia">yes</GuideArticlesButton>
      </div>
    </QueryClientProvider>,
  );
  return { onRowClick, onRowKey, trigger: screen.getByRole('button', { name: /^yes, the Wikivoyage articles about Mantineia$/ }) };
}

const open = (trigger: HTMLElement) => {
  trigger.focus();
  fireEvent.click(trigger);
  return screen.getByRole('dialog', { name: 'Wikivoyage articles about Mantineia' });
};

/** A click on an article's link must not make the test environment open the article: nothing here goes out. */
const stayHere = (event: MouseEvent) => {
  if ((event.target as Element).closest('a')) event.preventDefault();
};

beforeEach(() => {
  fetched.mockReset();
  document.addEventListener('click', stayHere, { capture: true });
  return () => document.removeEventListener('click', stayHere, { capture: true });
});

describe('GuideArticlesButton', () => {
  it('reads nothing until it is opened, and is a button a keyboard and a touch reach', () => {
    const { trigger } = show();
    expect(fetched).not.toHaveBeenCalled();
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger).toHaveAttribute('type', 'button');
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('says it is reading, then lists every article with its language and its own address, in a new tab', async () => {
    const answers: Array<(value: GuideArticles) => void> = [];
    fetched.mockReturnValue(new Promise<GuideArticles>(resolve => { answers.push(resolve); }));
    const { trigger } = show();
    const dialog = open(trigger);
    expect(fetched).toHaveBeenCalledWith(41);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(within(dialog).getByRole('status')).toHaveTextContent('Reading the Wikivoyage articles…');

    answers[0](MANTINEIA);
    const list = await within(dialog).findByRole('list', { name: 'Wikivoyage articles' });
    expect(within(dialog).getByText('Used in 3 articles:')).toBeTruthy();
    const links = within(list).getAllByRole('link');
    expect(links.map(link => link.textContent)).toEqual(['Mantineia', 'Mantinea', 'Старый Брест']);
    expect(links.map(link => link.getAttribute('href'))).toEqual(MANTINEIA.articles.map(article => article.url));
    for (const link of links) {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    }
    expect(within(list).getByText('German Wikivoyage')).toBeTruthy();
    expect(within(list).getByText('Russian Wikivoyage')).toBeTruthy();
    expect(within(list).getByText('Старый Брест')).toHaveAttribute('lang', 'ru');
  });

  it('never chooses, ticks or opens the row it sits in, by a click, a key or a link', async () => {
    fetched.mockResolvedValue(MANTINEIA);
    const { trigger, onRowClick, onRowKey } = show();
    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.keyDown(trigger, { key: ' ' });
    const dialog = open(trigger);
    const [first] = await within(dialog).findAllByRole('link');
    fireEvent.click(first);
    fireEvent.click(within(dialog).getByText('Used in 3 articles:'));
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(onRowClick).not.toHaveBeenCalled();
    expect(onRowKey).not.toHaveBeenCalled();
  });

  it('closes on Escape and gives the focus back to its button', async () => {
    fetched.mockResolvedValue(MANTINEIA);
    const { trigger, onRowKey } = show();
    const dialog = open(trigger);
    await within(dialog).findAllByRole('link');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(trigger);
    expect(onRowKey).not.toHaveBeenCalled();
  });

  it('says what failed and reads again on Try again', async () => {
    fetched.mockRejectedValueOnce(new Error('503')).mockResolvedValueOnce(MANTINEIA);
    const { trigger } = show();
    const dialog = open(trigger);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/^The articles could not be read\.Try again$/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Try again' }));
    expect(await within(dialog).findByRole('list', { name: 'Wikivoyage articles' })).toBeTruthy();
    expect(fetched).toHaveBeenCalledTimes(2);
  });

  it('says a copy read before the articles were kept apart from no article, and never as no guide', async () => {
    fetched.mockResolvedValue({ ...MANTINEIA, articlesKept: false, articles: [] });
    const { trigger } = show();
    const dialog = open(trigger);
    const notKept = await within(dialog).findByTestId('guide-articles-not-kept');
    expect(notKept).toHaveTextContent('The articles are not listed yet.');
    expect(notKept).toHaveTextContent('this does not mean no guide uses it');
    expect(within(dialog).queryByTestId('guide-articles-none')).toBeNull();
  });

  it('says where no article in the data in place uses the item', async () => {
    fetched.mockResolvedValue({ ...MANTINEIA, articles: [] });
    const { trigger } = show();
    const dialog = open(trigger);
    expect(await within(dialog).findByTestId('guide-articles-none')).toHaveTextContent(/^No article in the Wikivoyage data in place uses this place now\. The yes was read from older data\.$/);
    expect(within(dialog).queryByRole('list')).toBeNull();
  });

  it('says where the place has no item to read articles for', async () => {
    fetched.mockResolvedValue({ item: null, articlesKept: true, articles: [], truncated: false });
    const { trigger } = show();
    const dialog = open(trigger);
    expect(await within(dialog).findByTestId('guide-articles-none')).toHaveTextContent('This place has no Wikidata item');
  });

  it('scrolls a long list, and says where it lists only the first articles', async () => {
    const articles = Array.from({ length: 1000 }, (_, i) => ({
      site: 'enwikivoyage', language: 'en', title: `Article ${i}`, url: `https://en.wikivoyage.org/wiki/Article_${i}`,
    }));
    fetched.mockResolvedValue({ ...MANTINEIA, articles, truncated: true });
    const { trigger } = show();
    const dialog = open(trigger);
    const list = await within(dialog).findByRole('list', { name: 'Wikivoyage articles' });
    expect(list).toHaveStyle({ overflowY: 'auto' });
    expect(within(dialog).getByText('Only the first 1,000 articles are listed.')).toBeTruthy();
  });
});
