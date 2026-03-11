import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildTree, countNodes } from '../treeBuilder.js';
import type { ExtractionProgress, TreeNode } from '../types.js';
import { createInitialExtractionProgress } from '../types.js';

// ─── Mock fetcher ───────────────────────────────────────────────────────────

/** Create a mock fetcher that returns pre-recorded API responses */
function createMockFetcher(responses: Record<string, Record<string, unknown>>) {
  return {
    apiGet: vi.fn(async (params: Record<string, string | number>) => {
      const key = JSON.stringify(params, Object.keys(params).sort());
      return responses[key] ?? { error: { code: 'not_found' } };
    }),
    save: vi.fn(),
    apiRequestCount: 0,
    cacheSize: 0,
  };
}

/** Build a cache key like FileCache.buildKey */
function key(params: Record<string, string | number>): string {
  return JSON.stringify(params, Object.keys(params).sort());
}

/** Build a sections response */
function sectionsResponse(title: string, sections: Array<{ index: string; line: string }>) {
  return {
    parse: { title, sections },
  };
}

/** Build a wikitext response */
function wikitextResponse(title: string, wikitext: string) {
  return {
    parse: { title, wikitext: { '*': wikitext } },
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('buildTree', () => {
  let progress: ExtractionProgress;

  beforeEach(() => {
    progress = createInitialExtractionProgress();
  });

  it('builds a simple 2-level tree', async () => {
    // Europe has 2 regions: France and Germany
    // France and Germany are leaf pages (no Regions section)
    const responses: Record<string, Record<string, unknown>> = {
      // Europe sections
      [key({ action: 'parse', page: 'Europe', prop: 'sections', redirects: '1' })]:
        sectionsResponse('Europe', [{ index: '1', line: 'Regions' }, { index: '2', line: 'Cities' }]),
      // Europe regions wikitext
      [key({ action: 'parse', page: 'Europe', prop: 'wikitext', section: '1' })]:
        wikitextResponse('Europe', `{{Regionlist
| regionmap=Europe_map.svg
| region1name=[[France]]
| region1items=
| region2name=[[Germany]]
| region2items=
}}`),
      // Europe full page (for fallback map)
      [key({ action: 'parse', page: 'Europe', prop: 'wikitext' })]:
        wikitextResponse('Europe', '[[File:Europe_map.svg|300px]]'),

      // France sections (no Regions section)
      [key({ action: 'parse', page: 'France', prop: 'sections', redirects: '1' })]:
        sectionsResponse('France', [{ index: '1', line: 'Understand' }]),
      [key({ action: 'parse', page: 'France', prop: 'wikitext' })]:
        wikitextResponse('France', ''),

      // Germany sections (no Regions section)
      [key({ action: 'parse', page: 'Germany', prop: 'sections', redirects: '1' })]:
        sectionsResponse('Germany', [{ index: '1', line: 'Understand' }]),
      [key({ action: 'parse', page: 'Germany', prop: 'wikitext' })]:
        wikitextResponse('Germany', ''),
    };

    const fetcher = createMockFetcher(responses);
    const result = await buildTree(
      fetcher as unknown as Parameters<typeof buildTree>[0],
      'Europe', 3, progress,
    );

    expect(result).not.toBe('self_ref');
    expect(result).not.toBe('missing');
    const tree = result as TreeNode;
    expect(tree.name).toBe('Europe');
    expect(tree.children).toHaveLength(2);
    expect(tree.children[0].name).toBe('France');
    expect(tree.children[1].name).toBe('Germany');
    expect(tree.regionMapUrl).toContain('Europe_map.svg');
  });

  it('handles self-reference', async () => {
    // Page links to itself
    const responses: Record<string, Record<string, unknown>> = {
      [key({ action: 'parse', page: 'A', prop: 'sections', redirects: '1' })]:
        sectionsResponse('A', [{ index: '1', line: 'Regions' }]),
      [key({ action: 'parse', page: 'A', prop: 'wikitext', section: '1' })]:
        wikitextResponse('A', `{{Regionlist
| region1name=[[A]]
| region1items=
| region2name=[[B]]
| region2items=
}}`),
      [key({ action: 'parse', page: 'A', prop: 'wikitext' })]:
        wikitextResponse('A', ''),
      // B is a leaf
      [key({ action: 'parse', page: 'B', prop: 'sections', redirects: '1' })]:
        sectionsResponse('B', []),
      [key({ action: 'parse', page: 'B', prop: 'wikitext' })]:
        wikitextResponse('B', ''),
    };

    const fetcher = createMockFetcher(responses);
    const result = await buildTree(
      fetcher as unknown as Parameters<typeof buildTree>[0],
      'A', 5, progress,
    );

    const tree = result as TreeNode;
    expect(tree.name).toBe('A');
    // Self-ref should become a leaf child
    expect(tree.children).toHaveLength(2);
    expect(tree.children[0].name).toBe('A');
    expect(tree.children[0].children).toHaveLength(0);
    expect(tree.children[1].name).toBe('B');
  });

  it('handles missing pages', async () => {
    const responses: Record<string, Record<string, unknown>> = {
      [key({ action: 'parse', page: 'Root', prop: 'sections', redirects: '1' })]:
        sectionsResponse('Root', [{ index: '1', line: 'Regions' }]),
      [key({ action: 'parse', page: 'Root', prop: 'wikitext', section: '1' })]:
        wikitextResponse('Root', `{{Regionlist
| region1name=[[Exists]]
| region1items=
| region2name=[[Missing]]
| region2items=
}}`),
      [key({ action: 'parse', page: 'Root', prop: 'wikitext' })]:
        wikitextResponse('Root', ''),
      // Exists is a leaf
      [key({ action: 'parse', page: 'Exists', prop: 'sections', redirects: '1' })]:
        sectionsResponse('Exists', []),
      [key({ action: 'parse', page: 'Exists', prop: 'wikitext' })]:
        wikitextResponse('Exists', ''),
      // Missing returns error
      [key({ action: 'parse', page: 'Missing', prop: 'sections', redirects: '1' })]:
        { error: { code: 'missingtitle' } },
    };

    const fetcher = createMockFetcher(responses);
    const result = await buildTree(
      fetcher as unknown as Parameters<typeof buildTree>[0],
      'Root', 5, progress,
    );

    const tree = result as TreeNode;
    // Missing page is skipped. Only "Exists" (a leaf) remains, so the
    // single-leaf-child optimization collapses it — Root becomes a leaf.
    expect(tree.children).toHaveLength(0);
  });

  it('respects maxDepth', async () => {
    // Need 2+ children to avoid single-subregion leaf optimization
    const responses: Record<string, Record<string, unknown>> = {
      [key({ action: 'parse', page: 'A', prop: 'sections', redirects: '1' })]:
        sectionsResponse('A', [{ index: '1', line: 'Regions' }]),
      [key({ action: 'parse', page: 'A', prop: 'wikitext', section: '1' })]:
        wikitextResponse('A', `{{Regionlist
| region1name=[[B]]
| region1items=
| region2name=[[C]]
| region2items=
}}`),
      [key({ action: 'parse', page: 'A', prop: 'wikitext' })]:
        wikitextResponse('A', ''),
    };

    const fetcher = createMockFetcher(responses);
    const result = await buildTree(
      fetcher as unknown as Parameters<typeof buildTree>[0],
      'A', 1, progress,
    );

    const tree = result as TreeNode;
    expect(tree.name).toBe('A');
    // B and C reached maxDepth so they're leaves with no further fetching
    expect(tree.children).toHaveLength(2);
    expect(tree.children[0].name).toBe('B');
    expect(tree.children[0].children).toHaveLength(0);
    expect(tree.children[1].name).toBe('C');
    expect(tree.children[1].children).toHaveLength(0);
  });

  it('handles grouping nodes', async () => {
    const responses: Record<string, Record<string, unknown>> = {
      [key({ action: 'parse', page: 'Root', prop: 'sections', redirects: '1' })]:
        sectionsResponse('Root', [{ index: '1', line: 'Regions' }]),
      [key({ action: 'parse', page: 'Root', prop: 'wikitext', section: '1' })]:
        wikitextResponse('Root', `{{Regionlist
| region1name=Island Group
| region1items=[[IslandA]], [[IslandB]]
}}`),
      [key({ action: 'parse', page: 'Root', prop: 'wikitext' })]:
        wikitextResponse('Root', ''),
      // IslandA and IslandB are leaves
      [key({ action: 'parse', page: 'IslandA', prop: 'sections', redirects: '1' })]:
        sectionsResponse('IslandA', []),
      [key({ action: 'parse', page: 'IslandA', prop: 'wikitext' })]:
        wikitextResponse('IslandA', ''),
      [key({ action: 'parse', page: 'IslandB', prop: 'sections', redirects: '1' })]:
        sectionsResponse('IslandB', []),
      [key({ action: 'parse', page: 'IslandB', prop: 'wikitext' })]:
        wikitextResponse('IslandB', ''),
    };

    const fetcher = createMockFetcher(responses);
    const result = await buildTree(
      fetcher as unknown as Parameters<typeof buildTree>[0],
      'Root', 5, progress,
    );

    const tree = result as TreeNode;
    expect(tree.children).toHaveLength(1);
    const group = tree.children[0];
    expect(group.name).toBe('Island Group');
    expect(group.children).toHaveLength(2);
    expect(group.children[0].name).toBe('IslandA');
    expect(group.children[1].name).toBe('IslandB');
  });

  it('cancellation stops tree building', async () => {
    const responses: Record<string, Record<string, unknown>> = {
      [key({ action: 'parse', page: 'Root', prop: 'sections', redirects: '1' })]:
        sectionsResponse('Root', [{ index: '1', line: 'Regions' }]),
      [key({ action: 'parse', page: 'Root', prop: 'wikitext', section: '1' })]:
        wikitextResponse('Root', `{{Regionlist
| region1name=[[A]]
| region1items=
| region2name=[[B]]
| region2items=
}}`),
      [key({ action: 'parse', page: 'Root', prop: 'wikitext' })]:
        wikitextResponse('Root', ''),
      [key({ action: 'parse', page: 'A', prop: 'sections', redirects: '1' })]:
        sectionsResponse('A', []),
      [key({ action: 'parse', page: 'A', prop: 'wikitext' })]:
        wikitextResponse('A', ''),
    };

    const fetcher = createMockFetcher(responses);

    // Cancel after first region fetch
    const origApiGet = fetcher.apiGet;
    let callCount = 0;
    fetcher.apiGet = vi.fn(async (params) => {
      callCount++;
      if (callCount > 3) progress.cancel = true; // Cancel after Root's sections + wikitext + fullpage
      return origApiGet(params);
    });

    const result = await buildTree(
      fetcher as unknown as Parameters<typeof buildTree>[0],
      'Root', 5, progress,
    );

    const tree = result as TreeNode;
    // Tree should be incomplete (cancelled before processing children)
    expect(tree.name).toBe('Root');
  });
});

describe('decision logging', () => {
  let progress: ExtractionProgress;

  beforeEach(() => {
    progress = createInitialExtractionProgress();
  });

  it('createInitialExtractionProgress includes empty decisions array', () => {
    const progress = createInitialExtractionProgress();
    expect(progress.decisions).toEqual([]);
  });

  it('logs city_districts decision when page has district subpages', async () => {
    const responses: Record<string, Record<string, unknown>> = {
      [key({ action: 'parse', page: 'CityX', prop: 'sections', redirects: '1' })]:
        sectionsResponse('CityX', [{ index: '1', line: 'Regions' }]),
      [key({ action: 'parse', page: 'CityX', prop: 'wikitext', section: '1' })]:
        wikitextResponse('CityX', `{{Regionlist
| region1name=[[CityX/Central]]
| region1items=
| region2name=[[CityX/North]]
| region2items=
}}`),
      [key({ action: 'parse', page: 'CityX', prop: 'wikitext' })]:
        wikitextResponse('CityX', ''),
    };

    const fetcher = createMockFetcher(responses);
    const result = await buildTree(
      fetcher as unknown as Parameters<typeof buildTree>[0],
      'CityX', 3, progress,
    );

    expect(result).not.toBe('missing');
    const tree = result as TreeNode;
    expect(tree.children).toHaveLength(0);

    expect(progress.decisions).toContainEqual(
      expect.objectContaining({
        page: 'CityX',
        decision: 'leaf',
        decidedBy: 'city_districts',
      }),
    );
  });
});

describe('countNodes', () => {
  it('counts a single node', () => {
    expect(countNodes({ name: 'A', children: [] })).toBe(1);
  });

  it('counts nested tree', () => {
    const tree: TreeNode = {
      name: 'Root',
      children: [
        { name: 'A', children: [{ name: 'A1', children: [] }] },
        { name: 'B', children: [] },
      ],
    };
    expect(countNodes(tree)).toBe(4);
  });
});
