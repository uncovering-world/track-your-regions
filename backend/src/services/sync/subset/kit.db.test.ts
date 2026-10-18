import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../../../db/index.js';
import { fetchClassTree, fetchEnglishArticles, fetchSubclasses, fetchWikipediaEditions } from '../wikidataQueries.js';
import { subsetDoor } from './reader.js';

/**
 * The shared questions answered from the local Wikidata subset (#1458),
 * against PostgreSQL, through the fetchers the syncs call with a door marked
 * to read the subset. The statements are fixture rows on real items: painting
 * (Q3305213) and visual artwork (Q4502142) under work of art (Q838948), with
 * a deprecated and an outranked edge added to show which edges `wdt:` reads.
 * A door that sent SPARQL would fail the spec.
 */

const door = subsetDoor(async () => {
  throw new Error('a subset door sent SPARQL');
});

const PAINTING = 'Q3305213';
const VISUAL_ARTWORK = 'Q4502142';
const WORK_OF_ART = 'Q838948';
const MONA_LISA = 'Q12418';
const LEONARDO = 'Q762';
/** The stele of Lemnos: editions in other languages, none in English (#1608). */
const STELE_OF_LEMNOS = 'Q3501422';

async function claim(subject: string, value: string, rank: -1 | 0 | 1, n: number): Promise<void> {
  await pool.query(
    `INSERT INTO wikidata_claims (subject, property, statement_id, rank, value_item) VALUES ($1, 'P279', $2, $3, $4)`,
    [subject, `${subject}$kit-${n}`, rank, value],
  );
}

beforeAll(async () => {
  await pool.query('TRUNCATE wikidata_claims, wikidata_sitelinks');
  await claim(PAINTING, VISUAL_ARTWORK, 0, 1);
  await claim(VISUAL_ARTWORK, WORK_OF_ART, 0, 2);
  // A deprecated edge is never read, and a normal edge beside a preferred one is outranked.
  await claim(LEONARDO, WORK_OF_ART, -1, 3);
  await claim(MONA_LISA, WORK_OF_ART, 0, 4);
  await claim(MONA_LISA, PAINTING, 1, 5);
  // A preferred unknown value outranks the normal item values beside it, as it does for wdt:.
  await claim(LEONARDO, PAINTING, 0, 6);
  await pool.query(
    `INSERT INTO wikidata_claims (subject, property, statement_id, rank, value_item, value) VALUES ($1, 'P279', $2, 1, NULL, '{"somevalue": true}')`,
    [LEONARDO, `${LEONARDO}$kit-7`],
  );
  await pool.query(
    `INSERT INTO wikidata_sitelinks (id, site, title) VALUES
       ($1, 'enwiki', 'Mona Lisa'), ($1, 'frwiki', 'La Joconde'), ($1, 'simplewiki', 'Mona Lisa'),
       ($1, 'commonswiki', 'Category:Mona Lisa'), ($1, 'enwikiquote', 'Mona Lisa')`,
    [MONA_LISA],
  );
  await pool.query(`INSERT INTO wikidata_sitelinks (id, site, title) VALUES ($1, 'frwiki', 'Stèle de Lemnos')`, [STELE_OF_LEMNOS]);
});

afterAll(async () => {
  await pool.query('TRUNCATE wikidata_claims, wikidata_sitelinks');
  await pool.end();
});

describe('the shared questions, read from the subset (#1458)', () => {
  it('answers the direct subclasses of a frontier by best rank', async () => {
    expect(await fetchSubclasses(door, [WORK_OF_ART])).toEqual([VISUAL_ARTWORK]);
    expect(await fetchSubclasses(door, [PAINTING])).toEqual([MONA_LISA]);
  });

  it('answers the whole tree under a root, root included', async () => {
    expect([...await fetchClassTree(door, WORK_OF_ART, 'work of art')].sort())
      .toEqual([MONA_LISA, PAINTING, VISUAL_ARTWORK, WORK_OF_ART].sort());
  });

  it('counts Wikipedia editions only, 0 where none writes about the item', async () => {
    const editions = await fetchWikipediaEditions(door, [MONA_LISA, LEONARDO]);
    expect(editions.get(MONA_LISA)).toBe(3);
    expect(editions.get(LEONARDO)).toBe(0);
  });

  it("answers an item's English article by the address the live service names, and nothing where English has none (#1608)", async () => {
    const articles = await fetchEnglishArticles(door, [MONA_LISA, STELE_OF_LEMNOS, LEONARDO]);
    expect(articles).toEqual(new Map([[MONA_LISA, 'https://en.wikipedia.org/wiki/Mona_Lisa']]));
  });
});
