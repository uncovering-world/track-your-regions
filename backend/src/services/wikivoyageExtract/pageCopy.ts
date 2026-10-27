/**
 * English Wikivoyage as the extraction reads it (#2089): the copy kept from
 * the monthly dump (`wikivoyage_pages`, `services/dumps/wikivoyage/`), never
 * the live site. Two extractions of one copy read the same pages, so they
 * build the same tree, where the live Action API's answers moved between two
 * runs.
 *
 * A title is looked up as MediaWiki normalises it, and followed through its
 * redirects the way `redirects=1` follows them, so what the extraction did
 * with the API's answers it does with the copy's.
 */

import { pool } from '../../db/index.js';
import { latestPages } from '../dumps/wikivoyage/pageTables.js';

/** What the tree builder and the enrichment read of English Wikivoyage. */
export interface WikivoyagePages {
  /** The article `title` names, through its redirects, with its wikitext; null when there is none. */
  article(title: string): Promise<{ title: string; wikitext: string } | null>;
  /** Whether each title names an article; one that redirects to `parentTitle` names none, since it is only an alias of the parent. */
  checkPagesExist(titles: string[], parentTitle?: string): Promise<Map<string, boolean>>;
  /** The Wikidata item of the article each title names, for every title whose article names one. */
  wikidataIds(titles: Iterable<string>): Promise<Map<string, string>>;
}

/** Redirects followed before a title is taken to name nothing, as the API bounds a chain. */
const MAX_HOPS = 10;
/** Titles to a lookup. */
const TITLES_PER_READ = 1000;

/**
 * A title as MediaWiki stores it: underscores as spaces, runs of spaces as
 * one, the section after `#` dropped, the first letter upper-cased.
 */
export function normaliseTitle(title: string): string {
  const name = title.split('#')[0].replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Why the extraction cannot read the copy: none is kept, or a build replaced it mid-run. The admin reads `sentence`. */
export class CopyRefusal extends Error {
  constructor(readonly sentence: string) {
    super(sentence);
  }
}

type Known = { redirectTo: string | null; wikidataId: string | null } | null;

/** The copy in place, read through a memo of each title's redirect and item, so a title is looked up once a run. */
export class PageCopy implements WikivoyagePages {
  private readonly known = new Map<string, Known>();

  private constructor(readonly dumpDate: string) {}

  /** The copy in place; refused when no build has kept one, since the extraction reads nothing else. */
  static async open(): Promise<PageCopy> {
    const latest = await latestPages();
    if (!latest) {
      throw new CopyRefusal("English Wikivoyage's articles are not kept yet: build them under Public Dumps first");
    }
    return new PageCopy(latest.dumpDate);
  }

  /** Whether the copy in place is still the one this run opened: a build swapped in mid-run mixes two months. */
  async unchanged(): Promise<boolean> {
    return (await latestPages())?.dumpDate === this.dumpDate;
  }

  private async lookUp(titles: Iterable<string>): Promise<void> {
    const unknown = [...new Set(titles)].filter(title => !this.known.has(title));
    for (let i = 0; i < unknown.length; i += TITLES_PER_READ) {
      const batch = unknown.slice(i, i + TITLES_PER_READ);
      const rows = await pool.query<{ title: string; redirect_to: string | null; wikidata_id: string | null }>(
        'SELECT title, redirect_to, wikidata_id FROM wikivoyage_pages WHERE title = ANY($1::text[])', [batch],
      );
      for (const title of batch) this.known.set(title, null);
      for (const row of rows.rows) this.known.set(row.title, { redirectTo: row.redirect_to, wikidataId: row.wikidata_id });
    }
  }

  /** The article each title ends at through its redirects, or null: no page, a chain past `MAX_HOPS`, or a cycle. */
  private async resolve(titles: string[]): Promise<Map<string, string | null>> {
    const current = new Map(titles.map(title => [title, normaliseTitle(title)]));
    const seen = new Map(titles.map(title => [title, new Set<string>()]));
    const ends = new Map<string, string | null>();
    for (let hop = 0; hop <= MAX_HOPS && current.size > 0; hop++) {
      await this.lookUp(current.values());
      for (const [title, at] of current) {
        const page = this.known.get(at);
        const visited = seen.get(title)!;
        if (!page || visited.has(at)) {
          ends.set(title, null);
        } else if (page.redirectTo === null) {
          ends.set(title, at);
        } else {
          visited.add(at);
          current.set(title, normaliseTitle(page.redirectTo));
          continue;
        }
        current.delete(title);
      }
    }
    for (const title of current.keys()) ends.set(title, null);
    return ends;
  }

  async article(title: string): Promise<{ title: string; wikitext: string } | null> {
    const end = (await this.resolve([title])).get(title);
    if (!end) return null;
    const row = await pool.query<{ wikitext: string }>('SELECT wikitext FROM wikivoyage_pages WHERE title = $1', [end]);
    return row.rows[0] ? { title: end, wikitext: row.rows[0].wikitext } : null;
  }

  async checkPagesExist(titles: string[], parentTitle?: string): Promise<Map<string, boolean>> {
    const ends = await this.resolve(titles);
    return new Map(titles.map(title => {
      const end = ends.get(title) ?? null;
      const redirectsToParent = parentTitle !== undefined && end !== title && end === parentTitle;
      return [title, end !== null && !redirectsToParent];
    }));
  }

  async wikidataIds(titles: Iterable<string>): Promise<Map<string, string>> {
    const list = [...titles];
    const ends = await this.resolve(list);
    const ids = new Map<string, string>();
    for (const title of list) {
      const end = ends.get(title);
      const item = end ? this.known.get(end)?.wikidataId : null;
      if (item) ids.set(title, item);
    }
    return ids;
  }
}
