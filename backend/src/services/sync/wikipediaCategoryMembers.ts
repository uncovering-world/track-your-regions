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
 * the two signals of that nature; this module is the half of it that reaches
 * out.
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
 * Measured on 2026-09-13: `Archaeological museums by country` holds 60 country
 * categories, and a country nests regional ones one step further — Greece has
 * 15, `Archaeological museums in Crete` among them. Two steps is the shape the
 * tree has today; four is that with room for a country that files its museums
 * by province, and a floor under a circle the visited set has already closed.
 */
const MAX_CATEGORY_DEPTH = 4;

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
}

/** What one category's own articles came to. */
interface Tally { pages: number; itemless: number }

/** A count in English, because a log line an admin reads is prose. */
const count = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/**
 * One category's articles, folded into the map under the title each is filed
 * by, as many requests as the continuations require.
 *
 * An article carrying no `wikibase_item` is counted and skipped rather than
 * guessed at — a title is not an id, and the walk answers in ids. A category
 * holding no articles at all answers with no `query` in it, which is the live
 * API's way of saying empty and not a refusal: `Archaeological museums by
 * country` itself is one, since every museum is in a country.
 */
async function readCategoryPages(
  category: string, options: CategoryWalkOptions, budget: WaitBudget, into: Map<string, string>,
): Promise<Tally> {
  const tally: Tally = { pages: 0, itemless: 0 };
  let cont: Record<string, string> | undefined = {};
  let asks = 0;
  while (cont) {
    const answer = await askWikipediaOnce(
      { ...MEMBER_QUERY, gcmtitle: category, ...cont },
      options, budget, `the pages of "${category}"`,
    );
    asks += 1;
    for (const page of pagesOf(answer)) {
      if (!page.title) continue;
      tally.pages += 1;
      const qid = page.pageprops?.wikibase_item;
      if (qid) into.set(page.title, qid);
      else tally.itemless += 1;
    }
    cont = nextContinuation(answer, asks, `the pages of "${category}"`);
    if (options.pause) await options.pause();
  }
  return tally;
}

/** The titles of one category's subcategories, as many requests as it takes. */
async function readSubcategories(
  category: string, options: CategoryWalkOptions, budget: WaitBudget,
): Promise<string[]> {
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
  const budget = options.budget ?? new WaitBudget(CATEGORY_WAIT_BUDGET_MS);
  const members = new Map<string, string>();
  const visited = new Set<string>();
  const maxDepth = options.maxDepth ?? MAX_CATEGORY_DEPTH;
  let itemless = 0;

  const walk = async (category: string, depth: number): Promise<void> => {
    if (visited.has(category)) return;
    visited.add(category);
    const tally = await readCategoryPages(category, options, budget, members);
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
    const followed = (await readSubcategories(category, options, budget))
      .filter((title) => options.recurseInto.test(title.replace(/^Category:/, '')));
    console.log(
      `${LOG_PREFIX} ${count(tally.pages, 'page')}, `
      + `${count(followed.length, 'subcategory', 'subcategories')} under "${category}"`,
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
