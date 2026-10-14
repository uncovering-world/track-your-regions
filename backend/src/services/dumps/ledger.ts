/**
 * The dump build ledger (`dump_builds`, ADR-0101 decision 3): a row opened
 * when a build starts and closed with its outcome, so every dump-derived table
 * can name the build it came from and an admin can see what was read when.
 */

import { pool } from '../../db/index.js';
import type { CheckValue, DumpBuildsRow } from '../../db/schema.generated.js';
import { hostname } from 'node:os';
import type { DumpFile } from './catalog.js';

/** A ledger row with its checked columns read as the vocabularies they are. */
export type DumpBuildRow = Omit<DumpBuildsRow, 'mode' | 'status' | 'checksum_kind'> & {
  mode: CheckValue<'dump_builds', 'mode'>;
  status: CheckValue<'dump_builds', 'status'>;
  checksum_kind: CheckValue<'dump_builds', 'checksum_kind'> | null;
};

/** How often a running build says it is alive (#1463). */
export const BEAT_EVERY_MS = 60_000;
/** How long a running build may go without beating before it counts as stopped. */
const ALIVE_FOR = "interval '5 minutes'";
/**
 * What this backend's builds are run by: its host name, which compose fixes
 * (`hostname:` on the backend service) so it stays the same across a restart
 * and a recreated container. A backend that starts knows by it the running rows
 * its previous run left from those of a script or another server.
 */
export const SERVER_RUNNER = `server:${hostname()}`;

/** A second running build of a dump, refused by the ledger's unique index. */
export class BuildAlreadyRunning extends Error {}

/**
 * Open a build's row. `runner` names what runs it: the backend passes
 * `SERVER_RUNNER`, and anything else (a script, even one run inside the
 * backend's container) its own name, or the backend's next start would close
 * a build that is still running.
 */
export async function openBuild(
  file: DumpFile, mode: DumpBuildRow['mode'], startedBy: number | null, runner: string,
): Promise<number> {
  const result = await pool.query<Pick<DumpBuildsRow, 'id'>>(
    `INSERT INTO dump_builds (dump, file_name, dump_date, url, mode, expected_bytes, checksum_kind, checksum_expected, started_by, heartbeat_at, runner)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), $10) RETURNING id`,
    [file.key, file.fileName, file.date, file.url, mode, file.expectedBytes,
      file.checksum?.kind ?? null, file.checksum?.value ?? null, startedBy, runner],
  ).catch((error: unknown) => {
    if ((error as { constraint?: string }).constraint === 'idx_dump_builds_one_running') {
      throw new BuildAlreadyRunning(`Another build of ${file.key} started first`);
    }
    throw error;
  });
  return result.rows[0].id;
}

export async function closeBuild(
  id: number,
  outcome: { status: Exclude<DumpBuildRow['status'], 'running'>; bytes: number; lines: number; checksumActual: string | null; error: string | null },
): Promise<void> {
  await pool.query(
    `UPDATE dump_builds SET status = $2, bytes = $3, lines = $4, checksum_actual = $5, error = $6, finished_at = NOW()
      WHERE id = $1`,
    [id, outcome.status, outcome.bytes, outcome.lines, outcome.checksumActual, outcome.error],
  );
}

/** The newest builds of each dump, for the admin panel. */
export async function recentBuilds(perDump = 3): Promise<DumpBuildRow[]> {
  const result = await pool.query<DumpBuildRow>(
    `SELECT * FROM (
       SELECT b.*, row_number() OVER (PARTITION BY b.dump ORDER BY b.started_at DESC, b.id DESC) AS rn
         FROM dump_builds b) ranked
      WHERE rn <= $1
      ORDER BY dump, started_at DESC, id DESC`,
    [perDump],
  );
  return result.rows;
}

/** Say the running build `id` is alive. */
export async function beat(id: number): Promise<void> {
  await pool.query('UPDATE dump_builds SET heartbeat_at = NOW() WHERE id = $1', [id]);
}

/**
 * Builds left running by a process that stopped: closed as failed, as
 * `closeOrphanedSyncLogs` closes a sync's. A row stopped when it has not
 * beaten for five minutes, or, given `runner`, at once when that runner left
 * it: a backend that starts passes its own (`SERVER_RUNNER`), since none of
 * its builds survived its restart. A build that still beats in another
 * process is left alone. Called at startup, when the panel lists the dumps,
 * and for one dump before a build of it starts.
 */
export async function closeOrphanedBuilds(options: { dump?: string; runner?: string } = {}): Promise<number> {
  const result = await pool.query(
    `UPDATE dump_builds SET status = 'failed', error = 'The build stopped: its process ended or restarted.', finished_at = NOW()
      WHERE status = 'running'
        AND (heartbeat_at IS NULL OR heartbeat_at < NOW() - ${ALIVE_FOR} OR runner = $2)
        AND ($1::text IS NULL OR dump = $1)`,
    [options.dump ?? null, options.runner ?? null],
  );
  return result.rowCount ?? 0;
}

export type LiveBuild = Pick<DumpBuildsRow, 'id' | 'started_at' | 'heartbeat_at' | 'file_name'>;

/** The build of `dump` running now in any process, judged by its heartbeat, or null. */
export async function liveBuildOf(dump: string): Promise<LiveBuild | null> {
  const result = await pool.query<LiveBuild>(
    `SELECT id, started_at, heartbeat_at, file_name FROM dump_builds
      WHERE dump = $1 AND status = 'running' AND heartbeat_at >= NOW() - ${ALIVE_FOR}
      ORDER BY started_at DESC LIMIT 1`,
    [dump],
  );
  return result.rows[0] ?? null;
}
