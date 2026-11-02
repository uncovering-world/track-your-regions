/**
 * The display in a crowded city against PostgreSQL (ADR-0172, #2201): a place
 * is crowded out when ten better-known places of its kind and type lie within
 * 10 km, the schema recounts around a place when its candidacy changes, one
 * recount at a time as each transaction commits, and a
 * crowded-out place leaves what a reader is shown but not what is offered.
 * A place holding a work a reader is shown is never crowded out and takes none
 * of the ten (ADR-0173, #2245).
 * Fixture rows: twelve churches within 2 km of the Pantheon, a mosque among
 * them, and a church 25 km out at Frascati.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from './index.js';
import { placeOfferedSql, placeShownSql } from './membership.js';

const WORSHIP = 4;
const BASE = 9_201_000;
const CHURCHES = 12;
const MOSQUE = BASE + 50;
const FRASCATI = BASE + 60;
const ROME = { lat: 41.8986, lon: 12.4769 };

async function place(id: number, name: string, lat: number, lon: number, type: string, fame: number): Promise<number> {
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     VALUES ($1, 4, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326))`,
    [id, `Q${id}`, name, lon, lat],
  );
  const membership = await pool.query<{ id: number }>(
    `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, type, curation_state, published_at)
     VALUES ($1, $2, 4, $3, $4, 'verified', NOW()) RETURNING id`,
    [id, WORSHIP, `Q${id}`, type],
  );
  await pool.query(
    'INSERT INTO membership_fame (membership_id, readers, guide_editions, wikipedia_editions) VALUES ($1, $2, $3, $4)',
    [membership.rows[0].id, fame * 1000, fame, fame],
  );
  return membership.rows[0].id;
}

const crowded = async (): Promise<number[]> =>
  (await pool.query<{ experience_id: number }>(
    `SELECT m.experience_id FROM membership_crowding c
       JOIN experience_kind_memberships m ON m.id = c.membership_id
      WHERE m.experience_id >= $1 ORDER BY 1`, [BASE])).rows.map(row => row.experience_id);

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id >= $1 AND id < $2', [BASE, BASE + 1000]);
  await pool.query("DELETE FROM treasures WHERE external_id LIKE 'Q9201%'");
}

/** Hang a work in a place, as the works run links one: offered and not unread. */
async function hang(placeId: number, name: string): Promise<number> {
  const work = await pool.query<{ id: number }>(
    `INSERT INTO treasures (external_id, name, treasure_type) VALUES ($1, $2, 'painting') RETURNING id`,
    [`Q${placeId}9`, name]);
  const link = await pool.query<{ id: number }>(
    'INSERT INTO experience_treasures (experience_id, treasure_id) VALUES ($1, $2) RETURNING id',
    [placeId, work.rows[0].id]);
  return link.rows[0].id;
}

beforeAll(clear);
afterAll(async () => {
  await clear();
  await pool.end();
});

