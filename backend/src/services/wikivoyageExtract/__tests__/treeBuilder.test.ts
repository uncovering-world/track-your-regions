import { describe, it, expect, vi, beforeEach } from 'vitest';
import { applyAnsweredRegions, applyUntilSettled, buildTree, countNodes } from '../treeBuilder.js';
import type { ExtractionProgress, PendingAIQuestion, RegionPreview, TreeNode } from '../types.js';
import { createInitialExtractionProgress } from '../types.js';
import { extractRegionsWithAI } from '../aiRegionParser.js';

// The model is reached only by a spec that hands buildTree an AI context; the
// rest pass none, so these stand in for the model without touching them. Such
// a spec passes no OpenAI client, so the classifier returns before it reads its
// model setting from the database, which the unit lane does not have.
vi.mock('../aiRegionParser.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../aiRegionParser.js')>(),
  extractRegionsWithAI: vi.fn(),
}));
vi.mock('../../ai/openaiService.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../ai/openaiService.js')>(),
  isOpenAIAvailable: () => true,
}));

// ─── English Wikivoyage, as a few pages ─────────────────────────────────────

/** The pages a spec reads, each title's wikitext; a title not listed has no page. */
function fakeWiki(pages: Record<string, string>) {
  return {
    article: vi.fn(async (title: string) => (Object.hasOwn(pages, title) ? { title, wikitext: pages[title] } : null)),
    checkPagesExist: vi.fn(async (titles: string[]) => new Map(titles.map(title => [title, Object.hasOwn(pages, title)]))),
    wikidataIds: vi.fn(async () => new Map<string, string>()),
  };
}

/** An article whose Regions section holds a Regionlist of `regions`, its parameters one per line. */
const withRegions = (regions: string, rest = '') => `== Regions ==\n{{Regionlist\n${regions}\n}}\n${rest}`;

