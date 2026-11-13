/**
 * Migration 242's removal of the copies a World Heritage run left of a list
 * line (#2119), executed against PostgreSQL.
 *
 * The fixture is the Danube Limes' Bad Gögging as the runs of October 2026
 * left it: the part a reader is shown, and beside it, under the same
 * reference and at the same spot, a part whose one point arrived pending and
 * was withdrawn before anyone published it. The copy goes; so do its record,
 * its relation and its point. Places of the same look that a person made or
 * sees something of stay: one a traveller ticked, one whose point was
 * published, one that holds a kind, one with no twin standing, one whose
 * point a person placed in a region by hand, and one that another place's
 * record names as its whole. The file names the copies it leaves in a notice.
 *
 * The migration is read from the repository and run as `db:migrate` runs it,
 * without its own BEGIN and COMMIT, inside a transaction the spec rolls back:
 * the shared database is left as it was. Ids are the fixture's own.
 */
import { readFileSync } from 'node:fs';
import type { PoolClient } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { pool } from './index.js';
import { repoFile } from '../testSupport/repoFile.js';

const SITE = 9670;
const PART = 9671;
const COPY = 9672;
const VISITED_COPY = 9673;
const PUBLISHED_COPY = 9674;
const ALONE = 9675;
const KINDED_COPY = 9676;
const PLACED_COPY = 9677;
const WHOLE_COPY = 9678;
const PART_OF_COPY = 9679;
const PLACES = [
  SITE, PART, COPY, VISITED_COPY, PUBLISHED_COPY, ALONE, KINDED_COPY, PLACED_COPY, WHOLE_COPY, PART_OF_COPY,
];
const REFERENCE = '9670-001';
const TRAVELLER = '00000000-0000-4000-8000-000000009670';
const COMPONENTS_SOURCE = 10;

const MIGRATION = readFileSync(repoFile('db', 'migrations', '242-a-line-read-twice-leaves-no-part-behind.sql'), 'utf8')
  .replace(/^\\set .*$/m, '')
  .replace(/^BEGIN;$/m, '')
  .replace(/^COMMIT;$/m, '');

afterAll(async () => {
  await pool.end();
});

