import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { answerFindSiteLinkRequest, getFindSiteLinks } from './findSiteLinksController.js';

/**
 * A site's curator answers where a find comes from (#2242), against
 * PostgreSQL: what the card is asked about, and what an answer writes.
 *
 * The fixture is a made-up temple, a museum a reader may be sent to, and three
 * works the museum shows whose items name no place of discovery: a relief the
 * run proposed for the temple, a stela already confirmed, and an amulet
 * refused. A fourth, proposed too, is held only by a museum still waiting for
 * a curator, so no reader sees it anywhere. Deleted before and after.
 */

const TEMPLE = 9570;
const MUSEUM = 9571;
const UNREAD = 9572;
const ADMIN_UUID = '00000000-0000-4000-8000-000000009570';
const CURATOR_UUID = '00000000-0000-4000-8000-000000009571';
const WORKS = {
  relief: 'Q9570-relief',
  stela: 'Q9570-stela',
  amulet: 'Q9570-amulet',
  hidden: 'Q9570-hidden-jar',
  unread: 'Q9570-unread-lamp',
} as const;

let admin: Express.User;
let outOfScope: Express.User;
const ids: Record<keyof typeof WORKS, number> = { relief: 0, stela: 0, amulet: 0, hidden: 0, unread: 0 };

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experience_curation_log WHERE experience_id = ANY($1::int[])', [[TEMPLE, MUSEUM, UNREAD]]);
  await pool.query('DELETE FROM experiences WHERE id = ANY($1::int[])', [[TEMPLE, MUSEUM, UNREAD]]);
  await pool.query('DELETE FROM treasures WHERE external_id = ANY($1::text[])', [Object.values(WORKS)]);
  await pool.query('DELETE FROM users WHERE uuid = ANY($1::text[])', [[ADMIN_UUID, CURATOR_UUID]]);
}

