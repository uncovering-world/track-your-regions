import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { websitesOfPlace } from './websiteChecksController.js';

/**
 * Which websites a review card about a place shows, and so which the website
 * check asks about (#2165), against PostgreSQL. The fixture is a made-up place
 * in Places of worship and Archaeology, as a church both kinds hold: its own
 * website, a held proposal of a new one, a conflict over the curator's claimed
 * website, and later change sets the conflict card does not read — a dry run
 * proposing yet another website, and Archaeology's run proposing a name.
 * Deleted before and after.
 */

const PLACE = 9465;
const syncLogs: number[] = [];
const memberships: Record<'worship' | 'archaeology', number> = { worship: 0, archaeology: 0 };

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id = $1', [PLACE]);
  if (syncLogs.length > 0) await pool.query('DELETE FROM experience_sync_logs WHERE id = ANY($1::int[])', [syncLogs]);
  syncLogs.length = 0;
}

/** A run of `source` that recorded `fields` for the place, and its log's id. */
async function changeSet(source: number, fields: object[], { dryRun = false, changeType = 'updated' } = {}): Promise<number> {
  const log = await pool.query<{ id: number }>(
    `INSERT INTO experience_sync_logs (source_id, status, completed_at, is_dry_run) VALUES ($1, 'success', NOW(), $2) RETURNING id`,
    [source, dryRun],
  );
  const logId = log.rows[0].id;
  syncLogs.push(logId);
  await pool.query(
    `INSERT INTO experience_sync_changes (sync_log_id, experience_id, external_id, change_type, changed_fields)
     VALUES ($1, $2, 'Q-church-9465', $3, $4)`,
    [logId, PLACE, changeType, JSON.stringify(fields)],
  );
  return logId;
}

beforeEach(async () => {
  await clear();
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location, metadata)
     VALUES ($1, 4, 'Q-church-9465', 'Fixture Church', ST_SetSRID(ST_MakePoint(12.47, 41.9), 4326),
             '{"website": "https://church.example/"}')`,
    [PLACE],
  );
  for (const [key, source] of [['worship', 4], ['archaeology', 5]] as const) {
    const row = await pool.query<{ id: number }>(
      `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, admission, curation_state, published_at)
       SELECT $1, s.kind_id, s.id, 'Q-church-9465', 'admitted', 'verified', NOW() FROM experience_sources s WHERE s.id = $2
       RETURNING id`,
      [PLACE, source],
    );
    memberships[key] = row.rows[0].id;
  }
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe("the websites a place's review card shows (#2165)", () => {
  it("reads the place's own and a held proposal's", async () => {
    const held = await changeSet(4, [{ field: 'metadata.website', new: 'https://church.example/new/', held: true }], { changeType: 'held' });
    await pool.query('UPDATE experience_kind_memberships SET pending_change_sync_log_id = $2 WHERE id = $1', [memberships.worship, held]);

    expect(await websitesOfPlace(PLACE)).toEqual(['https://church.example/', 'https://church.example/new/']);
  });

  it('reads the change set the conflict card reads, past later ones it does not', async () => {
    await changeSet(4, [{ field: 'metadata.website', new: 'https://conflict.example/', curatedConflict: true }], { changeType: 'conflict' });
    // Newer, and not what the conflict card shows: a dry run, and another kind's run.
    await changeSet(4, [{ field: 'metadata.website', new: 'https://dry-run.example/', curatedConflict: true }], { dryRun: true, changeType: 'conflict' });
    await changeSet(5, [{ field: 'name', new: 'Fixture Basilica' }]);

    expect(await websitesOfPlace(PLACE)).toEqual(['https://church.example/', 'https://conflict.example/']);
  });

  it('reads no website a change set removes, and the place alone where nothing is proposed', async () => {
    await changeSet(4, [{ field: 'metadata.website', new: null, curatedConflict: true }], { changeType: 'conflict' });

    expect(await websitesOfPlace(PLACE)).toEqual(['https://church.example/']);
  });
});
