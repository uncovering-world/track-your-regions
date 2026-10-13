/**
 * The dump build ledger (`dump_builds`, ADR-0101 decision 3): a row opened
 * when a build starts and closed with its outcome, so every dump-derived table
 * can name the build it came from and an admin can see what was read when.
 */

import { pool } from '../../db/index.js';
import type { CheckValue, DumpBuildsRow } from '../../db/schema.generated.js';
import type { DumpFile } from './catalog.js';

/** A ledger row with its checked columns read as the vocabularies they are. */
export type DumpBuildRow = Omit<DumpBuildsRow, 'mode' | 'status' | 'checksum_kind'> & {
  mode: CheckValue<'dump_builds', 'mode'>;
  status: CheckValue<'dump_builds', 'status'>;
  checksum_kind: CheckValue<'dump_builds', 'checksum_kind'> | null;
};

export async function openBuild(file: DumpFile, mode: DumpBuildRow['mode'], startedBy: number | null): Promise<number> {
  const result = await pool.query<Pick<DumpBuildsRow, 'id'>>(
    `INSERT INTO dump_builds (dump, file_name, dump_date, url, mode, expected_bytes, checksum_kind, checksum_expected, started_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [file.key, file.fileName, file.date, file.url, mode, file.expectedBytes,
      file.checksum?.kind ?? null, file.checksum?.value ?? null, startedBy],
  );
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

/** A build a restart stopped: closed as failed, as `closeOrphanedSyncLogs` closes a sync's. */
export async function closeOrphanedBuilds(): Promise<number> {
  const result = await pool.query(
    `UPDATE dump_builds SET status = 'failed', error = 'The server restarted during the build.', finished_at = NOW()
      WHERE status = 'running'`,
  );
  return result.rowCount ?? 0;
}
