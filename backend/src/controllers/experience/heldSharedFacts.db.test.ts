import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { publishUnderLock } from './publishController.js';
import { refuseUnderLock } from './declineHeldController.js';

/**
 * A fact two kinds' runs both propose is settled by one answer (#1599),
 * against PostgreSQL. The fixture is a made-up museum in Art Museums and
 * Archaeology, holding a made-up statue whose year both kinds' last runs
 * propose to change from 350 BC to AD 120, the Vatican Museums' Apollo
 * Belvedere in miniature. Deleted before and after.
 */

const MUSEUM = 9460;
const USER_UUID = '00000000-0000-4000-8000-000000009460';
const STATUE = 'Q9460-apollo';

let userId = 0;
const syncLogs: number[] = [];
const memberships: Record<'art' | 'archaeology', number> = { art: 0, archaeology: 0 };

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experience_curation_log WHERE experience_id = $1', [MUSEUM]);
  await pool.query('DELETE FROM experience_held_decisions WHERE experience_id = $1', [MUSEUM]);
  await pool.query('DELETE FROM experiences WHERE id = $1', [MUSEUM]);
  await pool.query('DELETE FROM treasures WHERE external_id = $1', [STATUE]);
  if (syncLogs.length > 0) await pool.query('DELETE FROM experience_sync_logs WHERE id = ANY($1::int[])', [syncLogs]);
  syncLogs.length = 0;
  await pool.query('DELETE FROM users WHERE uuid = $1', [USER_UUID]);
}

/** A run of `source` that held the statue's new year, and the place's own fields given. */
async function heldRun(source: number, placeFields: object[] = []): Promise<number> {
  const log = await pool.query<{ id: number }>(
    `INSERT INTO experience_sync_logs (source_id, status, completed_at) VALUES ($1, 'success', NOW()) RETURNING id`,
    [source],
  );
  const logId = log.rows[0].id;
  syncLogs.push(logId);
  const changed = [{
    item: { ref: STATUE, name: 'Apollo' },
    fields: [{ field: 'year', old: -350, new: 120, significance: 'minor', curatedConflict: false, held: true }],
  }];
  await pool.query(
    `INSERT INTO experience_sync_changes (sync_log_id, experience_id, external_id, change_type, changed_fields, contents)
     VALUES ($1, $2, 'Q-museum-9460', 'held', $3, $4)`,
    [logId, MUSEUM, JSON.stringify(placeFields),
      JSON.stringify({ treasures: { added: [], withdrawn: [], returned: [], changed } })],
  );
  await pool.query(
    'UPDATE experience_kind_memberships SET pending_change_sync_log_id = $3 WHERE experience_id = $1 AND source_id = $2',
    [MUSEUM, source, logId],
  );
  return logId;
}

const pointers = async () => (await pool.query<{ source_id: number; pending_change_sync_log_id: number | null }>(
  `SELECT source_id, pending_change_sync_log_id FROM experience_kind_memberships
    WHERE experience_id = $1 ORDER BY source_id`, [MUSEUM],
)).rows.map(row => row.pending_change_sync_log_id);

const typeOf = async (membership: number) => (await pool.query<{ type: string | null }>(
  'SELECT type FROM experience_kind_memberships WHERE id = $1', [membership],
)).rows[0].type;

const statueYear = async () =>
  (await pool.query<{ year: number }>('SELECT year FROM treasures WHERE external_id = $1', [STATUE])).rows[0].year;

const theYear = { kind: 'treasures' as const, ref: STATUE, name: 'Apollo', fields: ['year'] };

