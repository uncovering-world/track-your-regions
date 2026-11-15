/**
 * What one Wikivoyage edition's guide uses (#1768, #2520), decided apart from
 * the files it is read from, so the rules are one module's.
 *
 * A guide article is in namespace 0, is no redirect, and is no heritage
 * register's list (`guideTitle`). Each usage row an article of the guide
 * writes is kept once per item and article (`EditionUsage`): an article that
 * uses an item for its coordinates and for its picture is one article, and
 * two articles that use it are two.
 *
 * The edition's witness is each item once (`items`), however many of its
 * articles use the item. That is what `wikivoyage_usage` holds and what the
 * travel-guide witness and fame's edition count read (ADR-0177): several
 * articles in one edition never count as several editions. The articles
 * themselves are kept beside it (`articles`), for the curator who opens them.
 */

import type { GuideArticle } from './usageTables.js';

/**
 * The articles of an edition that are a heritage register's lists, not a
 * guide, by the start of their title as the page table writes it. Russian
 * Wikivoyage keeps the heritage registers of Belarus and Russia and the
 * natural-monument lists of Russia and Central Asia as articles: on
 * 2026-10-01, 8,437 of the 26,357 items it used were used by these lists
 * alone.
 */
export const REGISTER_ROOTS: Readonly<Partial<Record<string, readonly string[]>>> = {
  ruwikivoyage: ['Культурное_наследие_', 'Природные_памятники_'],
  ukwikivoyage: ['Культурна_спадщина_'],
};

const ARTICLE = 0;

/** An item: a property (`P1082`) or a lexeme a page uses says nothing of a place. */
const ITEM = /^Q\d+$/;

/** One row of an edition's page table, as the build reads it. */
export interface PageRow { id: number | null; namespace: number | null; title: string | null; isRedirect: number | null }

/**
 * The title of a guide article as a reader reads it (`Старый Брест`, spaces
 * for the table's underscores), or null for a page that is no guide's: a
 * draft, a project page, a redirect or a register's list.
 */
export function guideTitle(site: string, page: PageRow): string | null {
  const { id, namespace, title, isRedirect } = page;
  if (id === null || namespace !== ARTICLE || !title || isRedirect === 1) return null;
  if ((REGISTER_ROOTS[site] ?? []).some(root => title.startsWith(root))) return null;
  return title.replaceAll('_', ' ');
}

/** The items one edition's guide articles use, and each article that uses each, from its usage rows. */
export class EditionUsage {
  /** Each item an article uses, with the ids of the articles that use it. */
  private readonly pages = new Map<string, Set<number>>();

  /** `articles`: the edition's guide articles, by page id, with their titles (`guideTitle`). */
  constructor(private readonly articles: ReadonlyMap<number, string>) {}

  /** One usage row: kept where an article of the guide uses an item, once however many aspects it uses. */
  add(item: string | null, page: number | null): void {
    if (!item || !ITEM.test(item) || page === null || !this.articles.has(page)) return;
    let pages = this.pages.get(item);
    if (!pages) {
      pages = new Set();
      this.pages.set(item, pages);
    }
    pages.add(page);
  }

  /** Each item the guide uses, once: the edition's witness, whatever number of its articles use the item. */
  items(): string[] {
    return [...this.pages.keys()];
  }

  /** Each (item, article) once, with the article's title. */
  *articleRows(): Generator<GuideArticle> {
    for (const [item, pages] of this.pages) {
      for (const pageId of pages) yield { item, pageId, title: this.articles.get(pageId)! };
    }
  }
}
