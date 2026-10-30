/**
 * English Wikipedia's categories read from the structure kept from its dumps
 * (#1440, ADR-0121), where a run would otherwise ask the live Action API:
 * what each article is filed under (`structureCategories`, the twin of
 * `fetchWikipediaCategories`), and what a category holds
 * (`structureCategoryReads`, the reads `fetchCategoryMembers` walks with).
 *
 * The answers are spelt as the API spells them, so the rules reading them do
 * not tell the two apart: a title with spaces; an article's categories
 * without their `Category:` prefix, as `fetchWikipediaCategories` strips it;
 * a category's subcategories with it, as the walk lists them. The differences
 * that are the copy's own (ADR-0121):
 * - a hidden category is not kept, as the live `clshow=!hidden` leaves it out
 *   of an article's categories; a hidden subcategory is still listed, and is
 *   empty;
 * - a title that is a redirect finds no page, where the API with `redirects=1`
 *   follows it to the article. Wikidata's sitelinks name the article itself;
 * - a category's pages are its articles, where the API lists a portal or a
 *   template filed there too.
 */

import { pool } from '../../db/index.js';
import { latestStructure } from '../dumps/wikipedia/structureTables.js';
import type { SyncProgress } from './types.js';
import type { CategoryReads, WalkedPage } from './wikipediaCategoryMembers.js';

const CATEGORY_PREFIX = 'Category:';

/**
 * Whether a run reads English Wikipedia's categories from the copy: there is
 * one in place, and the run says which dump it is. The tables and their record
 * are unlogged together (ADR-0121 decision 4), so a record is a copy that is
 * there; without one the run asks the live API and says that instead.
 */
export async function wikipediaStructureFor(progress: SyncProgress): Promise<boolean> {
  const built = await latestStructure();
  progress.statusMessage = built
    ? `Reading English Wikipedia's categories from its ${built.dumpDate} dump...`
    : 'No copy of English Wikipedia\'s categories is built: asking Wikipedia...';
  return built !== null;
}

/** A title as the dump writes it: underscores for spaces, and a category without its namespace. */
const stored = (title: string) => title.replace(/^Category:/, '').trim().replace(/ /g, '_');
/** A title as the API writes it: spaces, and a category with its namespace. */
const shown = (title: string) => title.replace(/_/g, ' ');

/**
 * Every category each article is filed under, without its `Category:` prefix,
 * by the title it was asked by; an article the copy does not hold answers an
 * empty list, as a missing page does on the API.
 */
export async function structureCategories(titles: string[]): Promise<Map<string, string[]>> {
  const wanted = [...new Set(titles.filter(title => title.trim().length > 0))];
  const categories = new Map<string, string[]>(wanted.map(title => [title, []]));
  if (wanted.length === 0) return categories;
  const result = await pool.query<{ title: string; category: string }>(
    `SELECT p.title, c.title AS category
       FROM enwiki_pages p
       JOIN enwiki_category_links l ON l.page = p.id
       JOIN enwiki_categories c ON c.id = l.category
      WHERE p.namespace = 0 AND p.title = ANY($1::text[])
      ORDER BY p.title, c.title`,
    [wanted.map(stored)],
  );
  const asked = new Map<string, string[]>();
  for (const title of wanted) asked.set(stored(title), [...(asked.get(stored(title)) ?? []), title]);
  for (const row of result.rows) {
    for (const title of asked.get(row.title) ?? []) categories.get(title)!.push(shown(row.category));
  }
  return categories;
}

/**
 * The Wikidata item of every article filed directly under a category whose
 * title matches `match` and not `except` (case-insensitive POSIX regular
 * expressions over the title as the dump writes it, underscores for spaces).
 */
export async function structureItemsInCategories(match: string, except: string): Promise<string[]> {
  const result = await pool.query<{ item: string }>(
    `SELECT DISTINCT i.item
       FROM enwiki_categories c
       JOIN enwiki_category_links l ON l.category = c.id AND NOT l.subcat
       JOIN enwiki_pages p ON p.id = l.page AND p.namespace = 0
       JOIN enwiki_page_items i ON i.page = p.id
      WHERE c.title ~* $1 AND c.title !~* $2
      ORDER BY i.item`,
    [match, except],
  );
  return result.rows.map(row => row.item);
}

/**
 * The head nouns that make a `… in/of/at the <museum>` category a shelf of
 * objects rather than of people (ADR-0166): *Middle Eastern objects in the
 * British Museum*, *Near Eastern antiquities in the Louvre*, *Sculptures in
 * the Vatican Museums*. *Members of*, *Prisoners in*, *Employees of* and
 * *Burials at* are the commonest shelves under a museum's name, and every one
 * of them is people (#2164). Matched on the title's last word before the
 * museum, as the dump writes it; a non-capturing group, since the query reads
 * the museum's title as the match's one group.
 */
export const COLLECTION_HEADS = '(?:collections?|objects|antiquities|artifacts|artefacts|sculptures|statues|paintings|'
  + 'drawings|prints|manuscripts|mosaics|frescoes|vases|hoards|inscriptions|mummies|relics|jewelry|jewellery|'
  + 'tapestries|carpets|ceramics|textiles|coins|arms_and_armou?r|fabergé)';

