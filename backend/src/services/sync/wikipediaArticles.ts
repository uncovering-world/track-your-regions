/**
 * An article named the way OpenStreetMap names one — `wikipedia=lang:Title` —
 * resolved to the Wikidata item it is about, through that wiki's own API.
 *
 * The site pool's second entrance (#895) reads every object OpenStreetMap
 * tags as a dig or as ruins, and 2,027 of them (2026-09-15) carry an article
 * and no item: the mapper linked the page and not the QID. Nemrut is one — `tr:Nemrut
 * Dağı` on the tumulus, while the peak node carries the item — so a reader
 * that took only `wikidata=*` would never see the mountain's dig. The article
 * is a link to the same item by another name, and `pageprops` on the wiki
 * named in the tag says which.
 *
 * The requests are the category client's — one endpoint shape, one retry rule,
 * one wording for a refusal — on the wiki the tag names rather than on
 * English Wikipedia alone: of the run's 2,027 article-only objects the tag is
 * `de:` on 498, `fr:` on 383, `en:` on 298, and a resolver that read English
 * alone would read a seventh of them, the largest language a quarter.
 */

import {
  askedTitles, askWikipediaOnce, nextContinuation, pagesOf, CATEGORY_WAIT_BUDGET_MS, LOG_PREFIX,
  type CategoryAnswer, type CategoryOptions,
} from './wikipediaCategories.js';
import { WaitBudget } from './sourceRetry.js';
import { isQid } from './wikidataUtils.js';

/** The API's ceiling for a titles list. */
const TITLE_BATCH = 50;

/**
 * A wiki's code as the tag spells it — letters and hyphens, `zh-min-nan`
 * included. The title after the colon must not be a path:
 * `https://en.wikipedia.org/wiki/…` is a URL somebody pasted into the tag, and
 * `https` is no wiki.
 */
const WIKI_CODE = /^[a-z][a-z-]{1,15}$/;

const PAGEPROPS_QUERY: Record<string, string> = {
  action: 'query', prop: 'pageprops', ppprop: 'wikibase_item', redirects: '1',
  format: 'json', formatversion: '2',
};

/** `lang:Title` split, or nothing for a tag that names no wiki. */
function articleOf(tag: string): { lang: string; title: string } | null {
  const colon = tag.indexOf(':');
  if (colon === -1) return null;
  const lang = tag.slice(0, colon).trim();
  const title = tag.slice(colon + 1).trim();
  // A pipe is the API's list separator and no title's character: joined into
  // a batch it is one value too many, and the run ends on one mapper's tag.
  // A fragment names a section, and a section is a part of what the article
  // is about: `es:Antuco#Historia` on Fuerte Ballenar's node tells the fort's
  // story inside the town's article, and the town's item is not what the
  // mapper linked — resolved, Antuco walked in as a dig on dry run 137 (229 of
  // the run's 2,027 article-only objects carry one, 2026-09-15).
  if (!WIKI_CODE.test(lang) || !title || title.startsWith('/') || title.includes('|') || title.includes('#')) return null;
  return { lang, title };
}

/**
 * One batch of titles on one wiki, folded into the answer under the tag each
 * came in by. The API answers under the title it holds and lists what it
 * normalised or redirected on the way, and the fold walks that back — a title
 * read under the wrong key is an object filed under nothing.
 */
async function resolveBatch(
  lang: string, asked: Map<string, string[]>, options: CategoryOptions, budget: WaitBudget, into: Map<string, string>,
): Promise<void> {
  const titles = [...asked.keys()];
  const endpoint = `https://${lang}.wikipedia.org/w/api.php`;
  const what = `the items of ${titles.length} ${lang}.wikipedia articles`;
  let cont: Record<string, string> | undefined = {};
  let asks = 0;
  while (cont) {
    const answer = await askWikipediaOnce(
      { ...PAGEPROPS_QUERY, titles: titles.join('|'), ...cont }, { ...options, endpoint }, budget, what,
    );
    asks += 1;
    // A batch answered with no `query` at all is every one of its tags read
    // as "no article resolves" — and the rows they named refused on the next
    // run as rows the map does not carry. The category reader fails on it
    // for the same reason, and `failOnApiError` covers `error` alone.
    if (!answer.query) {
      throw new Error(`${LOG_PREFIX} ${what}: Wikipedia answered without a query, so without pages`);
    }
    fileAnswer(answer, titles, asked, into);
    cont = nextContinuation(answer, asks, what);
    if (options.pause) await options.pause();
  }
}

/**
 * One answer filed under the tags its pages were asked by. Every tag that
 * reached a page is walked back through what the API normalised or redirected
 * — a list, since `de:Nemrut_Dağı` and `de:Nemrut Dağı` are two tags and one
 * page (`askedTitles`) — and filed under the tag exactly as the map wrote it,
 * the key the pool looks the answer up by, not the trimmed title asked.
 */
