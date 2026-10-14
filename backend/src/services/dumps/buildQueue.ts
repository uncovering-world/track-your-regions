/**
 * The admin panel's side of a dump build (ADR-0106): a build is checked and
 * queued in the ledger, and the dump worker runs it (`dumpWorker.ts`), so a
 * restart of the backend does not stop it. What the panel shows of a build
 * is read back from its row, whatever process runs it.
 */

import { dumpNamed, type DumpDescriptor, type DumpFile, type DumpKey } from './catalog.js';
import { activeBuildOf, closeOrphanedBuilds, enqueueBuild, requestCancel, type ActiveBuild } from './ledger.js';
import { keeperOf } from './keepers.js';
import { newestLocalCopy } from './localCopies.js';

export interface DumpBuildProgress {
  dump: DumpKey;
  /** `verify` reads and counts; `keep` runs the dump's builder and keeps what it builds. */
  kind: 'verify' | 'keep';
  status: 'queued' | 'resolving' | 'reading';
  message: string;
  file: Pick<DumpFile, 'fileName' | 'date' | 'expectedBytes'> | null;
  downloaded: number;
  read: number;
  lines: number;
  buildId: number;
  /** When the build last said it is alive; null while it waits for the worker. */
  heartbeatAt: Date | null;
  /** Seconds the pass being read has left at its pace so far; null while there is no telling. */
  etaSeconds: number | null;
}

/**
 * Which file a build reads: the newest the host has finished publishing, or
 * the one the local copy holds (#1456), so a copy downloaded for hours is
 * built from even when a newer dump has appeared since.
 */
export type BuildFrom = 'newest' | 'local';

/** Where a local copy is kept, if the deployment names one; absent, a build streams. */
export function dumpsDir(): string | undefined {
  const dir = process.env.DUMPS_DIR?.trim();
  return dir ? dir : undefined;
}

/** The file name of the dump's newest local copy; refuses where there is none. */
async function localCopyName(descriptor: DumpDescriptor): Promise<string> {
  const dir = dumpsDir();
  const copy = dir ? await newestLocalCopy(dir, descriptor.isFileName) : null;
  if (!copy) throw new Error(`There is no local copy of ${descriptor.key} to build from`);
  return copy.fileName;
}

function progressOf(dump: DumpKey, build: ActiveBuild): DumpBuildProgress {
  // A row from before migration 101 asked for nothing: it was a verify or keep build the old code ran.
  const request = build.request as { kind: 'verify' | 'keep' } | null;
  const progress = build.progress as {
    phase: 'resolving' | 'reading'; message: string; downloaded: number; read: number; lines: number; etaSeconds?: number | null;
  } | null;
  const queued = build.status === 'queued';
  return {
    dump,
    kind: request?.kind ?? 'verify',
    status: queued ? 'queued' : progress?.phase ?? 'resolving',
    message: queued ? 'Waiting for the dump worker...' : progress?.message ?? 'Starting...',
    file: build.file_name && build.dump_date
      ? { fileName: build.file_name, date: isoDay(build.dump_date), expectedBytes: build.expected_bytes === null ? null : Number(build.expected_bytes) }
      : null,
    downloaded: progress?.downloaded ?? 0,
    read: progress?.read ?? 0,
    lines: progress?.lines ?? 0,
    buildId: build.id,
    heartbeatAt: queued ? null : build.heartbeat_at,
    etaSeconds: progress?.etaSeconds ?? null,
  };
}

/** A dump's date as the wire carries it, from what the driver gives for a `date` column. */
export function isoDay(date: Date | string): string {
  return date instanceof Date ? date.toISOString().slice(0, 10) : String(date);
}

/** The build of `dump` queued or running now, as the panel shows it, or null. */
export async function buildProgress(dump: DumpKey): Promise<DumpBuildProgress | null> {
  const build = await activeBuildOf(dump);
  return build ? progressOf(dump, build) : null;
}

export interface BuildRequest {
  startedBy: number | null;
  kind?: DumpBuildProgress['kind'];
  /** The newest file the host lists (the default), or the local copy's own. */
  from?: BuildFrom;
}

/**
 * Queue a build of `dump` for the worker. Refuses a keeping one of a dump
 * with no builder, one from a local copy that is not there, and a second one
 * of a dump with a build queued or running in any process (#1463): a second
 * download of a 156 GB dump beside the first would fill the disk under both.
 */
export async function startBuild(key: DumpKey, { startedBy, kind = 'verify', from = 'newest' }: BuildRequest): Promise<DumpBuildProgress> {
  const descriptor = dumpNamed(key);
  if (!descriptor) throw new Error(`No dump named ${key}`);
  if (kind === 'keep' && !keeperOf(key)) throw new Error(`Nothing is built from ${key} yet`);
  const only = from === 'local' ? await localCopyName(descriptor) : undefined;
  await closeOrphanedBuilds();
  await enqueueBuild(key, dumpsDir() ? 'local' : 'stream', { kind, ...(only ? { only } : {}) }, startedBy);
  const progress = await buildProgress(key);
  if (!progress) throw new Error(`The build of ${key} was queued and has already ended`);
  return progress;
}

/** Ask the build of `dump` to stop, queued or running; answers whether there was one. */
export async function cancelBuild(dump: DumpKey): Promise<boolean> {
  return requestCancel(dump);
}
