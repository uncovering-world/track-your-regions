/**
 * Who is filed *under* an English Wikipedia category — the door of
 * `wikipediaCategories.ts` read the other way round.
 *
 * That file asks what a museum the run already holds is filed under, which
 * tests a candidate. It cannot produce one: a museum Wikidata types bare
 * `museum` is in no pool of archaeology classes and, holding no find the world
 * has heard of, is named by nothing at all — and half the canon is exactly
 * that. The Bardo (`museum`, 35 sitelinks), the Museo del Oro (`museum`, 28)
 * and the National Museum of Iraq (`national museum`, 36 — its Warka Vase is
 * typed `container` and never reaches the finds pool) are in the catalogue only
 * if the category is a way *in*. ADR-0058 decision 2 says a museum
 * archaeological by nature enters at the place line, and the category is one of
 * the signals of that nature; this module is the part of it that reaches out.
 *
 * Titles and ids, no archaeology: which root is walked and which subcategories
 * are followed are the caller's (`archaeology/classes.ts`), so a second kind
 * asks this door with its own rule rather than growing a second client.
 *
 * A Wikipedia category tree is editorial and not a taxonomy, which is the whole
 * of why the walk is shaped as it is: a country category sits beside siblings
 * about other kinds (`Byzantine museums in Greece`), the same category is
 * reachable through two parents, categories can be filed under each other in a
 * circle, and an article may be about no Wikidata item at all. So the walk
 * follows a rule rather than every child, reads each category once, stops at a
 * depth, and answers with ids it was told rather than ids it guessed.
 *
 * The requests are `wikipediaCategories.ts`'s: one endpoint, one retry rule,
 * one wording for a refusal. A category that cannot be read throws — swallowed,
 * it is every museum in a country quietly missing from the candidate set on a
 * run whose log said success.
 */

import {
  askWikipediaOnce,
  nextContinuation,
  pagesOf,
  CATEGORY_WAIT_BUDGET_MS,
  LOG_PREFIX,
  type CategoryOptions,
} from './wikipediaCategories.js';
import { WaitBudget } from './sourceRetry.js';

/**
 * How far from the root the walk may go, counting the root as 0.
 *
 * Measured on 2026-09-13 and 2026-10-14: the walk starts at the bare
 * `Archaeological museums` (0), whose `by country` shelf (1) holds 60 country
 * categories (2). A country nests regional ones a step further (3) — Greece has
 * 15, `Archaeological museums in Crete` among them — and the United Kingdom
 * two steps further still: England (3), London (4). Four steps is the shape the
 * tree has today; five is that with room for a country that files its museums
 * by province, and a floor under a circle the visited set has already closed.
 */
const MAX_CATEGORY_DEPTH = 5;

/**
 * The articles of one category, each with the Wikidata item it is about.
 *
 * `pageprops` in the same question as the listing, rather than a second pass
 * over the titles: the generator hands the members straight to `prop`, so one
 * request answers both halves and no title has to be carried between two
 * questions to be lost between them. Measured on 2026-09-13, the Tunisia, Iraq
 * and Colombia categories answered with an item for every article they hold.
 */
const MEMBER_QUERY: Record<string, string> = {
  action: 'query', generator: 'categorymembers', gcmtype: 'page', gcmlimit: 'max',
  prop: 'pageprops', ppprop: 'wikibase_item', format: 'json', formatversion: '2',
};

/** The Wikidata items of articles named by their titles; a missing page or a redirect has none. */
const TITLE_QUERY: Record<string, string> = {
  action: 'query', prop: 'pageprops', ppprop: 'wikibase_item', format: 'json', formatversion: '2',
};

/** How many titles one request names, the API's own limit for a client without the bot right. */
const TITLES_PER_ASK = 50;

/** The subcategories of one category, by title; nothing else about them is read. */
const SUBCATEGORY_QUERY: Record<string, string> = {
  action: 'query', list: 'categorymembers', cmtype: 'subcat', cmlimit: 'max',
  format: 'json', formatversion: '2',
};