/** A leaf's article: it has sections, none of them Regions. */
const LEAF = '== Understand ==\nA place.';

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('buildTree', () => {
  let progress: ExtractionProgress;

  beforeEach(() => {
    progress = createInitialExtractionProgress();
  });

  it('builds a simple 2-level tree', async () => {
    // Europe has 2 regions: France and Germany, both leaf pages (no Regions section)
    const wiki = fakeWiki({
      Europe: withRegions(
        '| regionmap=Europe_map.svg\n| region1name=[[France]]\n| region1items=\n| region2name=[[Germany]]\n| region2items=',
        '== Cities ==\n[[File:Europe_map.svg|300px]]',
      ),
      France: LEAF,
      Germany: LEAF,
    });
    const result = await buildTree(wiki, 'Europe', 3, progress);

    expect(result).not.toBe('self_ref');
    expect(result).not.toBe('missing');
    const tree = result as TreeNode;
    expect(tree.name).toBe('Europe');
    expect(tree.children).toHaveLength(2);
    expect(tree.children[0].name).toBe('France');
    expect(tree.children[1].name).toBe('Germany');
    expect(tree.regionMapUrl).toContain('Europe_map.svg');
  });

  it('reads the Regions section alone, to the next heading of its level', async () => {
    // A link under Cities is not a region of Europe, and a subheading inside
    // Regions does not end it.
    const wiki = fakeWiki({
      Europe: '== Regions ==\n{{Regionlist\n| region1name=[[France]]\n| region1items=\n}}\n'
        + '=== More ===\n{{Regionlist\n| region1name=[[Germany]]\n| region1items=\n}}\n'
        + '== Cities ==\n{{Regionlist\n| region1name=[[Paris]]\n| region1items=\n}}',
      France: LEAF,
      Germany: LEAF,
      Paris: LEAF,
    });
    const tree = await buildTree(wiki, 'Europe', 3, progress) as TreeNode;

    expect(tree.children.map(child => child.name)).toEqual(['France', 'Germany']);
  });

  it('handles self-reference', async () => {
    // Page links to itself
    const wiki = fakeWiki({
      A: withRegions('| region1name=[[A]]\n| region1items=\n| region2name=[[B]]\n| region2items='),
      B: '',
    });
    const result = await buildTree(wiki, 'A', 5, progress);

    const tree = result as TreeNode;
    expect(tree.name).toBe('A');
    // Self-ref should become a leaf child
    expect(tree.children).toHaveLength(2);
    expect(tree.children[0].name).toBe('A');
    expect(tree.children[0].children).toHaveLength(0);
    expect(tree.children[1].name).toBe('B');
  });

  it('handles missing pages', async () => {
    const wiki = fakeWiki({
      Root: withRegions('| region1name=[[Exists]]\n| region1items=\n| region2name=[[Missing]]\n| region2items='),
      Exists: '',
    });
    const result = await buildTree(wiki, 'Root', 5, progress);

    const tree = result as TreeNode;
    // Missing page is skipped. Only "Exists" (a leaf) remains, so the
    // single-leaf-child optimization collapses it — Root becomes a leaf.
    expect(tree.children).toHaveLength(0);
  });

  it('respects maxDepth', async () => {
    // Need 2+ children to avoid single-subregion leaf optimization
    const wiki = fakeWiki({
      A: withRegions('| region1name=[[B]]\n| region1items=\n| region2name=[[C]]\n| region2items='),
    });
    const result = await buildTree(wiki, 'A', 1, progress);

    const tree = result as TreeNode;
    expect(tree.name).toBe('A');
    // B and C reached maxDepth so they're leaves with no further reading
    expect(tree.children).toHaveLength(2);
    expect(tree.children[0].name).toBe('B');
    expect(tree.children[0].children).toHaveLength(0);
    expect(tree.children[1].name).toBe('C');
    expect(tree.children[1].children).toHaveLength(0);
    expect(wiki.article.mock.calls.map(([title]) => title)).toEqual(['A']);
  });

  it('handles grouping nodes', async () => {
    const wiki = fakeWiki({
      Root: withRegions('| region1name=Island Group\n| region1items=[[IslandA]], [[IslandB]]'),
      IslandA: '',
      IslandB: '',
    });
    const result = await buildTree(wiki, 'Root', 5, progress);

    const tree = result as TreeNode;
    expect(tree.children).toHaveLength(1);
    const group = tree.children[0];
    expect(group.name).toBe('Island Group');
    expect(group.children).toHaveLength(2);
    expect(group.children[0].name).toBe('IslandA');
    expect(group.children[1].name).toBe('IslandB');
  });

  it('cancellation stops tree building', async () => {
    const wiki = fakeWiki({
      Root: withRegions('| region1name=[[A]]\n| region1items=\n| region2name=[[B]]\n| region2items='),
      A: '',
    });

    // Cancel once Root's page has been read
    const readPage = wiki.article.getMockImplementation()!;
    wiki.article.mockImplementation(async (title) => {
      const page = await readPage(title);
      progress.cancel = true;
      return page;
    });

    const result = await buildTree(wiki, 'Root', 5, progress);

    const tree = result as TreeNode;
    // Tree should be incomplete (cancelled before processing children)
    expect(tree.name).toBe('Root');
    expect(wiki.article).toHaveBeenCalledTimes(1);
  });

  it('builds the same tree from the same pages twice', async () => {
    // The extraction reads a kept copy rather than the live wiki (#2089), so
    // two runs of one copy agree.
    const pages = {
      Europe: withRegions('| region1name=[[France]]\n| region1items=\n| region2name=Benelux\n| region2items=[[Belgium]], [[Netherlands]]'),
      France: withRegions('| region1name=[[Brittany]]\n| region1items=\n| region2name=[[Normandy]]\n| region2items='),
      Brittany: LEAF, Normandy: LEAF, Belgium: LEAF, Netherlands: LEAF,
    };
    const first = await buildTree(fakeWiki(pages), 'Europe', 5, progress);
    const second = await buildTree(fakeWiki(pages), 'Europe', 5, createInitialExtractionProgress());

    expect(second).toEqual(first);
    expect(countNodes(first as TreeNode)).toBe(7);
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
    const wiki = fakeWiki({
      CityX: withRegions('| region1name=[[CityX/Central]]\n| region1items=\n| region2name=[[CityX/North]]\n| region2items='),
    });
    const result = await buildTree(wiki, 'CityX', 3, progress);

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

// ─── An answered question reaches the tree (#368) ───────────────────────────

describe('applyAnsweredRegions', () => {
  let progress: ExtractionProgress;

  /** Pages for a Regionlist on Root and a leaf page for each name. */
  function pages(rootRegions: string, leaves: string[]): Record<string, string> {
    return { Root: withRegions(rootRegions), ...Object.fromEntries(leaves.map(leaf => [leaf, ''])) };
  }

  const linked = (name: string): RegionPreview => ({ name, isLink: true, children: [] });

  /** Root over A and B, each over its own 1 and 2, with a page for each 3 an answer can add. */
  function siblingPages(): Record<string, string> {
    const wiki = pages(
      '| region1name=[[A]]\n| region1items=\n| region2name=[[B]]\n| region2items=',
      ['A1', 'A2', 'A3', 'B1', 'B2', 'B3'],
    );
    for (const parent of ['A', 'B']) {
      wiki[parent] = withRegions(`| region1name=[[${parent}1]]\n| region1items=\n| region2name=[[${parent}2]]\n| region2items=`);
    }
    return wiki;
  }

  /** A question queued for Root with the regions its page was extracted with. */
  function questionFor(pageTitle: string, queued: RegionPreview[]): PendingAIQuestion {
    return {
      id: 1, pageTitle, sourceUrl: '', rawQuestions: [], currentQuestion: null,
      extractedRegions: queued, queuedRegions: queued, nodes: [], resolved: false,
      reExtract: vi.fn(), formulateNextQuestion: vi.fn(), processAnswer: vi.fn(),
    } as PendingAIQuestion;
  }

  async function built(question: PendingAIQuestion, articles: Record<string, string>) {
    progress.pendingQuestions.push(question);
    const wiki = fakeWiki(articles);
    const tree = await buildTree(wiki, 'Root', 5, progress) as TreeNode;
    return { tree, wiki };
  }

  beforeEach(() => {
    progress = createInitialExtractionProgress();
  });

  it("rebuilds the page's node from a different re-extracted set", async () => {
    // The AI split Root into North and South; the admin's answer re-extracted
    // East, West and Centre, and the import must read those.
    const queued = [linked('North'), linked('South')];
    const question = questionFor('Root', queued);
    const { tree } = await built(question, pages(
      '| region1name=[[North]]\n| region1items=\n| region2name=[[South]]\n| region2items=',
      ['North', 'South', 'East', 'West', 'Centre'],
    ));
    expect(tree.children.map(child => child.name)).toEqual(['North', 'South']);

    question.extractedRegions = [linked('East'), linked('West'), linked('Centre')];
    question.resolved = true;
    await applyAnsweredRegions(progress, { name: 'World', children: [tree] });

    expect(tree.children.map(child => child.name)).toEqual(['East', 'West', 'Centre']);
  });

  it('leaves the node alone when the answer kept the regions it was built from', async () => {
    const queued = [linked('North'), linked('South')];
    const question = questionFor('Root', queued);
    const { tree, wiki } = await built(question, pages(
      '| region1name=[[North]]\n| region1items=\n| region2name=[[South]]\n| region2items=',
      ['North', 'South'],
    ));
    const before = tree.children;
    const calls = wiki.article.mock.calls.length;

    question.extractedRegions = queued.map(region => ({ ...region }));
    question.resolved = true;
    await applyAnsweredRegions(progress, { name: 'World', children: [tree] });

    expect(tree.children).toBe(before);
    expect(wiki.article.mock.calls.length).toBe(calls);
  });

  it('makes the node a leaf when the answer left it no regions', async () => {
    const question = questionFor('Root', [linked('North'), linked('South')]);
    const { tree } = await built(question, pages(
      '| region1name=[[North]]\n| region1items=\n| region2name=[[South]]\n| region2items=',
      ['North', 'South'],
    ));

    question.extractedRegions = [];
    question.resolved = true;
    await applyAnsweredRegions(progress, { name: 'World', children: [tree] });

    expect(tree.children).toEqual([]);
  });

  it('still makes a leaf of a page whose node was never given a rebuild', async () => {
    // No page by this name was built in the walk, so nothing set the rebuild:
    // the answer's empty set still clears the node found by its title.
    const root: TreeNode = { name: 'World', children: [{ name: 'Atoll', children: [{ name: 'Islet', children: [] }] }] };
    const question = questionFor('Atoll', [linked('Islet'), linked('Reef')]);
    progress.pendingQuestions.push(question);

    question.extractedRegions = [];
    question.resolved = true;
    await applyAnsweredRegions(progress, root);

    expect(root.children[0].children).toEqual([]);
  });

  it("keeps the answer a child page was given when its parent is rebuilt", async () => {
    // Root was asked about and so was North beneath it. Root's answer adds
    // Centre, so Root is rebuilt and North is built again: from North's own
    // answer (Lowland, Highland), not from its page (A, B), and its first node,
    // now detached, is not rebuilt a second time.
    const rootQuestion = questionFor('Root', [linked('North'), linked('South')]);
    const northQuestion = questionFor('North', [linked('A'), linked('B')]);
    progress.pendingQuestions.push(northQuestion);
    const responses = pages(
      '| region1name=[[North]]\n| region1items=\n| region2name=[[South]]\n| region2items=',
      ['South', 'Centre', 'A', 'B', 'Lowland', 'Highland'],
    );
    responses.North = withRegions('| region1name=[[A]]\n| region1items=\n| region2name=[[B]]\n| region2items=');
    const { tree } = await built(rootQuestion, responses);
    expect(tree.children[0].children.map(child => child.name)).toEqual(['A', 'B']);

    northQuestion.extractedRegions = [linked('Lowland'), linked('Highland')];
    northQuestion.resolved = true;
    rootQuestion.extractedRegions = [linked('North'), linked('South'), linked('Centre')];
    rootQuestion.resolved = true;
    // Root's question comes first, as a parent's does in the walk.
    progress.pendingQuestions.reverse();
    await applyAnsweredRegions(progress, { name: 'World', children: [tree] });

    expect(tree.children.map(child => child.name)).toEqual(['North', 'South', 'Centre']);
    expect(tree.children[0].children.map(child => child.name)).toEqual(['Lowland', 'Highland']);
    // North was built from its answer during Root's rebuild, not handed to the
    // model again, which could have asked about it a second time.
    expect(progress.decisions).toContainEqual(expect.objectContaining({ page: 'North', decidedBy: 'admin_answer' }));
  });

  it('reports a rebuild, so an answer that arrived during it is applied by the next pass', async () => {
    // A and B were both asked about. A's question comes first in the pass and
    // is passed over as still open; the admin answers it while B's rebuild is
    // fetching pages. The pass reports the rebuild, and the next pass applies
    // A's answer.
    const aQuestion = questionFor('A', [linked('A1'), linked('A2')]);
    const bQuestion = questionFor('B', [linked('B1'), linked('B2')]);
    progress.pendingQuestions.push(aQuestion);
    const { tree, wiki } = await built(bQuestion, siblingPages());
    const [a, b] = tree.children;
    const readPage = wiki.article.getMockImplementation()!;
    wiki.article.mockImplementation(async (title) => {
      if (title === 'B3' && !aQuestion.resolved) {
        aQuestion.extractedRegions = [linked('A1'), linked('A2'), linked('A3')];
        aQuestion.resolved = true;
      }
      return readPage(title);
    });

    bQuestion.extractedRegions = [linked('B1'), linked('B2'), linked('B3')];
    bQuestion.resolved = true;
    const root = { name: 'World', children: [tree] };

    expect(await applyAnsweredRegions(progress, root)).toBe(true);
    expect(b.children.map(child => child.name)).toEqual(['B1', 'B2', 'B3']);
    expect(a.children.map(child => child.name)).toEqual(['A1', 'A2']);

    expect(await applyAnsweredRegions(progress, root)).toBe(true);
    expect(a.children.map(child => child.name)).toEqual(['A1', 'A2', 'A3']);

    expect(await applyAnsweredRegions(progress, root)).toBe(false);
  });

  it('applies an answer given during a rebuild before the wait lets the import go on', async () => {
    // The same sequence through what the wait calls: one call settles both.
    const aQuestion = questionFor('A', [linked('A1'), linked('A2')]);
    const bQuestion = questionFor('B', [linked('B1'), linked('B2')]);
    progress.pendingQuestions.push(aQuestion);
    const { tree, wiki } = await built(bQuestion, siblingPages());
    const readPage = wiki.article.getMockImplementation()!;
    wiki.article.mockImplementation(async (title) => {
      if (title === 'B3' && !aQuestion.resolved) {
        aQuestion.extractedRegions = [linked('A1'), linked('A2'), linked('A3')];
        aQuestion.resolved = true;
      }
      return readPage(title);
    });

    bQuestion.extractedRegions = [linked('B1'), linked('B2'), linked('B3')];
    bQuestion.resolved = true;
    await applyUntilSettled(progress, { name: 'World', children: [tree] });

    expect(tree.children.map(page => page.children.map(child => child.name))).toEqual([
      ['A1', 'A2', 'A3'],
      ['B1', 'B2', 'B3'],
    ]);
  });

  it('skips a question the admin has not answered yet', async () => {
    const question = questionFor('Root', [linked('North'), linked('South')]);
    const { tree } = await built(question, pages(
      '| region1name=[[North]]\n| region1items=\n| region2name=[[South]]\n| region2items=',
      ['North', 'South', 'East'],
    ));
    question.extractedRegions = [linked('East')];
    await applyAnsweredRegions(progress, { name: 'World', children: [tree] });
    expect(tree.children.map(child => child.name)).toEqual(['North', 'South']);
  });

  it("builds a page whose question is still open from the regions it was queued with, and asks nothing twice", async () => {
    // North's question waits on the admin. Root's answer rebuilds Root, which
    // reaches North again: North is built from the regions its question was
    // queued with (Lowland, Highland), not from its page (A, B), and the new
    // node joins that question rather than a second one.
    const rootQuestion = questionFor('Root', [linked('North'), linked('South')]);
    const northQuestion = questionFor('North', [linked('Lowland'), linked('Highland')]);
    progress.pendingQuestions.push(northQuestion);
    const responses = pages(
      '| region1name=[[North]]\n| region1items=\n| region2name=[[South]]\n| region2items=',
      ['South', 'Centre', 'A', 'B', 'Lowland', 'Highland'],
    );
    responses.North = withRegions('| region1name=[[A]]\n| region1items=\n| region2name=[[B]]\n| region2items=');
    const { tree } = await built(rootQuestion, responses);

    rootQuestion.extractedRegions = [linked('North'), linked('South'), linked('Centre')];
    rootQuestion.resolved = true;
    await applyAnsweredRegions(progress, { name: 'World', children: [tree] });

    expect(tree.children[0].children.map(child => child.name)).toEqual(['Lowland', 'Highland']);
    expect(northQuestion.nodes.map(built => built.node)).toContain(tree.children[0]);
    expect(progress.pendingQuestions.filter(q => q.pageTitle === 'North')).toHaveLength(1);
  });

  it('builds a page from what the model settled for it earlier in the run', async () => {
    // The model's outcome for a page is kept for the run (progress.modelRegions):
    // a page reached again, by a rebuild or a second parent, is built from it
    // rather than handed to the model again. Here North's page lists A and B,
    // and the model settled it as Lowland and Highland earlier.
    progress.modelRegions.set('North', [
      { name: 'Lowland', hasLink: true, items: [] },
      { name: 'Highland', hasLink: true, items: [] },
    ]);
    const responses = pages('', ['Lowland', 'Highland', 'A', 'B']);
    responses.North = withRegions('| region1name=[[A]]\n| region1items=\n| region2name=[[B]]\n| region2items=');
    const north = await buildTree(fakeWiki(responses), 'North', 5, progress) as TreeNode;

    expect(north.children.map(child => child.name)).toEqual(['Lowland', 'Highland']);
  });

  it('does not hand the model a page again when a rebuild reaches it', async () => {
    // North's page groups A and B under a plain-text name, so the walk asks the
    // model, which settles it as Lowland and Highland. Root's answer adds Centre
    // and rebuilds Root, which reaches North again: it is built from what the
    // model settled, and the model is not asked a second time.
    vi.mocked(extractRegionsWithAI).mockReset().mockResolvedValue({
      regions: [
        { name: 'Lowland', hasLink: true, items: [] },
        { name: 'Highland', hasLink: true, items: [] },
      ],
      questions: [],
    });
    const rootQuestion = questionFor('Root', [linked('North'), linked('South')]);
    const responses = pages('', ['South', 'Centre', 'A', 'B', 'Lowland', 'Highland']);
    responses.North = withRegions('| region1name=Mountains\n| region1items=[[A]], [[B]]');
    progress.pendingQuestions.push(rootQuestion);
    const aiContext = {
      openai: null as never,
      accumulator: { apiCalls: 0, promptTokens: 0, completionTokens: 0, totalCost: 0 },
    };
    const tree = await buildTree(fakeWiki(responses), 'Root', 5, progress, 0, new Set(), aiContext) as TreeNode;
    expect(tree.children[0].children.map(child => child.name)).toEqual(['Lowland', 'Highland']);

    rootQuestion.extractedRegions = [linked('North'), linked('South'), linked('Centre')];
    rootQuestion.resolved = true;
    await applyAnsweredRegions(progress, { name: 'World', children: [tree] });

    expect(tree.children.map(child => child.name)).toEqual(['North', 'South', 'Centre']);
    expect(tree.children[0].children.map(child => child.name)).toEqual(['Lowland', 'Highland']);
    expect(extractRegionsWithAI).toHaveBeenCalledTimes(1);
  });
});
