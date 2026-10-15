/**
 * Running one queued dump build in the dump worker (ADR-0106): the file is
 * resolved, the dump is read through the counting consumer (`verify`) or the
 * dump's builder (`keep`), and the row is closed with the outcome; a
 * `rederive` reads no file and runs the builder's derivation alone. Every
 * `BEAT_EVERY_MS` the build writes its progress and heartbeat to its row,
 * which is how the panel follows it, and learns whether an admin asked it to
 * stop.
 */

import { dumpNamed, type DumpDescriptor, type DumpFile } from './catalog.js';
import { fetchText, sizeOf } from './fetch.js';
import { BEAT_EVERY_MS, beat, closeBuild, recordFile, type BuildProgressRecord, type ClaimedBuild } from './ledger.js';
import { dumpsDir } from './buildQueue.js';
import { keeperOf } from './keepers.js';
import { PassClock } from './passClock.js';
import { countLines, readDump, type ReadOptions } from './read.js';

function verifiedMessage(file: DumpFile, lines: number, checksumActual: string | null): string {
  const how = checksumActual ? `${file.checksum?.kind} matches the host's` : 'size and stream end match the host\'s';
  return `${file.fileName} verified: ${lines.toLocaleString('en')} lines, ${how}`;
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

/** What the read reports to the build's progress and notes. */
function readOptions(
  descriptor: DumpDescriptor, progress: BuildProgressRecord, signal: AbortSignal, notes: string[],
  clock: PassClock, total: number | null,
): ReadOptions {
  return {
    dumpsDir: dumpsDir(),
    signal,
    onProgress: ({ downloaded, read, lines }) => {
      progress.downloaded = downloaded;
      progress.read = read;
      progress.lines = lines;
      // The download and the read are two passes over the file: the read's first report falls below the
      // download's last, and the clock starts again. A ranged download counts the bytes already held.
      progress.etaSeconds = clock.observe(read > 0 ? read : downloaded, total, Date.now());
    },
    onNote: note => {
      notes.push(note);
      console.log(`[Dumps] ${descriptor.key}: ${note}`);
    },
  };
}

/** Why a build stopped short: an admin's cancel, or the worker stopping. */
export class WorkerStopping extends Error {}

/**
 * Run the claimed build to its end and close its row. `stop` aborts it when
 * the worker itself stops: the row then says so, since the build will not go
 * on without being started again.
 */
export async function runBuild(claimed: ClaimedBuild, stop: AbortSignal): Promise<void> {
  const controller = new AbortController();
  const onStop = () => controller.abort(new WorkerStopping('The dump worker stopped; start the build again.'));
  stop.addEventListener('abort', onStop, { once: true });
  const progress: BuildProgressRecord = {
    phase: 'resolving', message: 'Finding the newest complete file...', downloaded: 0, read: 0, lines: 0, etaSeconds: null,
  };
  const clock = new PassClock();
  const notes: string[] = [];
  const heart = setInterval(() => {
    beat(claimed.id, progress)
      .then(({ cancelRequested }) => { if (cancelRequested) controller.abort(new Error('Cancelled.')); })
      .catch(error => console.error('[Dumps] Could not beat the build row:', error));
  }, BEAT_EVERY_MS);
  try {
    const descriptor = dumpNamed(claimed.dump);
    if (!descriptor) throw new Error(`No dump named ${claimed.dump}`);
    const { kind, only } = claimed.request;
    if (kind === 'rederive') {
      await rederive(claimed, descriptor, progress, controller.signal, notes);
      return;
    }
    // A kind this code does not know reads no file: counting it as a verify would download the dump.
    if (kind !== 'keep' && kind !== 'verify') throw new Error(`This dump worker does not know a ${String(kind)} build; recreate it to run the current code`);
    if (only) progress.message = `Finding ${only} on the host...`;
    await beat(claimed.id, progress);
    const file = await resolveFile(descriptor, controller.signal, only);
    await recordFile(claimed.id, file);
    progress.phase = 'reading';
    progress.message = `Reading ${file.fileName}${dumpsDir() ? ' into the local copy' : ' from the host'}...`;
    const options = readOptions(descriptor, progress, controller.signal, notes, clock, file.expectedBytes);
    const keeper = kind === 'keep' ? keeperOf(descriptor.key) : null;
    const result = keeper
      ? await keeper.build(file, {
        ...options,
        buildId: claimed.id,
        // A new step: a pass starts its own clock, and a step that reads no file has no estimate.
        onPhase: message => { progress.message = message; progress.etaSeconds = null; clock.reset(); },
      })
      : await readDump(file, countLines(), options);
    const message = [verifiedMessage(file, result.lines, result.checksumActual), ...(keeper ? ['built and swapped in'] : []), ...notes].join('; ');
    console.log(`[Dumps] ${descriptor.key}: ${message}`);
    await closeBuild(claimed.id, { status: 'success', bytes: result.bytes, lines: result.lines, checksumActual: result.checksumActual, error: null });
  } catch (error) {
    await fail(claimed, controller.signal, error, progress, notes);
  } finally {
    clearInterval(heart);
    stop.removeEventListener('abort', onStop);
  }
}

/** Derive the kept build's tables again from what it holds (#1526), and close the row: there is no file to verify. */
async function rederive(
  claimed: ClaimedBuild, descriptor: DumpDescriptor, progress: BuildProgressRecord, signal: AbortSignal, notes: string[],
): Promise<void> {
  const keeper = keeperOf(descriptor.key);
  if (!keeper?.rederive) throw new Error(`Nothing built from ${descriptor.key} can be derived again`);
  progress.phase = 'deriving';
  progress.message = 'Deriving the tables again from what is kept...';
  await beat(claimed.id, progress);
  await keeper.rederive({
    buildId: claimed.id,
    signal,
    onPhase: message => { progress.message = message; },
    onNote: note => {
      notes.push(note);
      console.log(`[Dumps] ${descriptor.key}: ${note}`);
    },
  });
  console.log(`[Dumps] ${descriptor.key}: ${['derived again and swapped in', ...notes].join('; ')}`);
  await closeBuild(claimed.id, { status: 'success', bytes: 0, lines: 0, checksumActual: null, error: null });
}

/** Close a build that did not end verified; what it did on the way (an older copy removed) is kept in its message. */
async function fail(claimed: ClaimedBuild, signal: AbortSignal, error: unknown, progress: BuildProgressRecord, notes: string[]): Promise<void> {
  const reason: unknown = signal.aborted ? signal.reason : error;
  const cancelled = signal.aborted && !(reason instanceof WorkerStopping);
  const status = cancelled ? 'cancelled' : 'failed';
  const message = [reason instanceof Error ? reason.message : String(reason), ...notes].join('; ');
  console.error('[Dumps] A build ended without a verified file:', claimed.dump, status, error);
  await closeBuild(claimed.id, { status, bytes: progress.read, lines: progress.lines, checksumActual: null, error: message })
    .catch(err => console.error('[Dumps] Could not close the build row:', err));
}
