import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../../db/index.js';
import { clearUnplacedExperiences, closeStoppedPlacements, readLatestSyncLog, readUnplacedExperiences } from './syncUtils.js';
import { ORPHANED_RUN_MARKER, PLACEMENT_FAILED_MARKER, PLACEMENT_STOPPED_MARKER } from './syncLogMarkers.js';

/**
 * What a run moved and did not place, on its log row (#1152), executed
 * against PostgreSQL: which closed runs the startup sweep marks as stopped
 * while placing, which sources it downgrades, and which rows the next run
 * takes over and empties, are what only the real statements can say.
 *
 * Three sources, looked up by name:
 * - Art Museums: a run whose placement failed on its own, one the orphan
 *   sweep closed, one that placed everything, a preview, and — newest — a
 *   successful run still naming two objects. Only the last is marked, and
 *   the source reads `partial`.
 * - Public Art & Monuments: a cancelled run still naming an object, marked
 *   and left cancelled, and a run still going in another process.
 * - UNESCO World Heritage Sites: a successful run still naming an object,
 *   marked, with a newer real run after it, so the source keeps its verdict.
 *
 * The log ids are the spec's own, above any the sequence hands out here; the
 * sources' last-sync columns are read before and put back after.
 */

const MUSEUMS_PLACEMENT_FAILED = 9750;
const MUSEUMS_ORPHANED = 9751;
const MUSEUMS_PLACED = 9752;
const MUSEUMS_PREVIEW = 9753;
const MUSEUMS_STOPPED = 9754;
const PUBLIC_ART_CANCELLED = 9755;
const UNESCO_STOPPED = 9756;
const UNESCO_NEWER = 9757;
const PUBLIC_ART_RUNNING = 9758;
const LOG_IDS = [
  MUSEUMS_PLACEMENT_FAILED, MUSEUMS_ORPHANED, MUSEUMS_PLACED, MUSEUMS_PREVIEW, MUSEUMS_STOPPED,
  PUBLIC_ART_CANCELLED, UNESCO_STOPPED, UNESCO_NEWER, PUBLIC_ART_RUNNING,
];
const AFTER_FIXTURE = 9759;
const SOURCE_NAMES = ['Art Museums', 'Public Art & Monuments', 'UNESCO World Heritage Sites'];
const EARLIER = '2026-09-01T10:00:00Z';
const PLACEMENT_FAILED = { ...PLACEMENT_FAILED_MARKER, error: 'Region assignment failed after the run closed: world view 5: boom' };
const CANCELLED_NOTE = { externalId: 'system', error: 'Sync cancelled' };

interface SourceState {
  id: number;
  name: string;
  last_sync_at: Date | null;
  last_sync_status: string | null;
  last_sync_error: string | null;
}

interface LogState {
  status: string;
  error_details: unknown;
  unplaced_experience_ids: number[] | null;
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
    'SELECT status, error_details, unplaced_experience_ids FROM experience_sync_logs WHERE id = $1',
    [id],
  );
  return rows[0];
}

async function clearLogs(): Promise<void> {
  await pool.query('DELETE FROM experience_sync_logs WHERE id = ANY($1::int[])', [LOG_IDS]);
}

/** The fixture's own rows among what a read answers, so a row of the lane's own never counts. */
const ours = (logIds: number[]) => logIds.filter(id => LOG_IDS.includes(id));