beforeEach(async () => {
  await clear();
  const user = await pool.query<{ id: number }>(
    `INSERT INTO users (uuid, display_name) VALUES ($1, 'A curator') RETURNING id`, [USER_UUID],
  );
  userId = user.rows[0].id;
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     VALUES ($1, 2, 'Q-museum-9460', 'Fixture Museum', ST_SetSRID(ST_MakePoint(12.45, 41.9), 4326))`,
    [MUSEUM],
  );
  for (const [key, source] of [['art', 2], ['archaeology', 5]] as const) {
    const row = await pool.query<{ id: number }>(
      `INSERT INTO experience_kind_memberships (experience_id, kind_id, source_id, external_id, admission, curation_state, published_at)
       SELECT $1, s.kind_id, s.id, 'Q-museum-9460', 'admitted', 'verified', NOW() FROM experience_sources s WHERE s.id = $2
       RETURNING id`,
      [MUSEUM, source],
    );
    memberships[key] = row.rows[0].id;
  }
  const statue = await pool.query<{ id: number }>(
    `INSERT INTO treasures (external_id, name, treasure_type, year, curation_state)
     VALUES ($1, 'Apollo', 'sculpture', -350, 'verified') RETURNING id`,
    [STATUE],
  );
  await pool.query(
    `INSERT INTO experience_treasures (experience_id, treasure_id, curation_state) VALUES ($1, $2, 'verified')`,
    [MUSEUM, statue.rows[0].id],
  );
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe('a fact two kinds\' runs both propose', () => {
  it('published under one kind, is written once and closes both proposals', async () => {
    const artLog = await heldRun(2);
    await heldRun(5);

    const { refusal } = await publishUnderLock(MUSEUM, userId, null, {
      heldParts: [theYear], expectedSyncLogId: artLog, membershipId: memberships.art,
    });

    expect(refusal).toBeUndefined();
    expect(await statueYear()).toBe(120);
    expect(await pointers()).toEqual([null, null]);
  });

  it('refused under one kind, closes both proposals and writes nothing', async () => {
    await heldRun(2);
    const archaeologyLog = await heldRun(5);

    const { refusal } = await refuseUnderLock(
      MUSEUM, userId, null, { parts: [theYear] }, archaeologyLog, memberships.archaeology,
    );

    expect(refusal).toBeUndefined();
    expect(await statueYear()).toBe(-350);
    expect(await pointers()).toEqual([null, null]);
  });

  it('leaves the other kind\'s proposal standing while it asks something of its own', async () => {
    const artLog = await heldRun(2);
    const archaeologyLog = await heldRun(5, [
      { field: 'subtitle', old: 'A museum.', new: 'A museum of finds.', significance: 'minor', held: true },
    ]);

    await publishUnderLock(MUSEUM, userId, null, {
      heldParts: [theYear], expectedSyncLogId: artLog, membershipId: memberships.art,
    });

    expect(await pointers()).toEqual([null, archaeologyLog]);
  });

  it('leaves the other kind\'s proposal of a type standing, since a type is the membership\'s', async () => {
    const type = { field: 'type', old: null, new: 'museum', significance: 'minor', held: true };
    const artLog = await heldRun(2, [type]);
    const archaeologyLog = await heldRun(5, [type]);

    await publishUnderLock(MUSEUM, userId, null, {
      heldFields: ['type'], heldParts: [theYear], expectedSyncLogId: artLog, membershipId: memberships.art,
    });

    expect(await pointers()).toEqual([null, archaeologyLog]);
    // Still asked of Archaeology, whose type nothing has written (ADR-0125, #1720)…
    expect(await typeOf(memberships.archaeology)).toBeNull();
    // …and answered there, it is written there.
    const { refusal } = await publishUnderLock(MUSEUM, userId, null, {
      heldFields: ['type'], expectedSyncLogId: archaeologyLog, membershipId: memberships.archaeology,
    });
    expect(refusal).toBeUndefined();
    expect(await typeOf(memberships.archaeology)).toBe('museum');
    expect(await pointers()).toEqual([null, null]);
  });

  it('leaves the other kind\'s type asked when one kind refuses the same value (#1720)', async () => {
    const type = { field: 'type', old: null, new: 'museum', significance: 'minor', held: true };
    const artLog = await heldRun(2, [type]);
    const archaeologyLog = await heldRun(5, [type]);

    await refuseUnderLock(MUSEUM, userId, null, { fields: ['type'], parts: [theYear] }, artLog, memberships.art);

    expect(await pointers()).toEqual([null, archaeologyLog]);
  });
});
