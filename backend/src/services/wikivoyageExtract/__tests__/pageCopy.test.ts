import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The copy of English Wikivoyage the extraction reads (#2089): a title is looked up as MediaWiki stores it and followed through its redirects. */

type Row = { title: string; redirect_to: string | null; wikidata_id: string | null; wikitext: string };
const copy = vi.hoisted(() => ({ rows: [] as Row[], dumpDate: '2026-10-01' as string | null }));

vi.mock('../../../db/index.js', () => ({
  pool: {
    query: vi.fn(async (sql: string, [titles]: [string[] | string]) => ({
      rows: copy.rows.filter(row => (Array.isArray(titles) ? titles.includes(row.title) : row.title === titles)),
      sql,
    })),
  },
}));
vi.mock('../../dumps/wikivoyage/pageTables.js', () => ({
  latestPages: async () => (copy.dumpDate ? { dumpDate: copy.dumpDate, swappedAt: new Date(), needs: 'nothing' } : null),
}));

const { CopyRefusal, PageCopy, normaliseTitle, pageNameFromUrl } = await import('../pageCopy.js');

const article = (title: string, wikitext: string, wikidataId: string | null = null): Row =>
  ({ title, redirect_to: null, wikidata_id: wikidataId, wikitext });
const redirect = (title: string, to: string): Row => ({ title, redirect_to: to, wikidata_id: null, wikitext: '' });

beforeEach(() => {
  copy.dumpDate = '2026-10-01';
  // Fixture items, not real ones.
  copy.rows = [
    article('Saint Petersburg', '== Districts ==', 'Q900001'),
    redirect('St. Petersburg', 'Saint_Petersburg#Districts'),
    redirect('Leningrad', 'St. Petersburg'),
    redirect('Loop A', 'Loop B'),
    redirect('Loop B', 'Loop A'),
    article('Northwestern Russia', '== Regions =='),
    redirect('Northwest Russia', 'Northwestern Russia'),
  ];
});

describe('normaliseTitle', () => {
  it('stores a title as MediaWiki does', () => {
    expect(normaliseTitle('saint_Petersburg#Districts')).toBe('Saint Petersburg');
    expect(normaliseTitle('  Northwestern   Russia ')).toBe('Northwestern Russia');
  });
});

describe('pageNameFromUrl', () => {
  it('reads the title an article URL names, without its section', () => {
    expect(pageNameFromUrl('https://en.wikivoyage.org/wiki/Lower_Saxony#Regions')).toBe('Lower_Saxony');
    expect(pageNameFromUrl('https://en.wikivoyage.org/wiki/S%C3%A3o_Paulo')).toBe('São_Paulo');
  });

  it('names no page for a URL with no article path or a broken escape', () => {
    expect(pageNameFromUrl('https://en.wikivoyage.org/')).toBeNull();
    expect(pageNameFromUrl('https://en.wikivoyage.org/wiki/')).toBeNull();
    expect(pageNameFromUrl('https://en.wikivoyage.org/wiki/Bad%E0%A4')).toBeNull();
  });

  it('names no page for another site, whose article is not the Wikivoyage page of that title', () => {
    expect(pageNameFromUrl('https://en.wikipedia.org/wiki/Paris')).toBeNull();
    expect(pageNameFromUrl('https://de.wikivoyage.org/wiki/Niedersachsen')).toBeNull();
    expect(pageNameFromUrl('not a url /wiki/Paris')).toBeNull();
  });
});

describe('PageCopy', () => {
  it('is refused while no copy is kept, since the extraction reads nothing else', async () => {
    copy.dumpDate = null;
    await expect(PageCopy.open()).rejects.toBeInstanceOf(CopyRefusal);
  });

  it('reads an article through a chain of redirects, under the title it ends at', async () => {
    const wiki = await PageCopy.open();
    expect(await wiki.article('Leningrad')).toEqual({ title: 'Saint Petersburg', wikitext: '== Districts ==' });
    expect(await wiki.article('Loop A')).toBeNull();
    expect(await wiki.article('Moscow')).toBeNull();
  });

  it('counts an alias of the parent as no page of its own', async () => {
    const wiki = await PageCopy.open();
    const exists = await wiki.checkPagesExist(['Northwest Russia', 'St. Petersburg', 'Loop B', 'Moscow'], 'Northwestern Russia');
    expect(Object.fromEntries(exists)).toEqual({
      'Northwest Russia': false, 'St. Petersburg': true, 'Loop B': false, Moscow: false,
    });
  });

  it("gives each title the item of the article it names", async () => {
    const wiki = await PageCopy.open();
    expect(Object.fromEntries(await wiki.wikidataIds(['Leningrad', 'Northwestern Russia', 'Moscow'])))
      .toEqual({ Leningrad: 'Q900001' });
  });

  it('says when a build swapped in another copy mid-run', async () => {
    const wiki = await PageCopy.open();
    expect(await wiki.unchanged()).toBe(true);
    copy.dumpDate = '2026-11-01';
    expect(await wiki.unchanged()).toBe(false);
  });
});
