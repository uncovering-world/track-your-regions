/**
 * The dump build ledger (`dump_builds`, ADR-0101 decision 3, ADR-0106): a row
 * queued when an admin asks for a build, taken and run by the dump worker,
 * and closed with its outcome, so every dump-derived table can name the build
 * it came from and an admin can see what was read when. The row is also how
 * the backend and the worker talk: what was asked for, the running build's
 * progress and heartbeat, and an admin's cancel.
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

/**
 * What a build does: `verify` reads and counts; `keep` runs the dump's
 * builder and keeps what it builds; `rederive` derives the kept build's
 * tables again from what it holds, reading no file (#1526); `sample` cuts a
 * sample of the local copy, and `trial` runs the builder on that sample and
 * keeps nothing (#1527).
 */
export type BuildKind = 'verify' | 'keep' | 'rederive' | 'sample' | 'trial';

/** What an admin asked for, which the worker reads when it takes the build. */
export interface BuildRequestRecord {
  kind: BuildKind;
  /** The local file to read: the local copy, or the sample a trial reads; absent, the newest file the host lists. */
  only?: string;
}

/** What the panel shows of a running build, written with each heartbeat. */
export interface BuildProgressRecord {
  /** Finding the file, reading it, or deriving from what is kept (a `rederive`, which reads none). */
  phase: 'resolving' | 'reading' | 'deriving';
  message: string;
  downloaded: number;
  read: number;
  lines: number;
  /** Seconds the step has left at its pace so far, for a step that reads a file (`PassClock`); null while there is no telling. */
  etaSeconds: number | null;
  /** What the step's `read` is measured against: the dump's file in a pass, the terms spool while labelling, the sample's size while cutting one; null in a step with no measure (#1519). */
  total?: number | null;
  /** When the step running now started, so a step with no measure of its own still reads as alive (#1519). */
  stepStartedAt?: string | null;
}

/** How often a running build says it is alive and how far it got (#1463, #1467). */
export const BEAT_EVERY_MS = 5_000;
/** How long a running build may go without beating before it counts as stopped. */
const ALIVE_FOR = "interval '5 minutes'";

/** A second queued or running build of a dump, refused by the ledger's unique index. */
export class BuildAlreadyRunning extends Error {}

const refuseSecond = (dump: string) => (error: unknown) => {
  if ((error as { constraint?: string }).constraint === 'idx_dump_builds_one_active') {
    throw new BuildAlreadyRunning(`A build of ${dump} is already queued or running`);
  }
  throw error;
};

/** Queue a build of `dump` for the worker; refuses a second one of the same dump. */
export async function enqueueBuild(
  dump: string, mode: DumpBuildRow['mode'], request: BuildRequestRecord, startedBy: number | null,
): Promise<number> {
  const result = await pool.query<Pick<DumpBuildsRow, 'id'>>(
    `INSERT INTO dump_builds (dump, mode, status, request, started_by) VALUES ($1, $2, 'queued', $3, $4) RETURNING id`,
    [dump, mode, JSON.stringify(request), startedBy],
  ).catch(refuseSecond(dump));
  return result.rows[0].id;
}

export interface ClaimedBuild {
  id: number;
  dump: string;
  request: BuildRequestRecord;
}

/** Take the oldest queued build for `runner`, or none; two workers never take the same one. */
export async function claimNextBuild(runner: string): Promise<ClaimedBuild | null> {
  const result = await pool.query<ClaimedBuild>(
    `UPDATE dump_builds SET status = 'running', runner = $1, heartbeat_at = NOW(), started_at = NOW()
      WHERE id = (SELECT id FROM dump_builds WHERE status = 'queued' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING id, dump, request`,
    [runner],
  );
  return result.rows[0] ?? null;
}

/** The file the build resolved and reads. */
export async function recordFile(id: number, file: DumpFile): Promise<void> {
  await pool.query(
    `UPDATE dump_builds SET file_name = $2, dump_date = $3, url = $4, expected_bytes = $5, checksum_kind = $6, checksum_expected = $7
      WHERE id = $1`,
    [id, file.fileName, file.date, file.url, file.expectedBytes, file.checksum?.kind ?? null, file.checksum?.value ?? null],
  );
}

/** Say the running build `id` is alive and how far it got; answers whether an admin asked it to stop. */
export async function beat(id: number, progress: BuildProgressRecord): Promise<{ cancelRequested: boolean }> {
  const result = await pool.query<Pick<DumpBuildsRow, 'cancel_requested_at'>>(
    'UPDATE dump_builds SET heartbeat_at = NOW(), progress = $2 WHERE id = $1 RETURNING cancel_requested_at',
    [id, JSON.stringify(progress)],
  );
  return { cancelRequested: Boolean(result.rows[0]?.cancel_requested_at) };
}

