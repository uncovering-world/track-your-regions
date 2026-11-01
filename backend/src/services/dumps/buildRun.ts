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
import { BEAT_EVERY_MS, beat, closeBuild, recordFile, recordUpdate, type BuildProgressRecord, type ClaimedBuild } from './ledger.js';
import { dumpsDir } from './buildQueue.js';
import { keeperOf, type Keeper } from './keepers.js';
import { PassClock } from './passClock.js';
import { countLines, holdVerifiedCopy, readDump, type ReadOptions } from './read.js';
import { cutSample, SAMPLE_JSON_BYTES, sampleFile, sampleIn } from './samples.js';
import { StepTimes } from './stepTimes.js';

function verifiedMessage(file: DumpFile, lines: number, checksumActual: string | null): string {
  const how = checksumActual ? `${file.checksum?.kind} matches the host's` : 'size and stream end match the host\'s';
  // A binary file is held whole, never read by lines.
  if (file.compression === 'none') return `${file.fileName} verified and kept: ${how}`;
  return `${file.fileName} verified: ${lines.toLocaleString('en')} lines, ${how}`;
}

/** The file a build reads: the newest the host lists, the local copy's own (`only`), or the last month of a year asked for by its end (#2230). */
async function resolveFile(descriptor: DumpDescriptor, signal: AbortSignal, only?: string, windowEnd?: string): Promise<DumpFile> {
  const file = await descriptor.resolve(
    url => fetchText(url, signal), url => sizeOf(url, signal), only ? name => name === only : undefined,
  );
  if (file) return file;
  if (windowEnd) throw new Error(`The host does not list ${only}, the last month of the year ending ${windowEnd}`);
  throw new Error(only
    ? `The host no longer lists ${only} with its checksum, so the local copy cannot be verified`
    : 'The host lists no complete file of this dump in its recent directories');
}

/**
 * What a build has read of its file, kept apart from the step's measure on its progress (#1519):
 * a build that fails records these, never the terms spool's bytes or a step's reset.
 */
interface Figures {
  bytes: number;
  lines: number;
}