/**
 * The collection shelves of the copy, by the museum title each names: every
 * category whose title is `Collection(s)_of_(the_)<title>` or ends in
 * `<head>_(in|of|at)_(the_)<title>` with a head of `COLLECTION_HEADS`, cut once
 * into the tail that could name a museum. Read once per copy and kept: the
 * two million titles are scanned in one statement of about thirty seconds,
 * and every kind's run asks the same shelves of its own venues, round after
 * round. A pattern matched per museum against every title ran for half an
 * hour (#2164).
 */
let shelves: { copy: string; byTitle: Map<string, number[]> } | null = null;

/** Forgets the shelves read, so a test that rebuilt the copy reads them again. */
export function forgetCollectionShelves(): void {
  shelves = null;
}

async function collectionShelves(): Promise<Map<string, number[]>> {
  const copy = (await latestStructure())?.swappedAt.toISOString() ?? 'none';
  if (shelves?.copy === copy) return shelves.byTitle;
  const result = await pool.query<{ id: number; title: string }>(
    `SELECT c.id, m[1] AS title FROM enwiki_categories c,
          regexp_match(c.title, '^Collections?_of_(?:the_)?(.+)$') AS m
      WHERE m IS NOT NULL
     UNION ALL
     SELECT c.id, m[1] FROM enwiki_categories c,
          regexp_matches(c.title, '(?:^|_)${COLLECTION_HEADS}_(?:in|of|at)_(?:the_)?(.+)$', 'ig') AS m`,
  );
  const byTitle = new Map<string, number[]>();
  for (const row of result.rows) byTitle.set(row.title, [...(byTitle.get(row.title) ?? []), row.id]);
  shelves = { copy, byTitle };
  return byTitle;
}

/**
 * The works English Wikipedia files in a museum's collection categories
 * (ADR-0166): the items of the articles filed directly under the shelves
 * naming each of `titles`, as the dump writes them (`collectionShelves`). The
 * museum's own category is not read: it shelves its staff, its buildings and
 * the plays set in it beside its works. Answers `{ item, title }` pairs, a
 * title once per item it files.
 */
export async function structureCollectionItems(titles: string[]): Promise<Array<{ item: string; title: string }>> {
  if (!titles.length) return [];
  const byTitle = await collectionShelves();
  const titleOf = new Map<number, string>();
  for (const title of new Set(titles.map(stored))) {
    for (const id of byTitle.get(title) ?? []) titleOf.set(id, title);
  }
  if (!titleOf.size) return [];
  const result = await pool.query<{ item: string; category: number }>(
    `SELECT DISTINCT i.item, l.category
       FROM enwiki_category_links l
       JOIN enwiki_pages p ON p.id = l.page AND p.namespace = 0
       JOIN enwiki_page_items i ON i.page = p.id
      WHERE l.category = ANY($1::int[]) AND NOT l.subcat`,
    [[...titleOf.keys()]],
  );
  const filed = new Map<string, string>();
  for (const row of result.rows) filed.set(`${row.item}|${titleOf.get(row.category) ?? ''}`, row.item);
  return [...filed.keys()].sort().map((key) => ({ item: key.split('|')[0], title: key.split('|')[1] }));
}

/** The walk's reads asked of the copy: a statement each, no request and no pause. */
export function structureCategoryReads(): CategoryReads {
  return {
    async pages(category): Promise<WalkedPage[]> {
      const result = await pool.query<{ title: string; item: string | null }>(
        `SELECT p.title, i.item
           FROM enwiki_categories c
           JOIN enwiki_category_links l ON l.category = c.id AND NOT l.subcat
           JOIN enwiki_pages p ON p.id = l.page
           LEFT JOIN enwiki_page_items i ON i.page = p.id
          WHERE c.title = $1
          ORDER BY p.title`,
        [stored(category)],
      );
      return result.rows.map(row => ({ title: shown(row.title), item: row.item }));
    },
    async subcategories(category): Promise<string[]> {
      const result = await pool.query<{ title: string }>(
        `SELECT p.title
           FROM enwiki_categories c
           JOIN enwiki_category_links l ON l.category = c.id AND l.subcat
           JOIN enwiki_pages p ON p.id = l.page
          WHERE c.title = $1
          ORDER BY p.title`,
        [stored(category)],
      );
      return result.rows.map(row => CATEGORY_PREFIX + shown(row.title));
    },
    async articles(titles): Promise<Array<{ title: string; item: string }>> {
      if (titles.length === 0) return [];
      const result = await pool.query<{ title: string; item: string }>(
        `SELECT p.title, i.item
           FROM enwiki_pages p
           JOIN enwiki_page_items i ON i.page = p.id
          WHERE p.namespace = 0 AND p.title = ANY($1::text[])
          ORDER BY p.title`,
        [titles.map(stored)],
      );
      return result.rows.map(row => ({ title: shown(row.title), item: row.item }));
    },
  };
}