/**
 * Ask the build of `dump` to stop: a queued one is closed at once, a running
 * one is told through its row and stops at its next heartbeat. Answers
 * whether there was one.
 */
export async function requestCancel(dump: string): Promise<boolean> {
  const queued = await pool.query(
    `UPDATE dump_builds SET status = 'cancelled', error = 'Cancelled.', finished_at = NOW()
      WHERE dump = $1 AND status = 'queued'`,
    [dump],
  );
  const running = await pool.query(
    `UPDATE dump_builds SET cancel_requested_at = NOW() WHERE dump = $1 AND status = 'running'`,
    [dump],
  );
  return (queued.rowCount ?? 0) + (running.rowCount ?? 0) > 0;
}

export async function closeBuild(
  id: number,
  end: {
    status: Exclude<DumpBuildRow['status'], 'running' | 'queued'>; bytes: number; lines: number; checksumActual: string | null; error: string | null;
    /** What a build that ended well did, in words (#1527). */
    outcome?: string | null;
  },
): Promise<void> {
  await pool.query(
    `UPDATE dump_builds SET status = $2, bytes = $3, lines = $4, checksum_actual = $5, error = $6, outcome = $7, finished_at = NOW()
      WHERE id = $1`,
    [id, end.status, end.bytes, end.lines, end.checksumActual, end.error, end.outcome ?? null],
  );
}

/**
 * The newest builds of each dump, for the admin panel: `perDump` of those that
 * read the dump's file, and as many of each kind that does not (re-derives,
 * #1526; samples and trials, #1527), so these never push the file builds out.
 */
export async function recentBuilds(perDump = 3): Promise<DumpBuildRow[]> {
  const result = await pool.query<DumpBuildRow>(
    `SELECT * FROM (
       SELECT b.*, row_number() OVER (
                PARTITION BY b.dump, CASE WHEN b.request->>'kind' IN ('rederive', 'sample', 'trial') THEN b.request->>'kind' END
                ORDER BY b.started_at DESC, b.id DESC) AS rn
         FROM dump_builds b) ranked
      WHERE rn <= $1
      ORDER BY dump, started_at DESC, id DESC`,
    [perDump],
  );
  return result.rows;
}

/**
 * Builds left running by a process that stopped: closed as failed, as
 * `closeOrphanedSyncLogs` closes a sync's. A row stopped when it has not
 * beaten for five minutes, or, given `runner`, at once when that runner left
 * it: a worker that starts passes its own, since none of its builds survived
 * its restart. A build that still beats in another process, and a queued one,
 * are left alone. Called when the backend and the worker start, and when the
 * panel lists the dumps.
 */
export async function closeOrphanedBuilds(options: { runner?: string } = {}): Promise<number> {
  const result = await pool.query(
    `UPDATE dump_builds SET status = 'failed', error = 'The build stopped: its process ended or restarted.', finished_at = NOW()
      WHERE status = 'running'
        AND (heartbeat_at IS NULL OR heartbeat_at < NOW() - ${ALIVE_FOR} OR runner = $1)`,
    [options.runner ?? null],
  );
  return result.rowCount ?? 0;
}

/**
 * Close the builds `runner` is running as failed with `error`: what a dump
 * worker records on its way out when something it did not catch ends it, so
 * the row says why rather than only that its process ended.
 */
export async function failBuildsOf(runner: string, error: string): Promise<number> {
  const result = await pool.query(
    `UPDATE dump_builds SET status = 'failed', error = $2, finished_at = NOW()
      WHERE status = 'running' AND runner = $1`,
    [runner, error.slice(0, 2000)],
  );
  return result.rowCount ?? 0;
}

export type ActiveBuild = Pick<DumpBuildRow,
  'id' | 'status' | 'request' | 'progress' | 'file_name' | 'dump_date' | 'expected_bytes' | 'started_at' | 'heartbeat_at' | 'runner' | 'cancel_requested_at'>;

/** The build of `dump` queued or running now, in any process, or null. */
export async function activeBuildOf(dump: string): Promise<ActiveBuild | null> {
  const result = await pool.query<ActiveBuild>(
    `SELECT id, status, request, progress, file_name, dump_date, expected_bytes, started_at, heartbeat_at, runner, cancel_requested_at
       FROM dump_builds WHERE dump = $1 AND status IN ('queued', 'running')`,
    [dump],
  );
  return result.rows[0] ?? null;
}
