/**
 * A dump build started from the admin panel (ADR-0101 decision 4): the newest
 * complete file of a dump read through the pipeline into a consumer, recorded
 * in the ledger, its progress held in memory for the panel to poll, the way a
 * sync's is (`runningSyncs`). One build per dump at a time.
 *
 * A verify build reads through the counting consumer (`countLines`) and keeps
 * nothing. A keeping build runs the dump's own builder (`KEEPERS`): the local
 * Wikidata subset (#1434); readership and the Wikipedia tables bring theirs
 * (#1436, #1440).
 */

import { dumpNamed, type DumpDescriptor, type DumpFile, type DumpKey } from './catalog.js';
import { fetchText, sizeOf } from './fetch.js';
import { BEAT_EVERY_MS, beat, closeBuild, closeOrphanedBuilds, liveBuildOf, openBuild } from './ledger.js';
import { newestLocalCopy } from './localCopies.js';
import { countLines, readDump, type ReadOptions } from './read.js';
import { buildSubset } from './wikidata/subsetBuild.js';
import { latestSubset } from './wikidata/subsetTables.js';

export interface DumpBuildProgress {
  dump: DumpKey;
  /** `verify` reads and counts; `keep` runs the dump's builder and keeps what it builds. */
  kind: 'verify' | 'keep';
  status: 'resolving' | 'reading' | 'success' | 'failed' | 'cancelled';
  message: string;
  file: Pick<DumpFile, 'fileName' | 'date' | 'expectedBytes'> | null;
  downloaded: number;
  read: number;
  lines: number;
  buildId: number | null;
}

const running = new Map<DumpKey, { progress: DumpBuildProgress; controller: AbortController }>();

export function buildProgress(dump: DumpKey): DumpBuildProgress | null {
  return running.get(dump)?.progress ?? null;
}

/** Whether a build is still going: resolving its file or reading it. */
export const inFlight = (progress: DumpBuildProgress): boolean => ['resolving', 'reading'].includes(progress.status);

export function cancelBuild(dump: DumpKey): boolean {
  const entry = running.get(dump);
  if (!entry || !inFlight(entry.progress)) return false;
  entry.controller.abort();
  return true;
}

/**
 * Which file a build reads: the newest the host has finished publishing, or
 * the one the local copy holds (#1456), so a copy downloaded for hours is
 * built from even when a newer dump has appeared since.
 */
export type BuildFrom = 'newest' | 'local';

/** The file name of the dump's newest local copy; refuses where there is none. */
async function localCopyName(descriptor: DumpDescriptor): Promise<string> {
  const dir = dumpsDir();
  const copy = dir ? await newestLocalCopy(dir, descriptor.isFileName) : null;
  if (!copy) throw new Error(`There is no local copy of ${descriptor.key} to build from`);
  return copy.fileName;
}

/** Where a local copy is kept, if the deployment names one; absent, a build streams. */
function dumpsDir(): string | undefined {
  const dir = process.env.DUMPS_DIR?.trim();
  return dir ? dir : undefined;
}

export interface Kept {
  /** The dump date of the build now in place, and when it was swapped in. */
  dumpDate: string;
  swappedAt: Date;
}

interface Keeper {
  /** What a keeping build of the dump makes, for the admin panel. */
  title: string;
  build(file: DumpFile, options: ReadOptions & { buildId: number; onPhase: (message: string) => void }):
    Promise<{ bytes: number; lines: number; checksumActual: string | null }>;
  /** The build now in place, if any. */
  latest(): Promise<Kept | null>;
}

/** The dumps a build can keep something from, and what builds it. */
const KEEPERS: Partial<Record<DumpKey, Keeper>> = {
  'wikidata-entities': { title: 'The local Wikidata subset', build: buildSubset, latest: latestSubset },
};

export const keeperOf = (key: DumpKey): Pick<Keeper, 'title' | 'latest'> | null => KEEPERS[key] ?? null;

export interface BuildRequest {
  startedBy: number | null;
  /** What runs the build (`openBuild`): the routes pass `SERVER_RUNNER`, anything else its own name. */
  runner: string;
  kind?: DumpBuildProgress['kind'];
  /** The newest file the host lists (the default), or the local copy's own. */
  from?: BuildFrom;
}

/**
 * Start a build of `dump` in the background. Refuses a keeping one of a dump
 * with no builder, and a second one of the same dump, in this process or in
 * any other whose build still beats (#1463): a build run by a script reads the
 * same local copy, and a second download of a 156 GB dump beside it would
 * fill the disk under both.
 */
