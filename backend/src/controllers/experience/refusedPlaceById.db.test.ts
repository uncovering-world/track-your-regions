import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { getExperience } from './experienceQueryController.js';

/**
 * A refused place read by its id (ADR-0222, #2613): a reader is answered 404,
 * as ADR-0024 decision 5 hides it, and a curator or admin whose scope reaches
 * it is answered its card, so *Curate* opens on an arrival a curator turned
 * away (Lena Bridge, kept out of Bridges & engineering marvels on dev).
 */

const PLACE = 9592;
/** A place that holds no membership at all: the catalogue checks' debt, which no card can name a kind for. */
const BARE = 9593;
const KEY = `Q${PLACE}001`;
const ADMIN = '00000000-0000-4000-8000-000000009592';

let adminId = 0;

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experience_curation_log WHERE experience_id = ANY($1)', [[PLACE, BARE]]);
  await pool.query('DELETE FROM experiences WHERE id = ANY($1)', [[PLACE, BARE]]);
  await pool.query('DELETE FROM users WHERE uuid = $1', [ADMIN]);
}

beforeEach(async () => {
  await clear();
  adminId = (await pool.query<{ id: number }>(
    `INSERT INTO users (uuid, display_name, role) VALUES ($1, 'An admin', 'admin') RETURNING id`, [ADMIN],
  )).rows[0].id;
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     SELECT $1, s.id, $2, 'Lena Bridge (refused by id fixture)', ST_SetSRID(ST_MakePoint(129.73, 62.04), 4326)
       FROM experience_sources s WHERE s.name = 'Bridges & engineering marvels'`,
    [PLACE, KEY],
  );
  // The membership as a curator's no to its arrival leaves it: refused, the arrival never published.
  await pool.query(
    `INSERT INTO source_records (experience_id, kind_id, source_id, external_id, curation_state, admission, admission_reason)
     SELECT $1, s.kind_id, s.id, $2, 'pending', 'refused', 'kept out by a curator'
       FROM experience_sources s WHERE s.name = 'Bridges & engineering marvels'`,
    [PLACE, KEY],
  );
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe('a refused place read by its id (ADR-0222)', () => {
  it('answers even an admin 404 for a place that holds no membership, rather than a card with no kind', async () => {
    await pool.query(
      `INSERT INTO experiences (id, source_id, external_id, name, location)
       SELECT $1, s.id, $2, 'A place in no kind (refused by id fixture)', ST_SetSRID(ST_MakePoint(129.7, 62.0), 4326)
         FROM experience_sources s WHERE s.name = 'Bridges & engineering marvels'`,
      [BARE, `Q${BARE}001`],
    );
    await expect(getExperience({ params: { id: BARE }, caller: { id: adminId, role: 'admin' } as Express.User }))
      .rejects.toThrow('Experience not found');
  });

  it('answers a reader 404, as the kind turned it down', async () => {
    await expect(getExperience({ params: { id: PLACE }, caller: undefined })).rejects.toThrow('Experience not found');
  });

  it('answers an admin its card, so its Curate dialog opens', async () => {
    const card = await getExperience({ params: { id: PLACE }, caller: { id: adminId, role: 'admin' } as Express.User });
    expect(card.id).toBe(PLACE);
    expect(card.name).toContain('Lena Bridge');
  });
});