beforeAll(async () => {
  await clearLogs();
  saved = Object.values(await sources());
  expect(saved).toHaveLength(3);
  for (const row of saved) sourceId[row.name] = row.id;

  await pool.query(
    `UPDATE experience_sources SET last_sync_at = $2, last_sync_status = 'success', last_sync_error = NULL
      WHERE id = ANY($1::int[])`,
    [saved.map(row => row.id), EARLIER],
  );
  const museums = sourceId['Art Museums'];
  const publicArt = sourceId['Public Art & Monuments'];
  const unesco = sourceId['UNESCO World Heritage Sites'];
  const rows: [number, number, string, boolean, unknown, number[]][] = [
    [MUSEUMS_PLACEMENT_FAILED, museums, 'partial', false, [PLACEMENT_FAILED], [103]],
    [MUSEUMS_ORPHANED, museums, 'failed', false, [ORPHANED_RUN_MARKER], [104]],
    [MUSEUMS_PLACED, museums, 'success', false, null, []],
    [MUSEUMS_PREVIEW, museums, 'success', true, null, [105]],
    [MUSEUMS_STOPPED, museums, 'success', false, null, [101, 102]],
    [PUBLIC_ART_CANCELLED, publicArt, 'cancelled', false, [CANCELLED_NOTE], [201]],
    [UNESCO_STOPPED, unesco, 'success', false, null, [301]],
    [UNESCO_NEWER, unesco, 'success', false, null, []],
    [PUBLIC_ART_RUNNING, publicArt, 'running', false, null, [202]],
  ];
  for (const [id, source, status, dryRun, details, unplaced] of rows) {
    await pool.query(
      `INSERT INTO experience_sync_logs
         (id, source_id, status, started_at, completed_at, is_dry_run, error_details, unplaced_experience_ids)
       VALUES ($1, $2, $3::varchar, NOW(), CASE WHEN $3::varchar = 'running' THEN NULL ELSE NOW() END,
               $4, $5, $6::int[])`,
      [id, source, status, dryRun, details === null ? null : JSON.stringify(details), unplaced],
    );
  }
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

describe('closeStoppedPlacements', () => {
  it('marks the closed runs still naming what they moved, and the sources whose verdict it changed', async () => {
    const answer = await closeStoppedPlacements();

    // At least the spec's three, and the Art Museums source at least: the
    // lane's database may hold rows of its own, which the sweep reads the same.
    expect(answer.marked).toBeGreaterThanOrEqual(3);
    expect(answer.sourcesMarked).toBeGreaterThanOrEqual(1);
  });

  it('downgrades a successful run to partial, with the marker, and keeps what it names', async () => {
    expect(await logOf(MUSEUMS_STOPPED)).toEqual({
      status: 'partial', error_details: [PLACEMENT_STOPPED_MARKER], unplaced_experience_ids: [101, 102],
    });
    expect((await sources())['Art Museums']).toMatchObject({ last_sync_status: 'partial', last_sync_error: null });
  });

  it('keeps a cancelled run cancelled, and adds the marker after what it already said', async () => {
    expect(await logOf(PUBLIC_ART_CANCELLED)).toMatchObject({
      status: 'cancelled', error_details: [CANCELLED_NOTE, PLACEMENT_STOPPED_MARKER],
    });
    expect((await sources())['Public Art & Monuments'].last_sync_status).toBe('success');
  });

  it('leaves a source alone whose newer real run closed after the stopped one', async () => {
    expect(await logOf(UNESCO_STOPPED)).toMatchObject({ status: 'partial', error_details: [PLACEMENT_STOPPED_MARKER] });
    expect((await sources())['UNESCO World Heritage Sites'].last_sync_status).toBe('success');
  });

  it('leaves alone a failed placement, an orphaned run, a preview, a placed run and a running one', async () => {
    expect(await logOf(MUSEUMS_PLACEMENT_FAILED)).toMatchObject({ status: 'partial', error_details: [PLACEMENT_FAILED] });
    expect(await logOf(MUSEUMS_ORPHANED)).toMatchObject({ status: 'failed', error_details: [ORPHANED_RUN_MARKER] });
    expect(await logOf(MUSEUMS_PREVIEW)).toMatchObject({ status: 'success', error_details: null });
    expect(await logOf(MUSEUMS_PLACED)).toMatchObject({ status: 'success', error_details: null });
    expect(await logOf(PUBLIC_ART_RUNNING)).toMatchObject({ status: 'running', error_details: null });
  });

  it('marks nothing twice when it runs again', async () => {
    await closeStoppedPlacements();

    const { rows } = await pool.query<{ id: number }>(
      `SELECT id FROM experience_sync_logs
        WHERE id = ANY($1::int[]) AND jsonb_array_length(error_details) > 1 AND status <> 'cancelled'`,
      [LOG_IDS],
    );
    expect(rows).toEqual([]);
    expect(await logOf(PUBLIC_ART_CANCELLED)).toMatchObject({
      error_details: [CANCELLED_NOTE, PLACEMENT_STOPPED_MARKER],
    });
  });
});

describe('what the card counts as waiting', () => {
  it('counts what every closed real run of the source names, not the newest row alone', async () => {
    // UNESCO's newest run names nothing; the stopped one before it names 301,
    // which is what the next real run takes over — a later run (or a preview)
    // must not hide it from the card.
    const latest = await readLatestSyncLog(sourceId['UNESCO World Heritage Sites']);

    expect(latest?.id).toBe(UNESCO_NEWER);
    expect(latest?.unplaced).toBe(1);
  });
});

describe('what the next run takes over', () => {
  it('reads every closed real run before its own that still names objects, however it closed', async () => {
    const museums = await readUnplacedExperiences(sourceId['Art Museums'], AFTER_FIXTURE);

    expect(ours(museums.logIds)).toEqual([MUSEUMS_PLACEMENT_FAILED, MUSEUMS_ORPHANED, MUSEUMS_STOPPED]);
    expect(museums.experienceIds).toEqual(expect.arrayContaining([101, 102, 103, 104]));
    expect(museums.experienceIds).not.toContain(105);
  });

  it('reads only the runs before its own, and not a run still going', async () => {
    const museums = await readUnplacedExperiences(sourceId['Art Museums'], MUSEUMS_STOPPED);
    const publicArt = await readUnplacedExperiences(sourceId['Public Art & Monuments'], AFTER_FIXTURE);

    expect(ours(museums.logIds)).toEqual([MUSEUMS_PLACEMENT_FAILED, MUSEUMS_ORPHANED]);
    expect(ours(publicArt.logIds)).toEqual([PUBLIC_ART_CANCELLED]);
    expect(publicArt.experienceIds).not.toContain(202);
  });

  it('empties the lists of the runs named, and only theirs', async () => {
    const cleared = await clearUnplacedExperiences([MUSEUMS_PLACEMENT_FAILED, MUSEUMS_STOPPED, MUSEUMS_PLACED]);

    // The placed run named nothing, so it is not counted as changed.
    expect(cleared).toBe(2);
    expect((await logOf(MUSEUMS_STOPPED)).unplaced_experience_ids).toEqual([]);
    expect((await logOf(MUSEUMS_PLACEMENT_FAILED)).unplaced_experience_ids).toEqual([]);
    expect((await logOf(MUSEUMS_ORPHANED)).unplaced_experience_ids).toEqual([104]);
  });
});