describe('a crowded city shows the ten best known of a type (ADR-0172)', () => {
  beforeEach(async () => {
    await clear();
    // Church i is the i-th best known: fame 12 for the first, 1 for the twelfth.
    for (let i = 1; i <= CHURCHES; i++) {
      await place(BASE + i, `Church ${i}`, ROME.lat + i * 0.001, ROME.lon + i * 0.001, 'church', CHURCHES + 1 - i);
    }
    await place(MOSQUE, 'Mosque of Rome', ROME.lat, ROME.lon - 0.01, 'mosque', 1);
    await place(FRASCATI, 'Frascati Cathedral', 41.8076, 12.6800, 'church', 1);
    await pool.query('SELECT refresh_crowding()');
  });

  it('crowds out the places ten better-known neighbours of their type outrank, and no other', async () => {
    // Churches 11 and 12 have ten better known within 10 km; the mosque is
    // another type, and Frascati lies 25 km out.
    expect(await crowded()).toEqual([BASE + 11, BASE + 12]);
    const outranked = await pool.query<{ outranked_by: number }>(
      `SELECT c.outranked_by FROM membership_crowding c JOIN experience_kind_memberships m ON m.id = c.membership_id
        WHERE m.experience_id = $1`, [BASE + 12]);
    expect(outranked.rows[0].outranked_by).toBe(11);
  });

  it('recounts around a place a curator refuses, as the refusal commits', async () => {
    await pool.query("UPDATE experience_kind_memberships SET admission = 'refused' WHERE experience_id = $1", [BASE + 1]);
    expect(await crowded()).toEqual([BASE + 12]);
    await pool.query("UPDATE experience_kind_memberships SET admission = 'admitted' WHERE experience_id = $1", [BASE + 1]);
    expect(await crowded()).toEqual([BASE + 11, BASE + 12]);
  });

  it('serialises two recounts whose areas overlap, each seeing the other\'s committed rows', async () => {
    // Two curators refuse two of Rome's churches at once. Each recount deletes
    // and re-inserts churches 11 and 12; unserialised, the second insert of a
    // membership the first committed would fail on the key, and the second
    // delete would never see the first's rows.
    const [first, second] = [await pool.connect(), await pool.connect()];
    try {
      // The first recount runs now, in a transaction not yet committed; the
      // second starts while the first holds its rows, and must wait for it.
      await first.query('BEGIN');
      await first.query("UPDATE experience_kind_memberships SET admission = 'refused' WHERE experience_id = $1", [BASE + 1]);
      await first.query('SET CONSTRAINTS ALL IMMEDIATE');
      await second.query('BEGIN');
      await second.query("UPDATE experience_kind_memberships SET admission = 'refused' WHERE experience_id = $1", [BASE + 2]);
      const recount = second.query('SET CONSTRAINTS ALL IMMEDIATE');
      await new Promise(resolve => setTimeout(resolve, 200));
      await first.query('COMMIT');
      await recount;
      await second.query('COMMIT');
    } finally {
      first.release();
      second.release();
    }
    // Ten churches are left admitted near the Pantheon: none has ten better known.
    expect(await crowded()).toEqual([]);
  });

  it('recounts where a place was once it is lost or moved', async () => {
    await pool.query("UPDATE experiences SET existence = 'lost' WHERE id = $1", [BASE + 2]);
    expect(await crowded()).toEqual([BASE + 12]);
    await pool.query("UPDATE experiences SET existence = 'extant' WHERE id = $1", [BASE + 2]);
    await pool.query('UPDATE experiences SET location = ST_SetSRID(ST_MakePoint(13.5, 42.5), 4326) WHERE id = $1', [BASE + 3]);
    expect(await crowded()).toEqual([BASE + 12]);
  });

  it('hides nothing a membership measured since the last refresh adds', async () => {
    // A thirteenth church with no score yet: neither crowded out nor outranking.
    const id = BASE + 13;
    await pool.query(
      `INSERT INTO experiences (id, source_id, external_id, name, location)
       VALUES ($1, 4, $2, 'Church 13', ST_SetSRID(ST_MakePoint($3, $4), 4326))`,
      [id, `Q${id}`, ROME.lon, ROME.lat]);
    await pool.query(
      `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, type, curation_state, published_at)
       VALUES ($1, $2, 4, $3, 'church', 'verified', NOW())`, [id, WORSHIP, `Q${id}`]);
    expect(await crowded()).toEqual([BASE + 11, BASE + 12]);
  });

  it('leaves a crowded-out place offered and not shown', async () => {
    const read = async (predicate: string) => (await pool.query<{ id: number }>(
      `SELECT e.id FROM experiences e WHERE e.id >= $1 AND e.id < $2 AND ${predicate} ORDER BY 1`,
      [BASE, BASE + 1000])).rows.map(row => row.id);
    expect(await read(placeOfferedSql('e'))).toContain(BASE + 12);
    expect(await read(placeShownSql('e'))).not.toContain(BASE + 12);
    expect(await read(placeShownSql('e'))).toContain(BASE + 10);
  });

  it('shows a place holding a work, and counts it among none of the ten', async () => {
    // Church 3 holds a painting: church 11 now has nine better known that
    // hold none, church 12 still ten (1, 2 and 4 to 11).
    await hang(BASE + 3, 'The Calling of Saint Matthew');
    expect(await crowded()).toEqual([BASE + 12]);
    // A painting in church 12 itself shows it; church 11 stays shown.
    await hang(BASE + 12, 'The Ecstasy of Saint Teresa');
    expect(await crowded()).toEqual([]);
  });

  it('returns a place to the tail once the source stops placing its only work there', async () => {
    const link = await hang(BASE + 12, 'Madonna di Loreto');
    expect(await crowded()).toEqual([BASE + 11]);
    await pool.query('UPDATE experience_treasures SET missing_since = NOW() WHERE id = $1', [link]);
    expect(await crowded()).toEqual([BASE + 11, BASE + 12]);
  });

  it('shows every place of a kind that declares no rule', async () => {
    await pool.query('UPDATE experience_kinds SET crowding_limit = NULL, crowding_radius_km = NULL WHERE id = $1', [WORSHIP]);
    try {
      await pool.query('SELECT refresh_crowding()');
      expect(await crowded()).toEqual([]);
    } finally {
      await pool.query('UPDATE experience_kinds SET crowding_limit = 10, crowding_radius_km = 10 WHERE id = $1', [WORSHIP]);
    }
  });
});
