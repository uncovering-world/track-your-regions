/**
 * What the component-item search reads from Wikidata's own API (#1272): every
 * label of a candidate, and the picture and description of a confirmed item.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('./wikipediaCategories.js', () => ({ askWikipediaOnce: vi.fn() }));

const { WaitBudget } = await import('./wikidataUtils.js');
const { contentsOf, labelsOf } = await import('./componentItemQueries.js');
const { askWikipediaOnce } = await import('./wikipediaCategories.js');

const hooks = () => ({ budget: new WaitBudget(1000) });

describe('contentsOf', () => {
  it("reads each confirmed item's first picture by its address, its English description and article, skipping a deprecated statement", async () => {
    vi.mocked(askWikipediaOnce).mockResolvedValue({
      entities: {
        Q98501: {
          descriptions: { en: { value: 'Roman fort in Cluj County, Romania' } },
          sitelinks: { enwiki: { title: "Castra of Bologa (Cluj)" } },
          claims: {
            P18: [
              { rank: 'normal', mainsnak: { datavalue: { value: 'Castrul roman (Bologa) 2.jpg' } } },
              { rank: 'deprecated', mainsnak: { datavalue: { value: 'A wrong file.jpg' } } },
              { rank: 'normal', mainsnak: { datavalue: { value: 'Castrul roman (Bologa) 1.jpg' } } },
            ],
          },
        },
        Q98502: { claims: {} },
      },
    } as never);

    const contents = await contentsOf(['Q98501', 'Q98502'], hooks());

    expect(vi.mocked(askWikipediaOnce).mock.calls[0][0]).toMatchObject({
      action: 'wbgetentities', ids: 'Q98501|Q98502', props: 'claims|descriptions|sitelinks', languages: 'en', sitefilter: 'enwiki',
    });
    // The query service's spelling of a file: a space as %20, a parenthesis as %28,
    // so the picture is the same address the run stores for the same file.
    expect(contents.get('Q98501')).toEqual({
      image: 'http://commons.wikimedia.org/wiki/Special:FilePath/Castrul%20roman%20%28Bologa%29%201.jpg',
      description: 'Roman fort in Cluj County, Romania',
      // The title as an article address, parentheses kept as MediaWiki writes them.
      article: 'https://en.wikipedia.org/wiki/Castra_of_Bologa_(Cluj)',
    });
    expect(contents.get('Q98502')).toEqual({ image: null, description: null, article: null });
  });
});

describe('labelsOf', () => {
  it('keeps every label for matching and the English one, else the multilingual one, to name the item by (#1358)', async () => {
    vi.mocked(askWikipediaOnce).mockResolvedValueOnce({
      entities: {
        Q98511: { labels: { tr: { value: 'Bir türbe' }, en: { value: 'A shrine' } } },
        Q98512: { labels: { mul: { value: 'Kastell Fixture' }, de: { value: 'Kastell Fixture' }, ro: { value: 'Castrul Fixture' } } },
        Q98513: { labels: { fr: { value: 'Un phare' } } },
      },
    } as never);

    const labels = await labelsOf(['Q98511', 'Q98512', 'Q98513'], hooks());

    expect(labels.get('Q98511')).toEqual({ all: ['Bir türbe', 'A shrine'], english: 'A shrine' });
    expect(labels.get('Q98512')).toEqual({ all: ['Kastell Fixture', 'Castrul Fixture'], english: 'Kastell Fixture' });
    expect(labels.get('Q98513')).toEqual({ all: ['Un phare'], english: null });
  });
});
