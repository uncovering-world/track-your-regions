import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { fetchCategoryMembers } from './wikipediaCategoryMembers.js';
import { structureCategories, structureCategoryReads } from './wikipediaStructure.js';

/**
 * English Wikipedia's categories read from the copy of its structure (#1440),
 * against PostgreSQL, through the same walk the live API is read with. A
 * fixture tree: a root, a country category the walk follows, a regional one
 * under it, a sibling of another kind it does not follow, and an unfollowed
 * museum category whose eponymous article the walk takes with its shelf.
 */

const pages: Array<[number, 0 | 14, string]> = [
  [10, 14, 'Fixture_archaeological_museums'],
  [11, 14, 'Fixture_archaeological_museums_in_Atlantis'],
  [12, 14, 'Fixture_archaeological_museums_in_North_Atlantis'],
  [13, 14, 'Fixture_byzantine_museums_in_Atlantis'],
  [14, 14, 'Fixture_National_Museum'],
  [100, 0, 'Fixture_Museum_of_Atlantis'],
  [101, 0, 'Fixture_Regional_Museum'],
  [102, 0, 'Fixture_Byzantine_Museum'],
  [103, 0, 'Fixture_National_Museum'],
  [104, 0, 'Fixture_Itemless_Museum'],
];
const items: Array<[number, string]> = [[100, 'Q98461'], [101, 'Q98462'], [102, 'Q98463'], [103, 'Q98464']];
const categories: Array<[number, string]> = [
  [1, 'Fixture_archaeological_museums'], [2, 'Fixture_archaeological_museums_in_Atlantis'],
  [3, 'Fixture_archaeological_museums_in_North_Atlantis'], [4, 'Fixture_byzantine_museums_in_Atlantis'], [5, 'Fixture_National_Museum'],
  [6, 'Museums_in_Atlantis'],
];
const links: Array<[number, number, boolean]> = [
  [11, 1, true], [12, 2, true], [13, 2, true], [14, 2, true],
  [100, 2, false], [100, 6, false], [101, 3, false], [102, 4, false], [104, 2, false],
];

const ROOT = 'Category:Fixture archaeological museums';

beforeAll(async () => {
  await pool.query('TRUNCATE enwiki_pages, enwiki_page_items, enwiki_categories, enwiki_category_links');
  await pool.query('INSERT INTO enwiki_pages (id, namespace, title) SELECT * FROM unnest($1::int[], $2::smallint[], $3::text[])',
    [pages.map(p => p[0]), pages.map(p => p[1]), pages.map(p => p[2])]);
  await pool.query('INSERT INTO enwiki_page_items (page, item) SELECT * FROM unnest($1::int[], $2::text[])',
    [items.map(i => i[0]), items.map(i => i[1])]);
  await pool.query('INSERT INTO enwiki_categories (id, title) SELECT * FROM unnest($1::int[], $2::text[])',
    [categories.map(c => c[0]), categories.map(c => c[1])]);
  await pool.query('INSERT INTO enwiki_category_links (page, category, subcat) SELECT * FROM unnest($1::int[], $2::int[], $3::bool[])',
    [links.map(l => l[0]), links.map(l => l[1]), links.map(l => l[2])]);
});

afterAll(async () => {
  await pool.query('TRUNCATE enwiki_pages, enwiki_page_items, enwiki_categories, enwiki_category_links');
  await pool.end();
});

describe("English Wikipedia's categories, read from the copy (#1440)", () => {
  it('answers what each article is filed under as the API spells it, and nothing for a page it does not hold', async () => {
    // Without the namespace, as fetchWikipediaCategories strips it: the vote's
    // rules match "Archaeological museums in …", never "Category:…".
    const answer = await structureCategories(['Fixture Museum of Atlantis', 'Fixture_Regional_Museum', 'No such article']);
    expect(answer).toEqual(new Map([
      ['Fixture Museum of Atlantis', ['Fixture archaeological museums in Atlantis', 'Museums in Atlantis']],
      ['Fixture_Regional_Museum', ['Fixture archaeological museums in North Atlantis']],
      ['No such article', []],
    ]));
  });

  it('walks the tree by the rule the live walk follows: the subcategories it names, an eponymous article with its shelf', async () => {
    const shelves = new Map<string, string[]>();
    const members = await fetchCategoryMembers(ROOT, {
      userAgent: 'unused',
      recurseInto: /^Fixture archaeological museums (?:in )/,
      shelves,
      reads: structureCategoryReads(),
    });
    expect(members).toEqual(new Map([
      ['Fixture Museum of Atlantis', 'Q98461'],
      ['Fixture National Museum', 'Q98464'],
      ['Fixture Regional Museum', 'Q98462'],
    ]));
    expect(shelves).toEqual(new Map([['Fixture National Museum', ['Fixture archaeological museums in Atlantis']]]));
  });

  it("lists a category's subcategories with their prefix and its pages with their items", async () => {
    const reads = structureCategoryReads();
    expect((await reads.subcategories('Category:Fixture archaeological museums in Atlantis')).sort()).toEqual([
      'Category:Fixture National Museum',
      'Category:Fixture archaeological museums in North Atlantis',
      'Category:Fixture byzantine museums in Atlantis',
    ]);
    expect((await reads.pages('Category:Fixture archaeological museums in Atlantis')).sort((x, y) => x.title.localeCompare(y.title))).toEqual([
      { title: 'Fixture Itemless Museum', item: null },
      { title: 'Fixture Museum of Atlantis', item: 'Q98461' },
    ]);
  });
});
