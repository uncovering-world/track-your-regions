/**
 * Migration 235's fold of the point visits and its clean-up of the rows the
 * old cascade wrote on a whole (#2120, ADR-0199), executed against PostgreSQL.
 *
 * A tick on a part used to write a visit on its whole as well. The migration
 * removes such a row, chosen on the rows as the old code left them: beside the
 * traveller's visit on a direct part, with no note or rating and no point
 * visit of theirs on the whole, and only where the site reads that part's
 * visit. A tick on a point the whole holds as its own lands on the whole's
 * row and keeps it.
 *
 * The migration is read from the repository and run as `db:migrate` runs it,
 * without its own BEGIN and COMMIT, inside a transaction the spec rolls back,
 * with the old point visits table made for it: the shared database is left as
 * it was. Ids are the fixture's own.
 */
import { readFileSync } from 'node:fs';
import type { PoolClient } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { pool } from './index.js';
import { repoFile } from '../testSupport/repoFile.js';

const SITE = 9445;
const PART_A = 9446;
const PART_B = 9447;
/** A part whose one point the source withdrew: no visit on it counts for the site. */
const PART_GONE = 9448;
const TRAVELLERS = ['00000000-0000-4000-8000-000000009445', '00000000-0000-4000-8000-000000009446',
  '00000000-0000-4000-8000-000000009447', '00000000-0000-4000-8000-000000009448',
  '00000000-0000-4000-8000-000000009449'];

const MIGRATION = readFileSync(repoFile('db', 'migrations', '235-a-visit-is-one-row-on-the-place-ticked.sql'), 'utf8')
  .replace(/^\\set .*$/m, '')
  .replace(/^BEGIN;$/m, '')
  .replace(/^COMMIT;$/m, '');

afterAll(async () => {
  await pool.end();
});

async function place(client: PoolClient, id: number, lon: number): Promise<number> {
  await client.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     SELECT $1, s.id, $2, $3, ST_SetSRID(ST_MakePoint($4, 41.1), 4326) FROM experience_sources s WHERE s.name = 'Art Museums'`,
    [id, `Q${id}001`, `Fold fixture ${id}`, lon],
  );
  const point = await client.query<{ id: number }>(
    `INSERT INTO experience_locations (experience_id, name, ordinal, location, curation_state)
     VALUES ($1, 'fixture point', 1, ST_SetSRID(ST_MakePoint($2, 41.1), 4326), 'auto') RETURNING id`,
    [id, lon],
  );
  return point.rows[0].id;
}

describe("migration 235 on the old cascade's rows on a whole", () => {
  it("removes the cascade's row and keeps the rows a traveller made", async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `CREATE TABLE IF NOT EXISTS user_visited_locations (
           id SERIAL PRIMARY KEY,
           user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
           location_id INTEGER NOT NULL REFERENCES experience_locations(id) ON DELETE CASCADE,
           visited_at TIMESTAMPTZ DEFAULT NOW(),
           notes TEXT,
           UNIQUE(user_id, location_id))`,
      );
      // A site with a point of its own, standing for the whole site, and two parts.
      const sitePoint = await place(client, SITE, 44.70);
      await place(client, PART_A, 44.71);
      await place(client, PART_B, 44.72);
      const gonePoint = await place(client, PART_GONE, 44.73);
      await client.query('UPDATE experience_locations SET missing_since = NOW() WHERE id = $1', [gonePoint]);
      await client.query(
        `INSERT INTO experience_parts (whole_id, part_id, reason)
         VALUES ($1, $2, 'curator'), ($1, $3, 'curator'), ($1, $4, 'curator')`,
        [SITE, PART_A, PART_B, PART_GONE],
      );
      const users = (await client.query<{ id: number }>(
        `INSERT INTO users (uuid, display_name, role) SELECT u, 'A traveller', 'user' FROM unnest($1::text[]) AS u
         RETURNING id`, [TRAVELLERS],
      )).rows.map(row => row.id);
      const [cascaded, ownPoint, noted, wholeOnly, besideGone] = users;
      const visit = (user: number, placeId: number, notes: string | null = null) => client.query(
        'INSERT INTO user_visited_experiences (user_id, experience_id, notes) VALUES ($1, $2, $3)', [user, placeId, notes],
      );
      // The cascade's row: a part ticked, and the site's row written with it.
      await visit(cascaded, PART_A);
      await visit(cascaded, SITE);
      // A tick on the site's own point and on a part, the site's row written by both.
      await visit(ownPoint, PART_B);
      await visit(ownPoint, SITE);
      await client.query('INSERT INTO user_visited_locations (user_id, location_id) VALUES ($1, $2)', [ownPoint, sitePoint]);
      // A note a person wrote on the site's row.
      await visit(noted, PART_A);
      await visit(noted, SITE, 'The bridge at dusk');
      // The site ticked itself, no part visited.
      await visit(wholeOnly, SITE);
      // The site's row beside a visit on a part the site no longer shows: the
      // site would read unvisited without it.
      await visit(besideGone, PART_GONE);
      await visit(besideGone, SITE);

      await client.query(MIGRATION);

      const held = await client.query<{ user_id: number; experience_id: number }>(
        `SELECT user_id, experience_id FROM user_visited_experiences
          WHERE user_id = ANY($1::int[]) AND experience_id = $2 ORDER BY user_id`, [users, SITE],
      );
      expect(held.rows.map(row => row.user_id)).toEqual([ownPoint, noted, wholeOnly, besideGone]);
      expect((await client.query(`SELECT to_regclass('public.user_visited_locations') AS t`)).rows[0].t).toBeNull();
    } finally {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
  });
});