export interface CategoryWalkOptions extends CategoryOptions {
  /**
   * Which subcategories the walk follows, matched on the title without its
   * `Category:` prefix. A country category sits beside siblings that belong to
   * other kinds, so a walk that took every child would fill this kind with
   * another one's museums.
   */
  recurseInto: RegExp;
  /** How far from the root to walk; the root is 0. Defaults to `MAX_CATEGORY_DEPTH`. */
  maxDepth?: number;
  /**
   * Where the walk records an article it found through its *eponymous*
   * category: article title → the categories that category is shelved under.
   * Given, a subcategory the walk does not follow is read as the article of
   * the same title when there is one (#889). Editors file a museum's own
   * category rather than its article: `Category:History Museum of Armenia`
   * sits in `Archaeological museums`, while the article is filed under
   * `History museums in Armenia`. A shelf the walk entered is the
   * editors' word about the museum all the same, so the caller may read it as
   * one of the article's own categories.
   */
  shelves?: Map<string, string[]>;
  /** What the walk reads; the live API, by the options' manners, where none is given. */
  reads?: CategoryReads;
}

/** What one category's own articles came to. */
interface Tally { pages: number; itemless: number }

/** A count in English, because a log line an admin reads is prose. */
const count = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** A page the walk reads: its title, and the Wikidata item it is about where it names one. */
export interface WalkedPage { title: string; item: string | null }

/**
 * What the walk reads of English Wikipedia, whichever copy it reads: the live
 * Action API (`liveReads`) or the structure kept from the dumps
 * (`structureCategoryReads`, #1440). The walk's rule — which subcategories it
 * follows, how deep, what an eponymous category stands for — is the same over
 * either.
 */
export interface CategoryReads {
  /** A category's own pages, every namespace but categories and files. */
  pages(category: string): Promise<WalkedPage[]>;
  /** A category's subcategories, by title with the `Category:` prefix. */
  subcategories(category: string): Promise<string[]>;
  /** The articles of exactly these titles that carry an item; a missing page or a redirect has none. */
  articles(titles: string[], category: string): Promise<Array<{ title: string; item: string }>>;
}

/** The walk's reads asked of the live API, as many requests as the continuations take, a pause after each. */
export function liveReads(options: CategoryOptions, budget: WaitBudget): CategoryReads {
  return {
    async pages(category) {
      const found: WalkedPage[] = [];
      let cont: Record<string, string> | undefined = {};
      let asks = 0;
      while (cont) {
        const answer = await askWikipediaOnce(
          { ...MEMBER_QUERY, gcmtitle: category, ...cont },
          options, budget, `the pages of "${category}"`,
        );
        asks += 1;
        for (const page of pagesOf(answer)) {
          if (page.title) found.push({ title: page.title, item: page.pageprops?.wikibase_item ?? null });
        }
        cont = nextContinuation(answer, asks, `the pages of "${category}"`);
        if (options.pause) await options.pause();
      }
      return found;
    },
    async subcategories(category) {
      const titles: string[] = [];
      let cont: Record<string, string> | undefined = {};
      let asks = 0;
      while (cont) {
        const answer = await askWikipediaOnce(
          { ...SUBCATEGORY_QUERY, cmtitle: category, ...cont },
          options, budget, `the subcategories of "${category}"`,
        );
        asks += 1;
        for (const member of answer.query?.categorymembers ?? []) {
          if (member.title) titles.push(member.title);
        }
        cont = nextContinuation(answer, asks, `the subcategories of "${category}"`);
        if (options.pause) await options.pause();
      }
      return titles;
    },
    async articles(titles, category) {
      const found: Array<{ title: string; item: string }> = [];
      for (let i = 0; i < titles.length; i += TITLES_PER_ASK) {
        const answer = await askWikipediaOnce(
          { ...TITLE_QUERY, titles: titles.slice(i, i + TITLES_PER_ASK).join('|') },
          options, budget, `the articles named after the subcategories of "${category}"`,
        );
        for (const page of pagesOf(answer)) {
          const item = page.pageprops?.wikibase_item;
          if (page.title && item) found.push({ title: page.title, item });
        }
        if (options.pause) await options.pause();
      }
      return found;
    },
  };
}