export async function startBuild(key: DumpKey, { startedBy, runner, kind = 'verify', from = 'newest' }: BuildRequest): Promise<DumpBuildProgress> {
  if (!running.has(key) || !inFlight(running.get(key)!.progress)) {
    await closeOrphanedBuilds({ dump: key });
    const live = await liveBuildOf(key);
    if (live) {
      throw new Error(`A build of this dump is running in another process: build ${live.id}, ${live.file_name}, started ${live.started_at.toISOString()}`);
    }
  }
  const existing = running.get(key);
  if (existing && inFlight(existing.progress)) {
    throw new Error('A build of this dump is already running');
  }
  const descriptor = dumpNamed(key);
  if (!descriptor) throw new Error(`No dump named ${key}`);
  if (kind === 'keep' && !KEEPERS[key]) throw new Error(`Nothing is built from ${key} yet`);
  const only = from === 'local' ? await localCopyName(descriptor) : undefined;
  const progress: DumpBuildProgress = {
    dump: key, kind, status: 'resolving', file: null,
    message: only ? `Finding ${only} on the host...` : 'Finding the newest complete file...',
    downloaded: 0, read: 0, lines: 0, buildId: null,
  };
  const controller = new AbortController();
  running.set(key, { progress, controller });
  void run(descriptor, progress, controller, startedBy, runner, only);
  return progress;
}

function verifiedMessage(file: DumpFile, lines: number, checksumActual: string | null): string {
  const how = checksumActual ? `${file.checksum?.kind} matches the host's` : 'size and stream end match the host\'s';
  return `${file.fileName} verified: ${lines.toLocaleString('en')} lines, ${how}`;
}

/** Close a build that did not end verified; what it did on the way (an older copy removed) is kept in its message. */
async function fail(progress: DumpBuildProgress, controller: AbortController, error: unknown, notes: string[]): Promise<void> {
  const cancelled = controller.signal.aborted;
  progress.status = cancelled ? 'cancelled' : 'failed';
  let message = error instanceof Error ? error.message : String(error);
  if (cancelled) message = 'Cancelled.';
  message = [message, ...notes].join('; ');
  progress.message = message;
  console.error('[Dumps] A build ended without a verified file:', progress.dump, progress.status, error);
  if (progress.buildId === null) return;
  await closeBuild(progress.buildId, {
    status: progress.status, bytes: progress.read, lines: progress.lines, checksumActual: null, error: message,
  }).catch(err => console.error('[Dumps] Could not close the build row:', err));
}

/** The file a build reads: the newest the host lists, or the local copy's own (`only`). */
async function resolveFile(descriptor: DumpDescriptor, signal: AbortSignal, only?: string): Promise<DumpFile> {
  const file = await descriptor.resolve(
    url => fetchText(url, signal), url => sizeOf(url, signal), only ? name => name === only : undefined,
  );
  if (file) return file;
  throw new Error(only
    ? `The host no longer lists ${only} with its checksum, so the local copy cannot be verified`
    : 'The host lists no complete file of this dump in its recent directories');
}

/** What the read reports to the panel's progress and the build's notes. */
function readOptions(descriptor: DumpDescriptor, progress: DumpBuildProgress, signal: AbortSignal, notes: string[]): ReadOptions {
  return {
    dumpsDir: dumpsDir(),
    signal,
    onProgress: ({ downloaded, read, lines }) => {
      progress.downloaded = downloaded;
      progress.read = read;
      progress.lines = lines;
    },
    onNote: note => {
      notes.push(note);
      console.log(`[Dumps] ${descriptor.key}: ${note}`);
    },
  };
}

async function run(
  descriptor: DumpDescriptor,
  progress: DumpBuildProgress,
  controller: AbortController,
  startedBy: number | null,
  runner: string,
  only?: string,
): Promise<void> {
  let heart: NodeJS.Timeout | undefined;
  const notes: string[] = [];
  try {
    const file = await resolveFile(descriptor, controller.signal, only);
    progress.file = { fileName: file.fileName, date: file.date, expectedBytes: file.expectedBytes };
    const dir = dumpsDir();
    const buildId = await openBuild(file, dir ? 'local' : 'stream', startedBy, runner);
    progress.buildId = buildId;
    heart = setInterval(() => {
      beat(buildId).catch(error => console.error('[Dumps] Could not beat the build row:', error));
    }, BEAT_EVERY_MS);
    progress.status = 'reading';
    progress.message = `Reading ${file.fileName}${dir ? ' into the local copy' : ' from the host'}...`;
    const options = readOptions(descriptor, progress, controller.signal, notes);
    const keeper = progress.kind === 'keep' ? KEEPERS[descriptor.key] : undefined;
    const result = keeper
      ? await keeper.build(file, { ...options, buildId, onPhase: message => { progress.message = message; } })
      : await readDump(file, countLines(), options);
    progress.lines = result.lines;
    progress.read = result.bytes;
    progress.status = 'success';
    progress.message = [verifiedMessage(file, result.lines, result.checksumActual), ...(keeper ? ['built and swapped in'] : []), ...notes].join('; ');
    await closeBuild(buildId, { status: 'success', bytes: result.bytes, lines: result.lines, checksumActual: result.checksumActual, error: null });
  } catch (error) {
    await fail(progress, controller, error, notes);
  } finally {
    clearInterval(heart);
  }
}
