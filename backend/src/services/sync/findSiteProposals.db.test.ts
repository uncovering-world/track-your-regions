import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { proposeFindSites } from './findSiteProposals.js';

/**
 * A find with no place of discovery is proposed for the site its own
 * coordinate stands on (#2242), executed against PostgreSQL over the local
 * Wikidata subset's claims.
 *
 * The fixture: the Louvre as an archaeology museum in Paris, holding the
 * Dendera zodiac (coordinate on the temple), The Yellow House (a painting,
 * coordinate in Arles), Harmodius and Aristogeiton (a memorial, coordinate on
 * the Agora) and the Rampin Rider (coordinate at the Acropolis Museum); and the
 * Dendera temple, the Agora, Arles and the Acropolis Museum as admitted places.
 */

const IDS = { louvre: 96301, dendera: 96302, agora: 96303, arles: 96304, acropolisMuseum: 96305 };
const WORKS = {
  zodiac: { qid: 'Q3100139', name: 'Dendera zodiac', type: 'sculpture', at: [32.6703, 26.1417] },
  yellowHouse: { qid: 'Q999100001', name: 'The Yellow House', type: 'painting', at: [4.6290, 43.6790] },
  harmodius: { qid: 'Q999100002', name: 'Harmodius and Aristogeiton', type: 'group of sculptures', at: [23.7224, 37.9748] },
  rampin: { qid: 'Q999100003', name: 'Rampin Rider', type: 'sculpture', at: [23.7286, 37.9685] },
};

async function place(id: number, name: string, lon: number, lat: number, kindName: string, type: string): Promise<void> {
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     SELECT $1::int, s.id, 'Q' || $1::text || '001', $2, ST_SetSRID(ST_MakePoint($3, $4), 4326)
       FROM experience_sources s JOIN experience_kinds k ON k.id = s.kind_id WHERE k.name = $5 LIMIT 1`,
    [id, name, lon, lat, kindName],
  );
  await pool.query(
    `INSERT INTO source_records (experience_id, kind_id, source_id, external_id, curation_state, published_at, admission, type)
     SELECT $1::int, k.id, s.id, 'Q' || $1::text || '001', 'auto', NOW(), 'admitted', $3
       FROM experience_kinds k JOIN experience_sources s ON s.kind_id = k.id WHERE k.name = $2 LIMIT 1`,
    [id, kindName, type],
  );
}

async function clear(): Promise<void> {
  await pool.query('DELETE FROM treasures WHERE external_id = ANY($1::text[])', [Object.values(WORKS).map(w => w.qid)]);
  await pool.query('DELETE FROM experiences WHERE id = ANY($1::int[])', [Object.values(IDS)]);
  await pool.query('DELETE FROM wikidata_claims WHERE subject = ANY($1::text[])', [Object.values(WORKS).map(w => w.qid)]);
}

beforeEach(async () => {
  await clear();
  await place(IDS.louvre, 'Louvre', 2.3376, 48.8606, 'Archaeology', 'museum');
  await place(IDS.dendera, 'Dendera Temple complex', 32.6703, 26.1417, 'Archaeology', 'site');
  await place(IDS.agora, 'Ancient Agora of Athens', 23.7224, 37.9755, 'Archaeology', 'site');
  await place(IDS.arles, 'Arles Amphitheatre', 4.6310, 43.6778, 'Archaeology', 'site');
  await place(IDS.acropolisMuseum, 'Acropolis Museum', 23.7286, 37.9684, 'Archaeology', 'museum');
  for (const work of Object.values(WORKS)) {
    const inserted = await pool.query<{ id: number }>(
      `INSERT INTO treasures (external_id, name, treasure_type) VALUES ($1, $2, $3) RETURNING id`,
      [work.qid, work.name, work.type],
    );
    await pool.query('INSERT INTO experience_treasures (experience_id, treasure_id) VALUES ($1, $2)', [IDS.louvre, inserted.rows[0].id]);
    await pool.query(
      `INSERT INTO wikidata_claims (subject, property, statement_id, rank, value)
       VALUES ($1, 'P625', $1 || '$p625', 1, jsonb_build_object('globe', 'http://www.wikidata.org/entity/Q2', 'latitude', $3::float8, 'longitude', $2::float8))`,
      [work.qid, work.at[0], work.at[1]],
    );
  }
  await pool.query(
    `INSERT INTO wikidata_claims (subject, property, statement_id, rank, value_item) VALUES ($1, 'P31', $1 || '$p31', 1, 'Q5003624')`,
    [WORKS.harmodius.qid],
  );
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe('proposeFindSites', () => {
  it('proposes the site a find stands on, and not a painting, a memorial or a museum', async () => {
    expect(await proposeFindSites()).toBe(1);
    const links = await pool.query<{ name: string; site_id: number; state: string; origin: string; distance_m: number }>(
      `SELECT t.name, l.site_id, l.state, l.origin, l.distance_m FROM find_site_links l JOIN treasures t ON t.id = l.treasure_id`,
    );
    expect(links.rows).toEqual([{ name: 'Dendera zodiac', site_id: IDS.dendera, state: 'proposed', origin: 'coordinate', distance_m: 0 }]);
  });

  it('never proposes again a pair a curator refused', async () => {
    await proposeFindSites();
    await pool.query(`UPDATE find_site_links SET state = 'refused'`);
    expect(await proposeFindSites()).toBe(0);
    const states = await pool.query<{ state: string }>('SELECT state FROM find_site_links');
    expect(states.rows).toEqual([{ state: 'refused' }]);
  });
});