/**
 * One category's articles, folded into the map under the title each is filed
 * by. An article carrying no `wikibase_item` is counted and skipped rather than
 * guessed at — a title is not an id, and the walk answers in ids. A category
 * holding no articles at all is empty, not a refusal: `Archaeological museums
 * by country` itself is one, since every museum is in a country.
 */
async function readCategoryPages(category: string, reads: CategoryReads, into: Map<string, string>): Promise<Tally> {
  const tally: Tally = { pages: 0, itemless: 0 };
  for (const page of await reads.pages(category)) {
    tally.pages += 1;
    if (page.item) into.set(page.title, page.item);
    else tally.itemless += 1;
  }
  return tally;
}

/** A category's title without its namespace, as rules and shelves spell it. */
const bare = (title: string): string => title.replace(/^Category:/, '');

/**
 * The articles the unfollowed subcategories of one category are named after,
 * added to the members with the category as a shelf (`shelves`). Only an
 * article of exactly the subcategory's name, with an item of its own, counts:
 * `Byzantine museums` is no article, and a redirect carries no item.
 */
async function readEponymous(
  subcategories: string[], category: string, reads: CategoryReads, shelves: Map<string, string[]>, into: Map<string, string>,
): Promise<number> {
  let found = 0;
  for (const { title, item } of await reads.articles(subcategories.map(bare), category)) {
    into.set(title, item);
    shelves.set(title, [...new Set([...(shelves.get(title) ?? []), bare(category)])]);
    found += 1;
  }
  return found;
}

/**
 * Every article under a category tree, as the Wikidata item it is about: page
 * title → QID.
 *
 * One entry per title and one id per entry, so two articles about one item come
 * back as one candidate and a category reachable by two parents is read once.
 * Absence means the walk did not find the article, never that a request went
 * missing: a category that could not be read throws.
 */
export async function fetchCategoryMembers(
  rootCategory: string, options: CategoryWalkOptions,
): Promise<Map<string, string>> {
  const reads = options.reads ?? liveReads(options, options.budget ?? new WaitBudget(CATEGORY_WAIT_BUDGET_MS));
  const members = new Map<string, string>();
  const visited = new Set<string>();
  const maxDepth = options.maxDepth ?? MAX_CATEGORY_DEPTH;
  let itemless = 0;

  const walk = async (category: string, depth: number): Promise<void> => {
    if (visited.has(category)) return;
    visited.add(category);
    const tally = await readCategoryPages(category, reads, members);
    itemless += tally.itemless;

    if (depth >= maxDepth) {
      // Said rather than logged as "0 subcategories": a category the walk
      // stopped at is not a category with nothing under it, and an admin
      // reading the log should be able to tell those apart.
      console.log(
        `${LOG_PREFIX} ${count(tally.pages, 'page')} under "${category}", as deep as the walk goes`,
      );
      return;
    }
    const subcategories = await reads.subcategories(category);
    const followed = subcategories.filter((title) => options.recurseInto.test(bare(title)));
    const eponymous = options.shelves
      ? await readEponymous(subcategories.filter((title) => !followed.includes(title)), category, reads, options.shelves, members)
      : 0;
    console.log(
      `${LOG_PREFIX} ${count(tally.pages, 'page')}, `
      + `${count(followed.length, 'subcategory', 'subcategories')}`
      + (eponymous > 0 ? `, ${count(eponymous, 'museum')} by its own category` : '')
      + ` under "${category}"`,
    );
    // One after another rather than at once: the pause between requests is the
    // whole of this door's politeness to Wikimedia, and a fan-out would spend it.
    for (const subcategory of followed) await walk(subcategory, depth + 1);
  };

  await walk(rootCategory, 0);
  if (itemless > 0) {
    console.log(
      `${LOG_PREFIX} skipped ${count(itemless, 'article')} under "${rootCategory}" `
      + 'with no Wikidata item',
    );
  }
  console.log(
    `${LOG_PREFIX} ${count(members.size, 'article')} under "${rootCategory}", `
    + `from ${count(visited.size, 'category', 'categories')}`,
  );
  return members;
}
