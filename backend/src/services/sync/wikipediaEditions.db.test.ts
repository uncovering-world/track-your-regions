import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { refreshWikipediaEditions } from './wikipediaEditions.js';

/**
 * Every Wikipedia edition of the articles the catalogue links is kept in a
 * serving table (#2209), copied from the local Wikidata subset's sitelinks at
 * the end of a run, executed against PostgreSQL.
 *
 * The fixture is the Altes Museum (Q32659) as Wikidata links it, a work linking
 * an article with a percent-encoded title, and an item no place links. Its rows
 * are deleted before and after.
 */

const PLACE = 96232;
const WORK_ID = 'Q999000001';
const ITEMS = ['Q32659', 'Q999000002', 'Q999000003'];

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id = $1', [PLACE]);
  await pool.query('DELETE FROM treasures WHERE external_id = $1', [WORK_ID]);
  await pool.query('DELETE FROM wikidata_sitelinks WHERE id = ANY($1::text[])', [ITEMS]);
  await pool.query('DELETE FROM wikipedia_editions');
}

beforeEach(async () => {
  await clear();
  const source = await pool.query<{ id: number }>(`SELECT id FROM experience_sources WHERE name = 'Art Museums'`);
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location, metadata)
     VALUES ($1, $2, 'Q32659', 'Altes Museum', ST_SetSRID(ST_MakePoint(13.3986, 52.5195), 4326), $3)`,
    [PLACE, source.rows[0].id, { wikipediaUrl: 'https://en.wikipedia.org/wiki/Altes_Museum' }],
  );
  await pool.query(
    `INSERT INTO treasures (external_id, name, treasure_type, wikipedia_url)
     VALUES ($1, 'Pergamon Altar', 'artifact', 'https://en.wikipedia.org/wiki/Pergamon_Altar_%28frieze%29')`,
    [WORK_ID],
  );
  await pool.query(
    `INSERT INTO wikidata_sitelinks (id, site, title) VALUES
       ('Q32659', 'enwiki', 'Altes Museum'), ('Q32659', 'ruwiki', 'Старый музей'),
       ('Q32659', 'dewiki', 'Altes Museum'), ('Q32659', 'commonswiki', 'Category:Altes Museum'),
       ('Q32659', 'enwikivoyage', 'Berlin/Mitte'),
       ('Q999000002', 'enwiki', 'Pergamon Altar (frieze)'), ('Q999000002', 'elwiki', 'Βωμός της Περγάμου'),
       ('Q999000003', 'enwiki', 'No place links this'), ('Q999000003', 'frwiki', 'Aucun lieu')`,
  );
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe('refreshWikipediaEditions', () => {
  it('keeps every Wikipedia edition of the items whose English article a place or a work links, and nothing else', async () => {
    await pool.query(`INSERT INTO wikipedia_editions (item, wiki, title) VALUES ('Q1', 'enwiki', 'Left over')`);
    expect(await refreshWikipediaEditions()).toMatchObject({ items: 2, editions: 5 });

    const kept = await pool.query<{ item: string; wiki: string; title: string }>(
      'SELECT item, wiki, title FROM wikipedia_editions ORDER BY item, wiki',
    );
    expect(kept.rows).toEqual([
      { item: 'Q32659', wiki: 'dewiki', title: 'Altes Museum' },
      { item: 'Q32659', wiki: 'enwiki', title: 'Altes Museum' },
      { item: 'Q32659', wiki: 'ruwiki', title: 'Старый музей' },
      { item: 'Q999000002', wiki: 'elwiki', title: 'Βωμός της Περγάμου' },
      { item: 'Q999000002', wiki: 'enwiki', title: 'Pergamon Altar (frieze)' },
    ]);
  });
});
