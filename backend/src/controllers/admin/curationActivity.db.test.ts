import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { getCurationActivity, getCuratorActivity } from './curationActivityController.js';

/**
 * The curation log read across curators and filtered (#611), against PostgreSQL.
 *
 * Japan holds Kyoto in a fixture world view; Kinkaku-ji sits in Kyoto, Itsukushima
 * Shrine in Japan itself, and Cologne Cathedral in neither. An admin with no
 * assignment row and a former curator, whose scope was revoked, act on them, and
 * the catalogue merges one place on its own. Every act is dated in 2001, and every read is bounded to 2001, so rows
 * other specs leave in the log never enter the answer.
 */

const WORLD_VIEW = 9711;
const JAPAN = 97110;
const KYOTO = 97111;
const KINKAKU = 9711;
const ITSUKUSHIMA = 9712;
const COLOGNE = 9713;
const ADMIN_UUID = '00000000-0000-4000-8000-000000009711';
const CURATOR_UUID = '00000000-0000-4000-8000-000000009712';
const YEAR = { since: '2001-01-01T00:00:00Z', before: '2002-01-01T00:00:00Z' };

let admin = 0;
let curator = 0;
const logIds: Record<string, number> = {};

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id = ANY($1::int[])', [[KINKAKU, ITSUKUSHIMA, COLOGNE]]);
  await pool.query('DELETE FROM users WHERE uuid = ANY($1::text[])', [[ADMIN_UUID, CURATOR_UUID]]);
  await pool.query('DELETE FROM regions WHERE world_view_id = $1', [WORLD_VIEW]);
  await pool.query('DELETE FROM world_views WHERE id = $1', [WORLD_VIEW]);
}

async function act(name: string, experienceId: number, curatorId: number | null, action: string, at: string, regionId: number | null = null) {
  const row = await pool.query<{ id: number }>(
    `INSERT INTO experience_curation_log (experience_id, curator_id, action, region_id, created_at)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [experienceId, curatorId, action, regionId, at],
  );
  logIds[name] = row.rows[0].id;
}

beforeEach(async () => {
  await clear();
  await pool.query(`INSERT INTO world_views (id, name, is_default, tile_version) VALUES ($1, 'Activity fixture', false, 0)`, [WORLD_VIEW]);
  await pool.query(`INSERT INTO regions (id, world_view_id, name) VALUES ($1, $2, 'Japan (activity fixture)')`, [JAPAN, WORLD_VIEW]);
  await pool.query(
    `INSERT INTO regions (id, world_view_id, name, parent_region_id) VALUES ($1, $2, 'Kyoto (activity fixture)', $3)`,
    [KYOTO, WORLD_VIEW, JAPAN],
  );
  for (const [id, name, lon, lat] of [
    [KINKAKU, 'Kinkaku-ji', 135.7292, 35.0394], [ITSUKUSHIMA, 'Itsukushima Shrine', 132.3196, 34.2959],
    [COLOGNE, 'Cologne Cathedral', 6.9583, 50.9413],
  ] as const) {
    await pool.query(
      `INSERT INTO experiences (id, source_id, external_id, name, location)
       SELECT $1, s.id, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326) FROM experience_sources s WHERE s.name = 'Archaeology'`,
      [id, `Q${id}-activity-fixture`, `${name} (activity fixture)`, lon, lat],
    );
  }
  await pool.query(
    `INSERT INTO experience_regions (experience_id, region_id, assignment_type) VALUES ($1, $2, 'auto'), ($3, $4, 'auto')`,
    [KINKAKU, KYOTO, ITSUKUSHIMA, JAPAN],
  );
  admin = (await pool.query<{ id: number }>(
    `INSERT INTO users (uuid, display_name, role) VALUES ($1, 'An admin', 'admin') RETURNING id`, [ADMIN_UUID],
  )).rows[0].id;
  curator = (await pool.query<{ id: number }>(
    `INSERT INTO users (uuid, display_name, role) VALUES ($1, 'A curator', 'user') RETURNING id`, [CURATOR_UUID],
  )).rows[0].id;
  await act('published', KINKAKU, admin, 'published', '2001-10-01T09:00:00Z');
  await act('edited', ITSUKUSHIMA, curator, 'edited', '2001-10-05T09:00:00Z');
  await act('merged', COLOGNE, null, 'merged', '2001-10-06T09:00:00Z');
  // Two acts one batch wrote in the same instant: the later id is the newer.
  await act('added', COLOGNE, curator, 'added_to_region', '2001-10-07T09:00:00Z', KYOTO);
  await act('publishedToo', COLOGNE, admin, 'published', '2001-10-07T09:00:00Z');
});

afterAll(async () => {
  await clear();
  await pool.end();
});

const feed = (over: Record<string, unknown> = {}) => getCurationActivity({
  query: { limit: 50, offset: 0, ...YEAR, ...over },
});
const named = (answer: { activity: Array<{ id: number }> }) =>
  answer.activity.map(entry => Object.keys(logIds).find(name => logIds[name] === entry.id));

describe('the curation activity feed (#611)', () => {
  it('lists every curator\'s acts and the catalogue\'s own merges, newest first, with who acted', async () => {
    const answer = await feed();
    expect(named(answer)).toEqual(['publishedToo', 'added', 'merged', 'edited', 'published']);
    expect(answer.total).toBe(5);
    expect(answer.activity[0]).toMatchObject({ curator_id: admin, curator_name: 'An admin', experience_id: COLOGNE });
    expect(answer.activity[2]).toMatchObject({ action: 'merged', curator_id: null, curator_name: null });
    expect(answer.activity[1]).toMatchObject({ region_id: KYOTO, region_name: 'Kyoto (activity fixture)' });
  });

  it('names everyone who has acted, a curator whose scope was revoked included', async () => {
    const answer = await feed();
    expect(answer.curators).toEqual(expect.arrayContaining([
      { id: admin, name: 'An admin' }, { id: curator, name: 'A curator' },
    ]));
  });

  it('narrows to one curator, an admin with no assignment row among them', async () => {
    const answer = await feed({ curatorId: admin });
    expect(named(answer)).toEqual(['publishedToo', 'published']);
    expect(answer.total).toBe(2);
  });

  it('narrows to one action', async () => {
    expect(named(await feed({ action: 'published' }))).toEqual(['publishedToo', 'published']);
  });

  it('keeps the acts on places in a region or below it, and the acts naming such a region', async () => {
    expect(named(await feed({ regionId: JAPAN }))).toEqual(['added', 'edited', 'published']);
    expect(named(await feed({ regionId: KYOTO }))).toEqual(['added', 'published']);
  });

  it('keeps the acts from `since` up to, not including, `before`', async () => {
    const answer = await feed({ since: '2001-10-05T09:00:00Z', before: '2001-10-07T09:00:00Z' });
    expect(named(answer)).toEqual(['merged', 'edited']);
    expect(answer.total).toBe(2);
  });

  it('composes the filters with each other and with the page', async () => {
    const page = await feed({ curatorId: curator, regionId: JAPAN, limit: 1, offset: 1 });
    expect(named(page)).toEqual(['edited']);
    expect(page).toMatchObject({ total: 2, limit: 1, offset: 1 });
  });

  it('reads one curator\'s acts through the same filters', async () => {
    const answer = await getCuratorActivity({
      params: { userId: curator }, query: { limit: 50, offset: 0, ...YEAR, action: 'edited' },
    });
    expect(named(answer)).toEqual(['edited']);
    expect(answer.total).toBe(1);
  });
});
