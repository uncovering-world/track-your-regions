/**
 * The admin panel's side of a dump build (ADR-0106): a build is checked and
 * queued in the ledger, and the dump worker runs it (`dumpWorker.ts`), so a
 * restart of the backend does not stop it. What the panel shows of a build
 * is read back from its row, whatever process runs it.
 */

import { dumpNamed, type DumpDescriptor, type DumpFile, type DumpKey } from './catalog.js';
import type { OperationProgressAnswer } from '../../api/responses/operation.js';
import { activeBuildOf, closeOrphanedBuilds, enqueueBuild, requestCancel, type ActiveBuild, type BuildKind, type BuildProgressRecord } from './ledger.js';
import { keeperOf } from './keepers.js';
import { newestLocalCopy } from './localCopies.js';
import { newestSample } from './samples.js';

export interface DumpBuildProgress {
  dump: DumpKey;
  kind: BuildKind;
  status: 'queued' | BuildProgressRecord['phase'];
  message: string;
  file: Pick<DumpFile, 'fileName' | 'date' | 'expectedBytes'> | null;
  downloaded: number;
  read: number;
  lines: number;
  buildId: number;
  /** When the build last said it is alive; null while it waits for the worker. */
  heartbeatAt: Date | null;
  /** Seconds the step has left at its pace so far, for a step that reads a file; null while there is no telling. */
  etaSeconds: number | null;
  /** What `read` is measured against: the dump's file in a pass, the terms spool while labelling, the sample's size while cutting one; null in a step with no measure (#1519). */
  total: number | null;
  /** The build as every long operation reports, already in the wire's shape (#1356). */
  operation: OperationProgressAnswer;
  /** When the step running now started; null while the build is queued. */
  stepStartedAt: Date | null;
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
  const copy = dir ? await newestLocalCopy(dir, descriptor.isFileName, descriptor.datedBy) : null;
  if (!copy) throw new Error(`There is no local copy of ${descriptor.key} to build from`);
  return copy.fileName;
}

/** The file name of the dump's newest sample (#1527); refuses where there is none. */
async function sampleName(descriptor: DumpDescriptor): Promise<string> {
  const dir = dumpsDir();
  const sample = dir ? await newestSample(dir, descriptor.isFileName) : null;
  if (!sample) throw new Error(`There is no sample of ${descriptor.key} to try the build on: cut one from the local copy first`);
  return sample.fileName;
}

/** The local file a build reads, by its kind: the local copy, the sample a trial reads, or none. */
async function localFileOf(descriptor: DumpDescriptor, kind: BuildKind, from: BuildFrom): Promise<string | undefined> {
  if (kind === 'trial') return sampleName(descriptor);
  if (kind === 'sample' || (from === 'local' && kind !== 'rederive')) return localCopyName(descriptor);
  // A re-derive reads no file.
  return undefined;
}

function progressOf(dump: DumpKey, build: ActiveBuild): DumpBuildProgress {
  // A row from before migration 101 asked for nothing: it was a verify or keep build the old code ran.
  const request = build.request as { kind: BuildKind; scheduled?: true; notBefore?: string } | null;
  const progress = build.progress as Omit<BuildProgressRecord, 'etaSeconds'> & { etaSeconds?: number | null } | null;
  const queued = build.status === 'queued';
  return {
    dump,
    kind: request?.kind ?? 'verify',
    status: queued ? 'queued' : progress?.phase ?? 'resolving',
    message: queued ? queuedMessage(request) : progress?.message ?? 'Starting...',
    file: build.file_name && build.dump_date
      ? { fileName: build.file_name, date: isoDay(build.dump_date), expectedBytes: build.expected_bytes === null ? null : Number(build.expected_bytes) }
      : null,
    downloaded: progress?.downloaded ?? 0,
    read: progress?.read ?? 0,
    lines: progress?.lines ?? 0,
    buildId: build.id,
    heartbeatAt: queued ? null : build.heartbeat_at,
    etaSeconds: progress?.etaSeconds ?? null,
    total: progress?.total ?? null,
    stepStartedAt: !queued && progress?.stepStartedAt ? new Date(progress.stepStartedAt) : null,
    operation: operationOf(build, progress, queued),
  };
}

/** What a queued build says: a self-queued update says when the worker may take it. */
function queuedMessage(request: { scheduled?: true; notBefore?: string } | null): string {
  if (request?.scheduled && request.notBefore) return `Scheduled update: the dump worker takes it from ${request.notBefore.slice(0, 16).replace('T', ' ')} UTC`;
  return 'Waiting for the dump worker...';
}

/**
 * The build in the shape every long operation reports (#1356): its step, by
 * the message the worker gives and the ordinal it keeps, measured as the
 * panel's bar already was, with no step count since a build names its steps
 * as it goes. Times are seconds on the server's clock.
 */
function operationOf(
  build: ActiveBuild,
  progress: Omit<BuildProgressRecord, 'etaSeconds'> | null,
  queued: boolean,
): OperationProgressAnswer {
  const now = Date.now();
  const since = (at: Date | string | null | undefined) => (at ? Math.max(0, Math.round((now - new Date(at).getTime()) / 1000)) : 0);
  return {
    elapsedSeconds: since(build.started_at),
    cancelling: build.cancel_requested_at !== null,
    wait: null,
    step: queued || !progress ? null : {
      index: progress.step ?? 1,
      count: null,
      sentence: progress.message,
      done: Math.max(progress.read, progress.downloaded),
      total: progress.total ?? 0,
      elapsedSeconds: since(progress.stepStartedAt),
    },
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
 * Queue a build of `dump` for the worker. Refuses a keeping one, a sample or
 * a trial of a dump with no builder, a re-derive with nothing kept to derive
 * from, one from a local copy or a sample that is not there, and a second one
 * of a dump with a build queued or running in any process (#1463): a second
 * download of a 156 GB dump beside the first would fill the disk under both,
 * and a re-derive beside a build would swap tables in under it.
 */
export async function startBuild(key: DumpKey, { startedBy, kind = 'verify', from = 'newest' }: BuildRequest): Promise<DumpBuildProgress> {
  const descriptor = dumpNamed(key);
  if (!descriptor) throw new Error(`No dump named ${key}`);
  const keeper = keeperOf(key);
  if ((kind === 'keep' || kind === 'sample' || kind === 'trial') && !keeper) throw new Error(`Nothing is built from ${key} yet`);
  if ((kind === 'sample' || kind === 'trial') && !keeper?.samples) throw new Error(`The build of ${key} cannot be tried on a sample: it keeps only whole files`);
  if (kind === 'keep' && from === 'local' && !keeper?.fromCopy) throw new Error(`The build of ${key} always reads the newest file: it resumes a local copy on its own`);
  if (kind === 'rederive') {
    if (!keeper?.rederive) throw new Error(`Nothing built from ${key} can be derived again`);
    if (!await keeper.latest()) throw new Error(`Nothing is built from ${key} yet: build it from the dump first`);
  }
  const only = await localFileOf(descriptor, kind, from);
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