/** A place with one point at Bad Gögging, in the state given. */
async function place(client: PoolClient, id: number, point: { state: 'pending' | 'auto'; withdrawn: boolean }) {
  await client.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     SELECT $1, s.id, $2, 'Bad Gögging (copy fixture)', ST_SetSRID(ST_MakePoint(11.7813, 48.8259), 4326)
       FROM experience_sources s WHERE s.name = 'UNESCO World Heritage Sites'`,
    [id, `part:${id}`],
  );
  await client.query(
    `INSERT INTO experience_locations (experience_id, name, external_ref, location, curation_state, missing_since)
     VALUES ($1, 'Bad Gögging (copy fixture)', $2, ST_SetSRID(ST_MakePoint(11.7813, 48.8259), 4326), $3,
             CASE WHEN $4 THEN NOW() END)`,
    [id, REFERENCE, point.state, point.withdrawn],
  );
}

async function partOfSite(client: PoolClient, id: number, reference = REFERENCE): Promise<void> {
  await client.query(
    'INSERT INTO source_records (experience_id, whole_id, source_id, external_id) VALUES ($1, $2, $3, $4)',
    [id, SITE, COMPONENTS_SOURCE, reference],
  );
}

describe('migration 242 on the copies of a list line', () => {
  it('removes a copy nobody was shown and keeps every place of its look a person made or sees something of', async () => {
    const client = await pool.connect();
    const notices: string[] = [];
    const onNotice = (notice: { message?: string }) => { notices.push(notice.message ?? ''); };
    client.on('notice', onNotice);
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO experiences (id, source_id, external_id, name, location)
         SELECT $1, s.id, '9670', 'Danube Limes (copy fixture)', ST_SetSRID(ST_MakePoint(11.8, 48.8), 4326)
           FROM experience_sources s WHERE s.name = 'UNESCO World Heritage Sites'`,
        [SITE],
      );
      await client.query(
        `INSERT INTO source_records (experience_id, kind_id, source_id, external_id, curation_state, published_at)
         SELECT $1, s.kind_id, s.id, '9670', 'auto', NOW() FROM experience_sources s WHERE s.name = 'UNESCO World Heritage Sites'`,
        [SITE],
      );
      await place(client, PART, { state: 'auto', withdrawn: false });
      await place(client, COPY, { state: 'pending', withdrawn: true });
      await place(client, VISITED_COPY, { state: 'pending', withdrawn: true });
      await place(client, PUBLISHED_COPY, { state: 'auto', withdrawn: true });
      await place(client, ALONE, { state: 'pending', withdrawn: true });
      await place(client, KINDED_COPY, { state: 'pending', withdrawn: true });
      await place(client, PLACED_COPY, { state: 'pending', withdrawn: true });
      await place(client, WHOLE_COPY, { state: 'pending', withdrawn: true });
      await place(client, PART_OF_COPY, { state: 'pending', withdrawn: true });
      for (const id of [PART, COPY, VISITED_COPY, PUBLISHED_COPY, KINDED_COPY, PLACED_COPY, WHOLE_COPY]) {
        await partOfSite(client, id);
      }
      await partOfSite(client, ALONE, '9670-002');
      await client.query(
        `INSERT INTO source_records (experience_id, kind_id, source_id, external_id, curation_state)
         SELECT $1, s.kind_id, s.id, 'Q9676001', 'pending' FROM experience_sources s WHERE s.name = 'Archaeology'`,
        [KINDED_COPY],
      );
      const traveller = (await client.query<{ id: number }>(
        `INSERT INTO users (uuid, display_name, role) VALUES ($1, 'A traveller', 'user') RETURNING id`, [TRAVELLER],
      )).rows[0].id;
      await client.query('INSERT INTO user_visited_experiences (user_id, experience_id) VALUES ($1, $2)', [traveller, VISITED_COPY]);
      // A person placed the withdrawn point in a region by hand.
      const region = (await client.query<{ id: number }>(
        `INSERT INTO regions (world_view_id, name) SELECT id, 'Kelheim (copy fixture)' FROM world_views ORDER BY id LIMIT 1
         RETURNING id`,
      )).rows[0].id;
      await client.query(
        `INSERT INTO experience_location_regions (location_id, region_id, assignment_type)
         SELECT id, $2, 'manual' FROM experience_locations WHERE experience_id = $1`,
        [PLACED_COPY, region],
      );
      // Another place is a part of the copy: its record names the copy as its whole.
      await client.query(
        'INSERT INTO source_records (experience_id, whole_id, source_id, external_id) VALUES ($1, $2, $3, $4)',
        [PART_OF_COPY, WHOLE_COPY, COMPONENTS_SOURCE, '9670-003'],
      );
      const heldOn = async () => (await client.query(
        `SELECT (SELECT count(*)::int FROM experience_location_regions elr
                   JOIN experience_locations el ON el.id = elr.location_id
                  WHERE el.experience_id = $1 AND elr.assignment_type = 'manual') AS manual_rows,
                (SELECT count(*)::int FROM source_records WHERE experience_id = $3 AND whole_id = $2) AS part_records,
                (SELECT count(*)::int FROM experience_parts WHERE part_id = $3 AND whole_id = $2) AS part_relations`,
        [PLACED_COPY, WHOLE_COPY, PART_OF_COPY],
      )).rows[0];
      expect(await heldOn()).toEqual({ manual_rows: 1, part_records: 1, part_relations: 1 });

      const referenceHeldBy = async () => (await client.query<{ experience_id: number; identifies: boolean }>(
        `SELECT experience_id, identifies FROM place_identifiers WHERE scheme = 'whc' AND value = $1 ORDER BY experience_id`,
        [REFERENCE],
      )).rows;
      // Before: seven places carry the reference, so it identifies none of them.
      expect((await referenceHeldBy()).filter(row => row.identifies)).toEqual([]);

      await client.query(MIGRATION);

      const standing = (await client.query<{ id: number }>(
        'SELECT id FROM experiences WHERE id = ANY($1::int[]) ORDER BY id', [PLACES],
      )).rows.map(row => row.id);
      expect(standing).toEqual(PLACES.filter(id => id !== COPY));
      const ofCopy = await client.query(
        `SELECT (SELECT count(*)::int FROM source_records WHERE experience_id = $1) AS records,
                (SELECT count(*)::int FROM experience_parts WHERE part_id = $1) AS parts,
                (SELECT count(*)::int FROM experience_locations WHERE experience_id = $1) AS points`,
        [COPY],
      );
      expect(ofCopy.rows[0]).toEqual({ records: 0, parts: 0, points: 0 });
      const parts = (await client.query<{ part_id: number }>(
        'SELECT part_id FROM experience_parts WHERE whole_id = $1 ORDER BY part_id', [SITE],
      )).rows.map(row => row.part_id);
      expect(parts).toEqual([PART, VISITED_COPY, PUBLISHED_COPY, ALONE, KINDED_COPY, PLACED_COPY, WHOLE_COPY]);
      // The places kept still carry the reference, so it identifies none: one copy fewer is all that changed.
      expect((await referenceHeldBy()).map(row => row.experience_id)).toEqual(
        [PART, VISITED_COPY, PUBLISHED_COPY, KINDED_COPY, PLACED_COPY, WHOLE_COPY],
      );
      // The hand-placed row and the copy's own part are kept with the copies they hang on.
      expect(await heldOn()).toEqual({ manual_rows: 1, part_records: 1, part_relations: 1 });
      // The copies of the right shape that something holds are named, not passed over in silence.
      const leaving = notices.find(message => message.startsWith('Leaving '));
      const named = (leaving?.match(/\{([\d,]*)\}$/)?.[1] ?? '').split(',').filter(Boolean).map(Number);
      expect(named.filter(id => PLACES.includes(id))).toEqual([VISITED_COPY, PLACED_COPY, WHOLE_COPY]);

      // Run again, it finds nothing left to remove.
      await client.query(MIGRATION);
      expect((await client.query('SELECT 1 FROM experiences WHERE id = ANY($1::int[])', [PLACES])).rowCount)
        .toBe(PLACES.length - 1);
    } finally {
      await client.query('ROLLBACK');
      client.removeListener('notice', onNotice);
      client.release();
    }
  });

  it("gives the part its reference back once its only copy is gone", async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO experiences (id, source_id, external_id, name, location)
         SELECT $1, s.id, '9670', 'Danube Limes (copy fixture)', ST_SetSRID(ST_MakePoint(11.8, 48.8), 4326)
           FROM experience_sources s WHERE s.name = 'UNESCO World Heritage Sites'`,
        [SITE],
      );
      await place(client, PART, { state: 'auto', withdrawn: false });
      await place(client, COPY, { state: 'pending', withdrawn: true });
      await partOfSite(client, PART);
      await partOfSite(client, COPY);
      const held = async () => (await client.query<{ row: string }>(
        `SELECT experience_id || ':' || CASE WHEN identifies THEN 'identifies' ELSE 'refers' END AS row
           FROM place_identifiers WHERE scheme = 'whc' AND value = $1 ORDER BY experience_id`, [REFERENCE],
      )).rows.map(row => row.row);
      expect(await held()).toEqual([`${PART}:refers`, `${COPY}:refers`]);

      await client.query(MIGRATION);

      expect(await held()).toEqual([`${PART}:identifies`]);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