/** What the read reports to the build's progress and notes. */
function readOptions(
  descriptor: DumpDescriptor, progress: BuildProgressRecord, signal: AbortSignal, notes: string[],
  clock: PassClock, total: number | null, figures: Figures,
): ReadOptions {
  return {
    dumpsDir: dumpsDir(),
    signal,
    onProgress: ({ downloaded, read, lines }) => {
      progress.downloaded = downloaded;
      progress.read = read;
      progress.lines = lines;
      figures.bytes = read;
      figures.lines = lines;
      progress.total = total;
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
  const figures: Figures = { bytes: 0, lines: 0 };
  const heart = setInterval(() => {
    beat(claimed.id, progress)
      .then(({ cancelRequested }) => { if (cancelRequested) controller.abort(new Error('Cancelled.')); })
      .catch(error => console.error('[Dumps] Could not beat the build row:', error));
  }, BEAT_EVERY_MS);
  // Every step a build names, timed, for the row of a build that ends well (#1527), and
  // its start on the running build's progress, with what it measures reset (#1519).
  const steps = new StepTimes();
  const onPhase = (message: string): boolean => {
    progress.message = message;
    if (!steps.phase(message)) return false;
    progress.stepStartedAt = new Date().toISOString();
    progress.step = (progress.step ?? 0) + 1;
    progress.read = 0;
    progress.downloaded = 0;
    progress.lines = 0;
    progress.total = null;
    return true;
  };
  const close = async (result: { bytes: number; lines: number; checksumActual: string | null }, said: string[]) => {
    const timed = steps.summary();
    const outcome = [...said, ...(timed ? [`steps: ${timed}`] : []), ...notes].join('; ');
    console.log(`[Dumps] ${claimed.dump}: ${outcome}`);
    await closeBuild(claimed.id, { status: 'success', ...result, error: null, outcome });
  };
  try {
    const descriptor = dumpNamed(claimed.dump);
    if (!descriptor) throw new Error(`No dump named ${claimed.dump}`);
    const { kind, only } = claimed.request;
    if (kind === 'rederive') {
      await rederive(claimed, descriptor, progress, controller.signal, notes, onPhase);
      await close({ bytes: 0, lines: 0, checksumActual: null }, ['derived again and swapped in']);
      return;
    }
    if (kind === 'sample') {
      const cut = await cutFrom(claimed, descriptor, progress, controller.signal, only, figures, onPhase);
      await close(cut.result, [cut.said]);
      return;
    }
    if (kind === 'trial') {
      const trial = await tryOnSample(claimed, descriptor, progress, controller.signal, notes, clock, onPhase, only, figures);
      await close(trial, [`tried the build on ${only}`, ...(trial.summary ? [trial.summary] : []), 'nothing was swapped in']);
      return;
    }
    // A kind this code does not know reads no file: counting it as a verify would download the dump.
    if (kind !== 'keep' && kind !== 'verify') throw new Error(`This dump worker does not know a ${String(kind)} build; recreate it to run the current code`);
    const read = await readTheDump(claimed, descriptor, progress, controller.signal, notes, clock, onPhase, figures);
    await close(read.result, read.said);
  } catch (error) {
    await fail(claimed, controller.signal, error, figures, notes);
  } finally {
    clearInterval(heart);
    stop.removeEventListener('abort', onStop);
  }
}

/**
 * What a worker says of a build it has no builder for. The panel checked the
 * builder in the backend, which runs the current code; a worker started before
 * the builder was merged has none (#1670).
 */
const noBuilder = (key: string) => `This dump worker has no builder for ${key}; restart it to run the current code`;

/** Verify the dump's file, or, for a `keep`, build from it and swap the result in. */
async function readTheDump(
  claimed: ClaimedBuild, descriptor: DumpDescriptor, progress: BuildProgressRecord, signal: AbortSignal, notes: string[],
  clock: PassClock, onPhase: (message: string) => boolean, figures: Figures,
): Promise<{ result: { bytes: number; lines: number; checksumActual: string | null }; said: string[] }> {
  const { kind, only, windowEnd } = claimed.request;
  const keeper = kind === 'keep' ? keeperOf(descriptor.key) : null;
  // Counting the file as a verify would end green with nothing kept.
  if (kind === 'keep' && !keeper) throw new Error(noBuilder(descriptor.key));
  if (keeper?.update && !only && await keeper.canUpdate?.()) return updateKept(claimed, keeper, descriptor, progress, signal, notes, clock, onPhase, figures);
  // A build the worker queued on a schedule only brings forward what is kept:
  // where that can no longer be done, it downloads nothing (ADR-0134 decision 6).
  if (claimed.request.scheduled) throw new Error('What is kept can no longer be brought forward, and a scheduled update downloads nothing: start a build by hand');
  onPhase(only ? `Finding ${only} on the host...` : 'Finding the newest complete file...');
  await beat(claimed.id, progress);
  const file = await resolveFile(descriptor, signal, only, windowEnd);
  await recordFile(claimed.id, file);
  progress.phase = 'reading';
  onPhase(`Reading ${file.fileName}${dumpsDir() ? ' into the local copy' : ' from the host'}...`);
  const options = readOptions(descriptor, progress, signal, notes, clock, file.expectedBytes, figures);
  const built = keeper
    ? await keeper.build(file, {
      ...options,
      buildId: claimed.id,
      ...(windowEnd ? { windowEnd } : {}),
      // A new step: a pass starts its own clock, and a step that reads no file has no estimate.
      onPhase: message => { if (onPhase(message)) { progress.etaSeconds = null; clock.reset(); } },
      onMeasure: (read, total) => {
        progress.read = read;
        progress.total = total;
        progress.etaSeconds = clock.observe(read, total, Date.now());
      },
    })
    : null;
  const result = built ?? (file.compression === 'none' ? await holdVerifiedCopy(file, options) : await readDump(file, countLines(), options));
  const said = [verifiedMessage(file, result.lines, result.checksumActual), ...(built ? ['built and swapped in', ...(built.summary ? [built.summary] : [])] : [])];
  return { result, said };
}

/**
 * Bring what the keeper holds forward from its own source (the OpenStreetMap
 * layer's current planet, #1437): no file of the host's is resolved, recorded
 * or said to be verified, since none is read.
 */
async function updateKept(
  claimed: ClaimedBuild, keeper: Keeper, descriptor: DumpDescriptor, progress: BuildProgressRecord, signal: AbortSignal, notes: string[],
  clock: PassClock, onPhase: (message: string) => boolean, figures: Figures,
): Promise<{ result: { bytes: number; lines: number; checksumActual: string | null }; said: string[] }> {
  progress.phase = 'reading';
  onPhase('Bringing what is kept forward...');
  await recordUpdate(claimed.id);
  await beat(claimed.id, progress);
  const built = await keeper.update!({
    ...readOptions(descriptor, progress, signal, notes, clock, null, figures),
    buildId: claimed.id,
    onPhase: message => { if (onPhase(message)) { progress.etaSeconds = null; clock.reset(); } },
  });
  return { result: built, said: ['brought forward and swapped in', ...(built.summary ? [built.summary] : [])] };
}

/** Derive the kept build's tables again from what it holds (#1526): there is no file to verify. */
async function rederive(
  claimed: ClaimedBuild, descriptor: DumpDescriptor, progress: BuildProgressRecord, signal: AbortSignal, notes: string[],
  onPhase: (message: string) => void,
): Promise<void> {
  const keeper = keeperOf(descriptor.key);
  if (!keeper?.rederive) throw new Error(noBuilder(descriptor.key));
  progress.phase = 'deriving';
  onPhase('Deriving the tables again from what is kept...');
  await beat(claimed.id, progress);
  await keeper.rederive({
    buildId: claimed.id,
    signal,
    onPhase,
    onNote: note => {
      notes.push(note);
      console.log(`[Dumps] ${descriptor.key}: ${note}`);
    },
  });
}

const GB = 1024 ** 3;
const gb = (bytes: number) => `${(bytes / GB).toFixed(1)} GB`;

/** The local directory a build of a local file needs: a deployment without one keeps no copy to read. */
function localDir(): string {
  const dir = dumpsDir();
  if (!dir) throw new Error('No local copy is kept here (DUMPS_DIR is not set)');
  return dir;
}

/** Cut a sample of the local copy `only` (#1527), and record it as the build's file. */
async function cutFrom(
  claimed: ClaimedBuild, descriptor: DumpDescriptor, progress: BuildProgressRecord, signal: AbortSignal, only: string | undefined,
  figures: Figures, onPhase: (message: string) => boolean,
): Promise<{ result: { bytes: number; lines: number; checksumActual: null }; said: string }> {
  if (!only) throw new Error('A sample is cut from a local copy, and none was named');
  progress.phase = 'reading';
  onPhase(`Cutting a sample of ${only}...`);
  await beat(claimed.id, progress);
  const cut = await cutSample(localDir(), only, {
    signal,
    onProgress: ({ read, taken, lines }) => {
      // The bar measures the entities taken against the sample's size; the row keeps the copy's bytes read.
      progress.read = taken;
      progress.total = SAMPLE_JSON_BYTES;
      progress.lines = lines;
      figures.bytes = read;
      figures.lines = lines;
      progress.message = `Cutting a sample of ${only}: ${gb(taken)} of ${gb(SAMPLE_JSON_BYTES)} of its entities...`;
    },
  });
  await recordFile(claimed.id, sampleFile(descriptor.key, cut.sample));
  return {
    result: { bytes: cut.read, lines: cut.lines, checksumActual: null },
    said: `cut ${cut.sample.fileName} (${gb(cut.sample.bytes)}, ${cut.lines.toLocaleString('en')} lines) from the first ${gb(cut.read)} of ${only}`,
  };
}

/** Run the dump's builder on the sample `only` and keep nothing (#1527). */
async function tryOnSample(
  claimed: ClaimedBuild, descriptor: DumpDescriptor, progress: BuildProgressRecord, signal: AbortSignal, notes: string[],
  clock: PassClock, onPhase: (message: string) => boolean, only: string | undefined, figures: Figures,
): Promise<{ bytes: number; lines: number; checksumActual: string | null; summary?: string }> {
  const keeper = keeperOf(descriptor.key);
  if (!keeper) throw new Error(noBuilder(descriptor.key));
  if (!only) throw new Error('A trial reads a sample, and none was named');
  const dir = localDir();
  const sample = await sampleIn(dir, only);
  const file = sampleFile(descriptor.key, sample);
  await recordFile(claimed.id, file);
  progress.phase = 'reading';
  onPhase(`Reading ${only}...`);
  const options = readOptions(descriptor, progress, signal, notes, clock, file.expectedBytes, figures);
  return keeper.build(file, {
    ...options,
    held: true,
    trial: true,
    buildId: claimed.id,
    onPhase: message => { if (onPhase(message)) { progress.etaSeconds = null; clock.reset(); } },
      onMeasure: (read, total) => {
        progress.read = read;
        progress.total = total;
        progress.etaSeconds = clock.observe(read, total, Date.now());
      },
  });
}

/** Close a build that did not end verified; what it did on the way (an older copy removed) is kept in its message. */
async function fail(claimed: ClaimedBuild, signal: AbortSignal, error: unknown, figures: Figures, notes: string[]): Promise<void> {
  const reason: unknown = signal.aborted ? signal.reason : error;
  const cancelled = signal.aborted && !(reason instanceof WorkerStopping);
  const status = cancelled ? 'cancelled' : 'failed';
  const message = [reason instanceof Error ? reason.message : String(reason), ...notes].join('; ');
  console.error('[Dumps] A build ended without a verified file:', claimed.dump, status, error);
  await closeBuild(claimed.id, { status, bytes: figures.bytes, lines: figures.lines, checksumActual: null, error: message })
    .catch(err => console.error('[Dumps] Could not close the build row:', err));
}
