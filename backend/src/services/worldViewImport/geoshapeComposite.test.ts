import { describe, it, expect, vi, beforeEach } from 'vitest';

const poolQuery = vi.fn();
vi.mock('../../db/index.js', () => ({ pool: { query: (...args: unknown[]) => poolQuery(...args) } }));
const parts = vi.fn<() => Promise<Array<{ part: { value: string } }>>>();
vi.mock('../sync/wikidataUtils.js', () => ({
  sparqlQuery: () => parts(),
  extractQid: (uri: string) => uri.slice(uri.lastIndexOf('/') + 1),
}));
const shaped = new Set<string>();
vi.mock('./geoshapeCache.js', () => ({ getOrFetchGeoshape: async (qid: string) => shaped.has(qid) }));

const { tryBuildCompositeGeoshape } = await import('./geoshapeComposite.js');

/** Lower Egypt (Q463871) and four parts, of which the given ones have a shape. */
function lowerEgypt(withShape: string[]): void {
  parts.mockResolvedValue(['Q1', 'Q2', 'Q3', 'Q4'].map(q => ({ part: { value: `http://www.wikidata.org/entity/${q}` } })));
  shaped.clear();
  for (const q of withShape) shaped.add(q);
}

const inserted = () => poolQuery.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO wikidata_geoshapes'));

describe('tryBuildCompositeGeoshape (#1628)', () => {
  beforeEach(() => {
    poolQuery.mockReset();
    poolQuery.mockImplementation(async (sql: string) => (String(sql).includes('geom IS NOT NULL AS valid') ? { rows: [{ valid: true }] } : { rows: [] }));
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('builds no composite from some of the parts, so the item counts as having no shape', async () => {
    lowerEgypt(['Q2']);

    expect(await tryBuildCompositeGeoshape('Q463871')).toBe(false);
    expect(inserted()).toBeUndefined();
  });

  it('builds it from every part, and records how many', async () => {
    lowerEgypt(['Q1', 'Q2', 'Q3', 'Q4']);

    expect(await tryBuildCompositeGeoshape('Q463871')).toBe(true);
    expect(inserted()?.[1]).toEqual(['Q463871', ['Q1', 'Q2', 'Q3', 'Q4'], 4]);
  });
});

describe('tryBuildCompositeGeoshape when not every part can be read (#1628)', () => {
  beforeEach(() => {
    poolQuery.mockReset();
    poolQuery.mockImplementation(async () => ({ rows: [] }));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('builds nothing when the parts question goes unanswered, though the parts found all have shapes', async () => {
    // Wikidata's answer is lost; the regionlist still names two parts, both shaped.
    parts.mockRejectedValue(new Error('SPARQL 504'));
    shaped.clear();
    shaped.add('Q1');
    shaped.add('Q2');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input).includes('action=parse')) {
        return new Response(JSON.stringify({ parse: { wikitext: { '*': 'region1name=[[Alexandria]]\nregion2name=[[Cairo]]' } } }));
      }
      return new Response(JSON.stringify({ query: { pages: { 1: { pageprops: { wikibase_item: 'Q1' } }, 2: { pageprops: { wikibase_item: 'Q2' } } } } }));
    });

    expect(await tryBuildCompositeGeoshape('Q463871', 'https://en.wikivoyage.org/wiki/Lower_Egypt')).toBe(false);
    expect(inserted()).toBeUndefined();
    fetchMock.mockRestore();
  });

  it('builds nothing when a regionlist title has no item to count', async () => {
    lowerEgypt(['Q1', 'Q2', 'Q3', 'Q4']);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('action=parse')) {
        return new Response(JSON.stringify({ parse: { wikitext: { '*': 'region1name=[[Alexandria]]\nregion2name=[[Nile Delta villages]]' } } }));
      }
      return new Response(JSON.stringify({ query: { pages: {
        1: { pageprops: { wikibase_item: 'Q1' } },
        '-1': { title: 'Nile Delta villages', missing: '' },
      } } }));
    });

    expect(await tryBuildCompositeGeoshape('Q463871', 'https://en.wikivoyage.org/wiki/Lower_Egypt')).toBe(false);
    expect(inserted()).toBeUndefined();
    fetchMock.mockRestore();
  });

  it('builds nothing when the title lookup answers without a page map', async () => {
    lowerEgypt(['Q1', 'Q2', 'Q3', 'Q4']);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input).includes('action=parse')) {
        return new Response(JSON.stringify({ parse: { wikitext: { '*': 'region1name=[[Alexandria]]' } } }));
      }
      return new Response(JSON.stringify({ batchcomplete: '' }));
    });

    expect(await tryBuildCompositeGeoshape('Q463871', 'https://en.wikivoyage.org/wiki/Lower_Egypt')).toBe(false);
    expect(inserted()).toBeUndefined();
    fetchMock.mockRestore();
  });
});
