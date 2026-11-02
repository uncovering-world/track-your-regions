import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from './index.js';

/**
 * A changeset row records, per proposed value, the run that first proposed it
 * (ADR-0173, #2229), stamped on insert by stamp_first_asked(), executed against
 * PostgreSQL: the trigger reads the source's previous run for the place.
 *
 * The fixture is My Son Sanctuary as the Places of worship runs left it: a
 * Wikipedia article held since one run and proposed again by the next ones,
 * and a subtitle that stopped being proposed. Deleted before and after.
 */

const PLACE = 96231;
const logs: number[] = [];
let sourceId = 0;

async function run(): Promise<number> {
  const log = await pool.query<{ id: number }>(
    `INSERT INTO experience_sync_logs (source_id, status, completed_at) VALUES ($1, 'success', NOW()) RETURNING id`,
    [sourceId],
  );
  logs.push(log.rows[0].id);
  return log.rows[0].id;
}

const held = (field: string, value: unknown) => ({ field, old: null, new: value, significance: 'minor', curatedConflict: false, held: true });

async function propose(runId: number, fields: object[]): Promise<{ held_first_sync_log_id: number | null; first_asked: Record<string, Record<string, number>> | null }> {
  const row = await pool.query(
    `INSERT INTO experience_sync_changes (sync_log_id, experience_id, external_id, change_type, changed_fields)
     VALUES ($1, $2, 'Q1056', 'held', $3) RETURNING held_first_sync_log_id, first_asked`,
    [runId, PLACE, JSON.stringify(fields)],
  );
  return row.rows[0];
}

async function clear(): Promise<void> {
  await pool.query('DELETE FROM experiences WHERE id = $1', [PLACE]);
  if (logs.length > 0) await pool.query('DELETE FROM experience_sync_logs WHERE id = ANY($1::int[])', [logs]);
  logs.length = 0;
}

const ARTICLE = 'https://en.wikipedia.org/wiki/M%E1%BB%B9_S%C6%A1n';

beforeEach(async () => {
  await clear();
  const source = await pool.query<{ id: number }>(`SELECT id FROM experience_sources WHERE name = 'Places of worship'`);
  sourceId = source.rows[0].id;
  await pool.query(
    `INSERT INTO experiences (id, source_id, external_id, name, location)
     VALUES ($1, $2, 'Q1056', 'My Son Sanctuary', ST_SetSRID(ST_MakePoint(108.12, 15.76), 4326))`,
    [PLACE, sourceId],
  );
});

afterAll(async () => {
  await clear();
  await pool.end();
});

describe('the run that first asked', () => {
  it('keeps a value\'s first run while later runs propose it again, and a dropped field takes none with it', async () => {
    const first = await run();
    await propose(first, [held('metadata.wikipediaUrl', ARTICLE), held('subtitle', 'Cham temples')]);
    const second = await run();
    const again = await propose(second, [held('metadata.wikipediaUrl', ARTICLE)]);

    expect(again.first_asked).toEqual({ held: { 'f:metadata.wikipediaUrl': first } });
    expect(again.held_first_sync_log_id).toBe(first);
  });

  it('starts a new date where a run proposes a different value, or a new field beside an old one', async () => {
    const first = await run();
    await propose(first, [held('metadata.wikipediaUrl', ARTICLE)]);
    const second = await run();
    const changed = await propose(second, [held('metadata.wikipediaUrl', `${ARTICLE}_sanctuary`)]);
    expect(changed.held_first_sync_log_id).toBe(second);

    const third = await run();
    const added = await propose(third, [held('metadata.wikipediaUrl', `${ARTICLE}_sanctuary`), held('subtitle', 'Cham temples')]);
    // The newest question on the card is the subtitle, first asked now.
    expect(added.first_asked).toEqual({ held: { 'f:metadata.wikipediaUrl': second, 'f:subtitle': third } });
    expect(added.held_first_sync_log_id).toBe(third);
  });

  it('leaves a row that holds nothing unstamped', async () => {
    const first = await run();
    const row = await propose(first, [{ field: 'name', old: 'a', new: 'b', significance: 'minor', curatedConflict: false, held: false }]);
    expect(row).toEqual({ held_first_sync_log_id: null, first_asked: null });
  });
});
