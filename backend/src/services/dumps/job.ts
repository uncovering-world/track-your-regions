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
import { closeBuild, openBuild } from './ledger.js';
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

export function cancelBuild(dump: DumpKey): boolean {
  const entry = running.get(dump);
  if (!entry || !['resolving', 'reading'].includes(entry.progress.status)) return false;
  entry.controller.abort();
  return true;
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

/** Start a build of `dump` in the background; refuses a second one of the same dump, and a keeping one of a dump with no builder. */
export function startBuild(key: DumpKey, startedBy: number | null, kind: DumpBuildProgress['kind'] = 'verify'): DumpBuildProgress {
  const existing = running.get(key);
  if (existing && ['resolving', 'reading'].includes(existing.progress.status)) {
    throw new Error('A build of this dump is already running');
  }
  const descriptor = dumpNamed(key);
  if (!descriptor) throw new Error(`No dump named ${key}`);
  if (kind === 'keep' && !KEEPERS[key]) throw new Error(`Nothing is built from ${key} yet`);
  const progress: DumpBuildProgress = {
    dump: key, kind, status: 'resolving', message: 'Finding the newest complete file...', file: null,
    downloaded: 0, read: 0, lines: 0, buildId: null,
  };
  const controller = new AbortController();
  running.set(key, { progress, controller });
  void run(descriptor, progress, controller, startedBy);
  return progress;
}

function verifiedMessage(file: DumpFile, lines: number, checksumActual: string | null): string {
  const how = checksumActual ? `${file.checksum?.kind} matches the host's` : 'size and stream end match the host\'s';
  return `${file.fileName} verified: ${lines.toLocaleString('en')} lines, ${how}`;
}

async function fail(progress: DumpBuildProgress, controller: AbortController, error: unknown): Promise<void> {
  const cancelled = controller.signal.aborted;
  progress.status = cancelled ? 'cancelled' : 'failed';
  let message = error instanceof Error ? error.message : String(error);
  if (cancelled) message = 'Cancelled.';
  progress.message = message;
  console.error('[Dumps] A build ended without a verified file:', progress.dump, progress.status, error);
  if (progress.buildId === null) return;
  await closeBuild(progress.buildId, {
    status: progress.status, bytes: progress.read, lines: progress.lines, checksumActual: null, error: message,
  }).catch(err => console.error('[Dumps] Could not close the build row:', err));
}

async function run(
  descriptor: DumpDescriptor,
  progress: DumpBuildProgress,
  controller: AbortController,
  startedBy: number | null,
): Promise<void> {
  try {
    const file = await descriptor.resolve(
      url => fetchText(url, controller.signal), url => sizeOf(url, controller.signal),
    );
    if (!file) throw new Error('The host lists no complete file of this dump in its recent directories');
    progress.file = { fileName: file.fileName, date: file.date, expectedBytes: file.expectedBytes };
    const dir = dumpsDir();
    const buildId = await openBuild(file, dir ? 'local' : 'stream', startedBy);
    progress.buildId = buildId;
    progress.status = 'reading';
    progress.message = `Reading ${file.fileName}${dir ? ' into the local copy' : ' from the host'}...`;
    const options: ReadOptions = {
      dumpsDir: dir,
      signal: controller.signal,
      onProgress: ({ downloaded, read, lines }) => {
        progress.downloaded = downloaded;
        progress.read = read;
        progress.lines = lines;
      },
    };
    const keeper = progress.kind === 'keep' ? KEEPERS[descriptor.key] : undefined;
    const result = keeper
      ? await keeper.build(file, { ...options, buildId, onPhase: message => { progress.message = message; } })
      : await readDump(file, countLines(), options);
    progress.lines = result.lines;
    progress.read = result.bytes;
    progress.status = 'success';
    progress.message = verifiedMessage(file, result.lines, result.checksumActual);
    if (keeper) progress.message = `${progress.message}; built and swapped in`;
    await closeBuild(buildId, { status: 'success', bytes: result.bytes, lines: result.lines, checksumActual: result.checksumActual, error: null });
  } catch (error) {
    await fail(progress, controller, error);
  }
}