async function place(id: number, type: string, state: string): Promise<void> {
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     VALUES ($1, 5, $2, $3, ST_SetSRID(ST_MakePoint(32.67, 26.14), 4326))`,
    [id, `Q-place-${id}`, `Place ${id}`],
  );
  await pool.query(
    `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, type, admission, curation_state)
     VALUES ($1, 5, 5, $2, $3, 'admitted', $4)`,
    [id, `Q-place-${id}`, type, state],
  );
}

async function find(key: keyof typeof WORKS, venue: number, state: string, workState = 'verified'): Promise<void> {
  const row = await pool.query<{ id: number }>(
    `INSERT INTO treasures (external_id, name, treasure_type, curation_state)
     VALUES ($1, $1, 'relief', $2) RETURNING id`,
    [WORKS[key], workState],
  );
  ids[key] = row.rows[0].id;
  await pool.query(
    `INSERT INTO experience_treasures (experience_id, treasure_id, curation_state) VALUES ($1, $2, 'verified')`,
    [venue, ids[key]],
  );
  await pool.query(
    `INSERT INTO find_site_links (treasure_id, site_id, state, origin, distance_m)
     VALUES ($1, $2, $3, 'coordinate', $4)`,
    [ids[key], TEMPLE, state, key === 'stela' ? 120 : 0],
  );
}

beforeEach(async () => {
  await clear();
  const a = await pool.query<{ id: number }>(
    `INSERT INTO users (uuid, display_name, role) VALUES ($1, 'An admin', 'admin') RETURNING id`, [ADMIN_UUID],
  );
  const c = await pool.query<{ id: number }>(
    `INSERT INTO users (uuid, display_name, role) VALUES ($1, 'A curator', 'curator') RETURNING id`, [CURATOR_UUID],
  );
  admin = { id: a.rows[0].id, role: 'admin' } as Express.User;
  outOfScope = { id: c.rows[0].id, role: 'curator' } as Express.User;
  await place(TEMPLE, 'site', 'verified');
  await place(MUSEUM, 'museum', 'verified');
  await place(UNREAD, 'museum', 'pending');
  await find('relief', MUSEUM, 'proposed');
  await find('stela', MUSEUM, 'confirmed');
  await find('amulet', MUSEUM, 'refused');
  await find('hidden', UNREAD, 'proposed');
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe("a site's curator answers where a find comes from", () => {
  it('lists the open proposals first, then the confirmed links, and no refused or hidden find', async () => {
    const { links } = await getFindSiteLinks({ params: { id: TEMPLE }, caller: admin });

    expect(links.map((link) => [link.name, link.state])).toEqual([
      [WORKS.relief, 'proposed'],
      [WORKS.stela, 'confirmed'],
    ]);
    expect(links[0].shown_at.map((venue) => venue.id)).toEqual([MUSEUM]);
    expect(links[0].distance_m).toBe(0);
  });

  it('records a yes with who said it, and a no that takes a confirmed link back', async () => {
    await answerFindSiteLinkRequest({
      params: { id: TEMPLE, treasureId: ids.relief }, body: { answer: 'confirmed' }, caller: admin,
    });
    await answerFindSiteLinkRequest({
      params: { id: TEMPLE, treasureId: ids.stela }, body: { answer: 'refused' }, caller: admin,
    });

    const rows = await pool.query<{ treasure_id: number; state: string; decided_by: number | null }>(
      `SELECT treasure_id, state, decided_by FROM find_site_links WHERE site_id = $1 AND decided_at IS NOT NULL
        ORDER BY treasure_id`,
      [TEMPLE],
    );
    expect(rows.rows).toEqual([
      { treasure_id: ids.relief, state: 'confirmed', decided_by: admin.id },
      { treasure_id: ids.stela, state: 'refused', decided_by: admin.id },
    ]);
    // Both in the temple's curation log, the no named as a link taken back.
    const log = await pool.query<{ curator_id: number; details: Record<string, unknown> }>(
      `SELECT curator_id, details FROM experience_curation_log
        WHERE experience_id = $1 AND action = 'find_site_answered' ORDER BY id`,
      [TEMPLE],
    );
    expect(log.rows).toEqual([
      { curator_id: admin.id, details: { treasureId: ids.relief, find: WORKS.relief, answer: 'confirmed', wasConfirmed: false } },
      { curator_id: admin.id, details: { treasureId: ids.stela, find: WORKS.stela, answer: 'refused', wasConfirmed: true } },
    ]);
  });

  it('asks nothing about a find whose own item names a find spot', async () => {
    await pool.query(
      `UPDATE treasures SET metadata = jsonb_build_object('foundAt', jsonb_build_object('qid', 'Q9570-a-dig')) WHERE id = $1`,
      [ids.relief],
    );
    const { links } = await getFindSiteLinks({ params: { id: TEMPLE }, caller: admin });
    expect(links.map((link) => link.name)).toEqual([WORKS.stela]);
  });

  it('asks nothing about a find not passed itself', async () => {
    await find('unread', MUSEUM, 'proposed', 'pending');
    const { links } = await getFindSiteLinks({ params: { id: TEMPLE }, caller: admin });
    expect(links.map((link) => link.name)).toEqual([WORKS.relief, WORKS.stela]);
  });

  it('answers a find the site has no link to with 404, and writes nothing', async () => {
    await expect(answerFindSiteLinkRequest({
      params: { id: MUSEUM, treasureId: ids.relief }, body: { answer: 'confirmed' }, caller: admin,
    })).rejects.toMatchObject({ statusCode: 404 });
  });

  it('refuses a curator whose scope does not reach the site', async () => {
    await expect(getFindSiteLinks({ params: { id: TEMPLE }, caller: outOfScope }))
      .rejects.toMatchObject({ statusCode: 403 });
    await expect(answerFindSiteLinkRequest({
      params: { id: TEMPLE, treasureId: ids.relief }, body: { answer: 'confirmed' }, caller: outOfScope,
    })).rejects.toMatchObject({ statusCode: 403 });
    const state = await pool.query<{ state: string }>(
      'SELECT state FROM find_site_links WHERE treasure_id = $1', [ids.relief],
    );
    expect(state.rows[0].state).toBe('proposed');
  });
});
