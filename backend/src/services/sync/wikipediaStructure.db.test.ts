import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { fetchCategoryMembers } from './wikipediaCategoryMembers.js';
import {
  forgetCollectionShelves, structureArticleItems, structureCategories, structureCategoriesOfItems, structureCategoryReads,
  structureCollectionItems, structureItemsInCategories,
} from './wikipediaStructure.js';
import { NOT_A_PLACE_CATEGORY, STREET_ART_CATEGORY } from './publicArt/streetArtTest.js';

/**
 * English Wikipedia's categories read from the copy of its structure (#1440),
 * against PostgreSQL, through the same walk the live API is read with. A
 * fixture tree: a root, a country category the walk follows, a regional one
 * under it, a sibling of another kind it does not follow, and an unfollowed
 * museum category whose eponymous article the walk takes with its shelf.
 * Beside it, the street-art categories (#2035): one of places, one of people.
 * Two redirects in English Wikipedia's redirect table (#2416): one to an
 * article of the copy, one to an article it does not hold.
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
  [105, 0, 'Fixture_Lennon_Wall'],
  [106, 0, 'Fixture_Street_Artist'],
  // The National Museum's shelves (ADR-0166): a collection, an object shelf, and its staff.
  [107, 0, 'Fixture_Tablet'],
  [108, 0, 'Fixture_Employee'],
  [109, 0, 'Fixture_Vase'],
  [110, 0, 'Fixture_Statue'],
];
const items: Array<[number, string]> = [
  [100, 'Q98461'], [101, 'Q98462'], [102, 'Q98463'], [103, 'Q98464'], [105, 'Q98465'], [106, 'Q98466'],
  [107, 'Q98467'], [108, 'Q98468'], [109, 'Q98469'], [110, 'Q98470'],
];
const categories: Array<[number, string]> = [
  [1, 'Fixture_archaeological_museums'], [2, 'Fixture_archaeological_museums_in_Atlantis'],
  [3, 'Fixture_archaeological_museums_in_North_Atlantis'], [4, 'Fixture_byzantine_museums_in_Atlantis'], [5, 'Fixture_National_Museum'],
  [6, 'Museums_in_Atlantis'], [7, 'Graffiti_in_Atlantis'], [8, 'Street_artists_from_Atlantis'],
  [9, 'Collection_of_the_Fixture_National_Museum'], [10, 'Employees_of_the_Fixture_National_Museum'],
  [11, 'Ancient_objects_in_the_Fixture_National_Museum'],
  // A shelf whose title opens with the head noun: nothing stands before it.
  [12, 'Sculptures_in_the_Fixture_National_Museum'],
];
const links: Array<[number, number, boolean]> = [
  [11, 1, true], [12, 2, true], [13, 2, true], [14, 2, true],
  [100, 2, false], [100, 6, false], [101, 3, false], [102, 4, false], [104, 2, false],
  [105, 7, false], [106, 8, false],
  [107, 9, false], [108, 10, false], [109, 11, false], [108, 5, false], [110, 12, false],
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
  await pool.query(`DELETE FROM wikipedia_redirects WHERE site = 'enwiki' AND title LIKE 'Fixture %'`);
  await pool.query(`INSERT INTO wikipedia_redirects (site, title, target) VALUES
    ('enwiki', 'Fixture Atlantis Museum', 'Fixture Museum of Atlantis'), ('enwiki', 'Fixture Lost Museum', 'Fixture Sunken Museum')`);
});

afterAll(async () => {
  await pool.query('TRUNCATE enwiki_pages, enwiki_page_items, enwiki_categories, enwiki_category_links');
  await pool.query(`DELETE FROM wikipedia_redirects WHERE site = 'enwiki' AND title LIKE 'Fixture %'`);
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

  it('names the items of the articles filed directly under the categories a title rule matches', async () => {
    expect(await structureItemsInCategories('archaeological_museums', 'north')).toEqual(['Q98461']);
    expect(await structureItemsInCategories('ARCHAEOLOGICAL_MUSEUMS', '^$')).toEqual(['Q98461', 'Q98462']);
    expect(await structureItemsInCategories(STREET_ART_CATEGORY, NOT_A_PLACE_CATEGORY)).toEqual(['Q98465']);
    expect(await structureItemsInCategories('street_art', '^$')).toEqual(['Q98466']);
    // With no exception given, every matching category counts (#2171).
    expect(await structureItemsInCategories('ARCHAEOLOGICAL_MUSEUMS')).toEqual(['Q98461', 'Q98462']);
  });

  it('names the matching categories each item is filed directly under, as the API titles them (#2171)', async () => {
    const filed = await structureCategoriesOfItems(['Q98461', 'Q98465', 'Q99999999'], '^Fixture_archaeological_museums_in_');
    // The Museum of Atlantis is filed under the Atlantis category and Museums in Atlantis; only the first matches.
    expect([...filed]).toEqual([['Q98461', ['Fixture archaeological museums in Atlantis']]]);
    expect(await structureCategoriesOfItems([], '.')).toEqual(new Map());
  });

  it('names what a museum\'s collection shelves file, and nothing its staff shelf or its own category holds (ADR-0166)', async () => {
    forgetCollectionShelves();
    expect(await structureCollectionItems(['Fixture National Museum'])).toEqual([
      { item: 'Q98467', title: 'Fixture_National_Museum' },
      { item: 'Q98469', title: 'Fixture_National_Museum' },
      { item: 'Q98470', title: 'Fixture_National_Museum' },
    ]);
    expect(await structureCollectionItems(['Fixture Museum of Atlantis'])).toEqual([]);
    expect(await structureCollectionItems([])).toEqual([]);
  });

  it('resolves a title that is a redirect to its article\'s item, under the title asked (#2416)', async () => {
    const found = await structureArticleItems(['Fixture Atlantis Museum', 'Fixture Lost Museum', 'Fixture Regional Museum', 'Fixture Nowhere']);
    expect(found).toEqual([
      { title: 'Fixture Atlantis Museum', item: 'Q98461', redirected: true },
      { title: 'Fixture Regional Museum', item: 'Q98462', redirected: false },
    ]);
  });

  it('keeps the category walk to an article of exactly a subcategory\'s name, as the live walk asks (#2416)', async () => {
    expect(await structureCategoryReads().articles(['Fixture Atlantis Museum', 'Fixture Regional Museum'], ROOT))
      .toEqual([{ title: 'Fixture Regional Museum', item: 'Q98462' }]);
  });
});