function fileAnswer(
  answer: CategoryAnswer, titles: string[], asked: Map<string, string[]>, into: Map<string, string>,
): void {
  const back = askedTitles(titles, answer);
  for (const page of pagesOf(answer)) {
    const qid = page.pageprops?.wikibase_item;
    if (!page.title || !qid || !isQid(qid)) continue;
    for (const title of back.get(page.title) ?? [page.title]) {
      for (const tag of asked.get(title) ?? []) into.set(tag, qid);
    }
  }
}

/** The site matrix's shape, as far as the editions are read off it. */
interface SiteMatrixAnswer extends CategoryAnswer {
  sitematrix?: Record<string, { code?: string; site?: { code?: string }[] } | number>;
}

/**
 * Which language codes have a Wikipedia at all, from the site matrix — one
 * question, asked of English Wikipedia before any tag names a host.
 *
 * A mapper's tag names a wiki by a code they chose, and `zz:` is a host that
 * does not exist: asked, the door would retry it to the budget and end the
 * run on one object's link. The matrix lists every language with a `wiki`
 * site (364 on 2026-09-15, the closed ones included — a closed wiki still
 * answers its API), and a code it does not list names no wiki.
 */
async function wikipediaEditions(options: CategoryOptions, budget: WaitBudget): Promise<Set<string>> {
  const answer = await askWikipediaOnce(
    { action: 'sitematrix', smtype: 'language', smlangprop: 'code|site', smsiteprop: 'code' },
    options, budget, 'the list of Wikipedias',
  ) as SiteMatrixAnswer;
  const editions = new Set<string>();
  for (const entry of Object.values(answer.sitematrix ?? {})) {
    if (typeof entry !== 'object' || !entry.code) continue;
    if ((entry.site ?? []).some((site) => site.code === 'wiki')) editions.add(entry.code);
  }
  if (editions.size === 0) throw new Error(`${LOG_PREFIX} the site matrix named no Wikipedia at all`);
  return editions;
}

/**
 * Every `lang:Title` tag resolved to the item its article is about: tag → QID.
 *
 * Left out, so that absence means "nothing to file this object under" and
 * never that a request went missing: a tag that names no wiki — by its shape,
 * or by a code the site matrix does not list; a title the API could not take
 * as one (a pipe); a tag naming a section of an article, since a section is a
 * part of what the article is about and the article's item is not what the
 * mapper linked (ADR-0060 decision 1 — 229 of the run's 2,027 article-only
 * objects, so it is counted on the run as the unlisted wiki is); and an
 * article no item is about. A wiki that cannot be read throws, as a category
 * that cannot be read does.
 */
export async function resolveWikipediaArticles(
  tags: Iterable<string>, options: CategoryOptions,
): Promise<Map<string, string>> {
  const budget = options.budget ?? new WaitBudget(CATEGORY_WAIT_BUDGET_MS);
  // Per wiki, the titles to ask, each with every tag that spelled it: the
  // answer is filed under the tags, the question asks the titles once.
  const byWiki = new Map<string, Map<string, string[]>>();
  let unknown = 0;
  let sections = 0;
  let editions: Set<string> | null = null;
  for (const tag of new Set(tags)) {
    const article = articleOf(tag);
    if (!article) {
      if (tag.includes('#')) sections += 1;
      continue;
    }
    editions ??= await wikipediaEditions(options, budget);
    if (!editions.has(article.lang)) {
      unknown += 1;
      continue;
    }
    const titles = byWiki.get(article.lang) ?? new Map<string, string[]>();
    titles.set(article.title, [...(titles.get(article.title) ?? []), tag]);
    byWiki.set(article.lang, titles);
  }
  if (sections > 0) console.log(`${LOG_PREFIX} ${sections} tagged article(s) name a section of an article, left out`);
  if (unknown > 0) console.log(`${LOG_PREFIX} ${unknown} tagged article(s) name a wiki the site matrix does not list, left out`);
  const out = new Map<string, string>();
  for (const [lang, titles] of byWiki) {
    const list = [...titles];
    for (let start = 0; start < list.length; start += TITLE_BATCH) {
      await resolveBatch(lang, new Map(list.slice(start, start + TITLE_BATCH)), options, budget, out);
    }
  }
  const tagged = [...byWiki.values()].reduce((n, t) => n + [...t.values()].reduce((m, tags) => m + tags.length, 0), 0);
  console.log(`${LOG_PREFIX} ${out.size} of ${tagged} tagged articles resolved to an item, over ${byWiki.size} wiki(s)`);
  return out;
}
