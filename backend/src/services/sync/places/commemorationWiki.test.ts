/**
 * The commemorates reading's door to Wikipedia asked of another edition than
 * English (#2491): the lead of a place's article in its country's language,
 * and the item of a title that lead links, each asked of that edition on the
 * run's transport, User-Agent and pace. No wiki is asked; the fetchers are
 * stood in for. Peter the Great (Q8479) is read off the #2435 measurement.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./warNarrowing.js', async (actual) => ({ ...(await actual<object>()), fetchLeads: vi.fn(async () => new Map()) }));
vi.mock('../wikipediaArticles.js', () => ({ resolveWikipediaArticles: vi.fn() }));
vi.mock('../wikipediaStructure.js', () => ({ structureArticleItems: vi.fn(async () => []), structureCategories: vi.fn() }));

import { resolveWikipediaArticles } from '../wikipediaArticles.js';
import { structureArticleItems } from '../wikipediaStructure.js';
import type { CategoryOptions } from '../wikipediaCategories.js';
import { structureWiki } from './commemorates.js';
import { fetchLeads } from './warNarrowing.js';

const PETER = 'Q8479';
const options: CategoryOptions = { userAgent: 'the-run-user-agent', pause: async () => undefined };

describe('the door asked of another edition', () => {
  beforeEach(() => vi.clearAllMocks());

  it('asks the lead of the edition the host names, as a model\'s input, with the run\'s User-Agent and pace', async () => {
    await structureWiki(options).leads(['Памятник Петру I'], true, 'ru');
    expect(fetchLeads).toHaveBeenCalledWith(['Памятник Петру I'], {
      ...options, modelInput: true, endpoint: 'https://ru.wikipedia.org/w/api.php',
    });
  });

  it('asks English Wikipedia\'s lead as before where no host, or English, is named', async () => {
    const wiki = structureWiki(options);
    await wiki.leads(['Shaheed Minar, Dhaka'], true);
    await wiki.leads(['Shaheed Minar, Dhaka'], true, 'en');
    for (const call of vi.mocked(fetchLeads).mock.calls) expect(call[1]).toEqual({ ...options, modelInput: true });
  });

  it('resolves a title on the edition that links it, through that edition\'s own lookup, never English Wikipedia\'s copy', async () => {
    vi.mocked(resolveWikipediaArticles).mockResolvedValue(new Map([['ru:Пётр I', PETER]]));
    const items = await structureWiki(options).articleItems(['Пётр I'], 'ru');
    expect(resolveWikipediaArticles).toHaveBeenCalledWith(['ru:Пётр I'], options);
    expect(structureArticleItems).not.toHaveBeenCalled();
    expect(items).toEqual(new Map([['Пётр I', { item: PETER, redirected: false }]]));
  });
});
