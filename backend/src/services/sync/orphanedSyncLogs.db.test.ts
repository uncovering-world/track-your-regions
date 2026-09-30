import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { closeOrphanedSyncLogs } from './syncUtils.js';
import { ORPHANED_RUN_MARKER } from './syncLogMarkers.js';

/**
 * The startup sweep closes a run a dead process left `running` with how far it
 * got, and its source's last verdict with it (#1131), executed against
 * PostgreSQL: which rows the one statement closes and which sources it marks
 * is what only the real statement can say.
 *
 * Three sources, looked up by name, each with a run the restart killed:
 * - Art Museums: a real run 412 of 1,083 objects in, after a run that
 *   succeeded. Closed with its counts, and the source reads `failed`.
 * - Public Art & Monuments: a preview killed while still collecting. Closed,
 *   and the source keeps its own verdict, since a preview synced nothing.
 * - UNESCO World Heritage Sites: a killed run with a real run after it that
 *   closed. Closed, and the source keeps the newer run's verdict.
 *
 * The log ids are the spec's own, above any the sequence hands out here; the
 * sources' last-sync columns are read before and put back after.
 */

const MUSEUMS_DONE = 9740;
const MUSEUMS_KILLED = 9741;
const PUBLIC_ART_PREVIEW = 9742;
const UNESCO_KILLED = 9743;
const UNESCO_NEWER = 9744;
const LOG_IDS = [MUSEUMS_DONE, MUSEUMS_KILLED, PUBLIC_ART_PREVIEW, UNESCO_KILLED, UNESCO_NEWER];
const SOURCE_NAMES = ['Art Museums', 'Public Art & Monuments', 'UNESCO World Heritage Sites'];
const EARLIER = '2026-09-01T10:00:00Z';

interface SourceState {
  id: number;
  name: string;
  last_sync_at: Date | null;
  last_sync_status: string | null;
  last_sync_error: string | null;
}

interface LogState {
  status: string;
  completed_at: Date | null;
  error_details: unknown;
  phase: string | null;
  total_fetched: number;
  total_created: number;
  total_updated: number;
  progress_done: number | null;
}

let saved: SourceState[] = [];
const sourceId: Record<string, number> = {};

async function sources(): Promise<Record<string, SourceState>> {
  const { rows } = await pool.query<SourceState>(
    `SELECT id, name, last_sync_at, last_sync_status, last_sync_error
       FROM experience_sources WHERE name = ANY($1::text[])`,
    [SOURCE_NAMES],
  );
  return Object.fromEntries(rows.map(row => [row.name, row]));
}

async function logOf(id: number): Promise<LogState> {
  const { rows } = await pool.query<LogState>(
    `SELECT status, completed_at, error_details, phase, total_fetched, total_created,
            total_updated, progress_done
       FROM experience_sync_logs WHERE id = $1`,
    [id],
  );
  return rows[0];
}

async function clearLogs(): Promise<void> {
  await pool.query('DELETE FROM experience_sync_logs WHERE id = ANY($1::int[])', [LOG_IDS]);
}

beforeAll(async () => {
  await clearLogs();
  saved = Object.values(await sources());
  expect(saved).toHaveLength(3);
  for (const row of saved) sourceId[row.name] = row.id;

  // What each source said before the restart: its last run succeeded.
  await pool.query(
    `UPDATE experience_sources SET last_sync_at = $2, last_sync_status = 'success', last_sync_error = NULL
      WHERE id = ANY($1::int[])`,
    [saved.map(row => row.id), EARLIER],
  );
  await pool.query(
    `INSERT INTO experience_sync_logs
       (id, source_id, status, started_at, completed_at, is_dry_run, total_fetched, total_created,
        total_updated, phase, progress_done, progress_total, progress_at)
     VALUES
       ($1, $6, 'success', $9, $9, FALSE, 1083, 5, 2, 'processing', 1083, 1083, $9),
       ($2, $6, 'running', NOW(), NULL, FALSE, 0, 37, 12, 'processing', 412, 1083, NOW()),
       ($3, $7, 'running', NOW(), NULL, TRUE, 0, 0, 0, 'fetching', 0, NULL, NOW()),
       ($4, $8, 'running', NOW(), NULL, FALSE, 0, 3, 0, 'processing', 40, 1248, NOW()),
       ($5, $8, 'success', NOW(), NOW(), FALSE, 1248, 0, 0, 'processing', 1248, 1248, NOW())`,
    [MUSEUMS_DONE, MUSEUMS_KILLED, PUBLIC_ART_PREVIEW, UNESCO_KILLED, UNESCO_NEWER,
     sourceId['Art Museums'], sourceId['Public Art & Monuments'], sourceId['UNESCO World Heritage Sites'],
     EARLIER],
  );
});

afterAll(async () => {
  await clearLogs();
  for (const row of saved) {
    await pool.query(
      `UPDATE experience_sources SET last_sync_at = $2, last_sync_status = $3, last_sync_error = $4
        WHERE id = $1`,
      [row.id, row.last_sync_at, row.last_sync_status, row.last_sync_error],
    );
  }
  await pool.end();
});

describe('closeOrphanedSyncLogs', () => {
  it('closes every run left running, and names the sources whose verdict it changed', async () => {
    const answer = await closeOrphanedSyncLogs();

    // At least the spec's three: the lane's database may hold a running row of
    // its own, which the sweep closes just the same.
    expect(answer.closed).toBeGreaterThanOrEqual(3);
    expect(answer.sourcesMarked).toBeGreaterThanOrEqual(1);
    const { rows } = await pool.query(
      `SELECT id FROM experience_sync_logs WHERE id = ANY($1::int[]) AND status = 'running'`, [LOG_IDS],
    );
    expect(rows).toEqual([]);
  });

  it('keeps how far a killed run got, and closes it failed with the orphaned-run marker', async () => {
    const killed = await logOf(MUSEUMS_KILLED);

    expect(killed).toMatchObject({
      status: 'failed', phase: 'processing', total_fetched: 1083, total_created: 37, total_updated: 12,
      progress_done: 412, error_details: [ORPHANED_RUN_MARKER],
    });
    expect(killed.completed_at).not.toBeNull();
  });

  it('leaves a run that had closed as it was', async () => {
    expect(await logOf(MUSEUMS_DONE)).toMatchObject({
      status: 'success', total_fetched: 1083, total_created: 5, error_details: null,
    });
  });

  it('closes a preview killed while collecting with the total it had', async () => {
    expect(await logOf(PUBLIC_ART_PREVIEW)).toMatchObject({
      status: 'failed', phase: 'fetching', total_fetched: 0, error_details: [ORPHANED_RUN_MARKER],
    });
  });

  it('gives the source of a killed real run the verdict its row now carries', async () => {
    const [state, killed] = [(await sources())['Art Museums'], await logOf(MUSEUMS_KILLED)];

    expect(state.last_sync_status).toBe('failed');
    expect(state.last_sync_error).toBe('See sync log for details');
    expect(state.last_sync_at?.toISOString()).toBe(killed.completed_at?.toISOString());
  });

  it('leaves the source of a killed preview alone: a preview synced nothing', async () => {
    const state = (await sources())['Public Art & Monuments'];

    expect(state.last_sync_status).toBe('success');
    expect(state.last_sync_at?.toISOString()).toBe(new Date(EARLIER).toISOString());
  });

  it('leaves a source alone whose newer real run closed after the killed one', async () => {
    expect(await logOf(UNESCO_KILLED)).toMatchObject({ status: 'failed', total_fetched: 1248 });
    expect((await sources())['UNESCO World Heritage Sites'].last_sync_status).toBe('success');
  });
});
