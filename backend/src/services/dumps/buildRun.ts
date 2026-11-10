/**
 * Running one queued dump build in the dump worker (ADR-0106): the file is
 * resolved, the dump is read through the counting consumer (`verify`) or the
 * dump's builder (`keep`), and the row is closed with the outcome; a
 * `rederive` reads no file and runs the builder's derivation alone. Every
 * `BEAT_EVERY_MS` the build writes its progress and heartbeat to its row,
 * which is how the panel follows it, and learns whether an admin asked it to
 * stop. A build the network cut tries again after a pause, a bounded number of
 * times, from what its local copies hold (`RETRY_PAUSES_MS`, #2419), and a
 * failed build's row says in words what happened and that the copy in place
 * stands.
 */

import { setTimeout as sleep } from 'node:timers/promises';
import { dumpNamed, type DumpDescriptor, type DumpFile } from './catalog.js';
import { fetchText, hostFailure, sizeOf } from './fetch.js';
import { BEAT_EVERY_MS, beat, closeBuild, recordFile, recordUpdate, type BuildProgressRecord, type ClaimedBuild } from './ledger.js';
import { dumpsDir } from './buildQueue.js';
import { keeperOf, type Keeper } from './keepers.js';
import { PassClock } from './passClock.js';
import { countLines, CutDownload, holdVerifiedCopy, isDamagedRead, readDump, sizeWords, type ReadOptions } from './read.js';
import { cutSample, SAMPLE_JSON_BYTES, sampleFile, sampleIn } from './samples.js';
import { StepTimes } from './stepTimes.js';
import { waitWords, type RunsWait } from './swapGuard.js';

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
    onWaitForRuns: runs => waitForRuns(progress, runs),
  };
}

/**
 * Say on the row which runs the swap waits for (#2415), so a build behind a
 * long pass reads as waiting, not as stuck. Null ends the wait: a build that
 * waited says it is swapping in, which the subset's swap takes minutes to do.
 */
export function waitForRuns(progress: BuildProgressRecord, wait: RunsWait | null): void {
  const waited = !!progress.waitsFor;
  progress.waitsFor = wait ? wait.runs : null;
  if (wait) {
    progress.message = waitWords(wait.runs);
    progress.etaSeconds = null;
  } else if (waited) {
    progress.message = 'Swapping the new copy in...';
  }
}

/** Why a build stopped short: an admin's cancel, or the worker stopping. */
export class WorkerStopping extends Error {}

/**
 * The pauses before each new attempt of a build the network cut (#2419): three
 * more attempts, about 1, 5 and 15 minutes after the one before failed. A
 * build lasting through a router's restart or a host closing long connections
 * for a while ends verified instead of waiting for an admin to start it again.
 * Each attempt resumes the local copies from where they stopped, and reads the
 * files already whole from disk, so it asks the host only for what is left.
 */
export const RETRY_PAUSES_MS: readonly number[] = [60_000, 5 * 60_000, 15 * 60_000];

/**
 * Whether a build is worth trying again: the network cut it on its way to or
 * from the host. A damaged file, a host's refusal (4xx), a failure of the
 * build's own writes, a cancel or the worker stopping never is.
 */
const worthRetrying = (error: unknown, signal: AbortSignal): boolean =>
  !signal.aborted && !isDamagedRead(error) && (error instanceof CutDownload || hostFailure(error) !== null);


/** Where a cut read stopped: the file, and how much of it was on disk. */
interface CutAt {
  fileName: string;
  held: number;
}

/**
 * Whether a cut came after the build moved forward (#2440): another file than
 * the last cut's, or more of the same file on disk. A read with no local copy
 * keeps nothing of a file, so more bytes streamed is no progress there.
 * Counted from the build's start instead, attempts would run out on a build of
 * many large files, such as readership's twelve of about 5 GB, on a host that
 * cuts every few hundred megabytes.
 */
function movedOn(error: unknown, last: CutAt | null): boolean {
  if (!(error instanceof CutDownload) || !last) return false;
  return error.file.fileName !== last.fileName || (error.local && error.held > last.held);
}

/** The mark a cut leaves: the most of one file ever held, so a cut holding less than an earlier one is no new mark to pass. */
function cutMark(error: unknown, last: CutAt | null): CutAt | null {
  if (!(error instanceof CutDownload)) return last;
  const held = last?.fileName === error.file.fileName ? Math.max(last.held, error.held) : error.held;
  return { fileName: error.file.fileName, held };
}

/**
 * Run `attempt`, and again after each of `pauses` while the network is what
 * cut it. The pauses are counted from the build's last progress, so a build
 * fails only when the network cuts it four times with nothing gained between.
 * The row says it waits, when it tries again and why, so the panel shows a
 * retry, not a failure; `tries` counts every attempt made, for the words of a
 * build that fails anyway.
 */
async function retrying<T>(
  attempt: () => Promise<T>, claimed: ClaimedBuild, progress: BuildProgressRecord, signal: AbortSignal,
  pauses: readonly number[], tries: { made: number },
): Promise<T> {
  let sinceProgress = 0;
  let lastCut: CutAt | null = null;
  for (;;) {
    tries.made += 1;
    try {
      return await attempt();
    } catch (error) {
      sinceProgress = movedOn(error, lastCut) ? 1 : sinceProgress + 1;
      lastCut = cutMark(error, lastCut);
      const wait = dumpNamed(claimed.dump)?.retriesACut === false ? undefined : pauses[sinceProgress - 1];
      if (wait === undefined || !worthRetrying(error, signal)) throw error;
      await waitToRetry(claimed, progress, signal, { wait, next: sinceProgress + 1, of: pauses.length + 1, reason: (error as Error).message });
    }
  }
}

/**
 * Say on the row that the build waits to try again, when and why, and wait. A
 * cancel or a stopping worker that came while the row was written ends the
 * wait at once, with its own reason.
 */
async function waitToRetry(
  claimed: ClaimedBuild, progress: BuildProgressRecord, signal: AbortSignal,
  { wait, next, of, reason }: { wait: number; next: number; of: number; reason: string },
): Promise<void> {
  progress.retry = { at: new Date(Date.now() + wait).toISOString(), attempt: next, of, reason };
  const from = dumpsDir() ? 'from what is on disk' : 'from the start of the file';
  progress.message = `${reason}. Trying again ${from} (attempt ${next} of ${of}); the copy in place stands.`;
  progress.etaSeconds = null;
  console.log(`[Dumps] ${claimed.dump}: ${reason}; attempt ${next} in ${Math.round(wait / 1000)} s`);
  await beat(claimed.id, progress);
  await sleep(wait, undefined, { signal }).catch((cause: unknown) => {
    signal.throwIfAborted();
    throw cause;
  });
  progress.retry = null;
}

/**
 * Run the claimed build to its end and close its row. `stop` aborts it when
 * the worker itself stops: the row then says so, since the build will not go
 * on without being started again.
 */
export async function runBuild(claimed: ClaimedBuild, stop: AbortSignal, pauses: readonly number[] = RETRY_PAUSES_MS): Promise<void> {
  const controller = new AbortController();
  const onStop = () => controller.abort(new WorkerStopping('The dump worker stopped; start the build again.'));
  stop.addEventListener('abort', onStop, { once: true });
  const progress: BuildProgressRecord = {
    phase: 'resolving', message: 'Finding the newest complete file...', downloaded: 0, read: 0, lines: 0, etaSeconds: null,
  };
  const clock = new PassClock();
  const notes: string[] = [];
  const figures: Figures = { bytes: 0, lines: 0 };
  const tries = { made: 0 };
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
    const read = await retrying(
      () => readTheDump(claimed, descriptor, progress, controller.signal, notes, clock, onPhase, figures),
      claimed, progress, controller.signal, pauses, tries,
    );
    await close(read.result, read.said);
  } catch (error) {
    await fail(claimed, controller.signal, error, figures, notes, tries.made);
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

/**
 * The layer's scheduled update only brings forward what is kept: where that
 * can no longer be done, it downloads no weekly planet (ADR-0134 decision 6).
 * Every other copy's scheduled build reads its newest dump (ADR-0195).
 */
function refuseScheduledDownload(claimed: ClaimedBuild, keeper: Keeper | null): void {
  if (claimed.request.scheduled && keeper?.update) {
    throw new Error('What is kept can no longer be brought forward, and a scheduled update downloads nothing: start a build by hand');
  }
}

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
  refuseScheduledDownload(claimed, keeper);
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
    onWaitForRuns: runs => waitForRuns(progress, runs),
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

/** A dump's date as the admin reads it: the day of the dump, or the month its counts end on. */
function dateWords(date: string, datedBy: DumpDescriptor['datedBy']): string {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day || 1));
  return datedBy === 'month'
    ? value.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })
    : value.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/**
 * What a failed keeping build left in place, in words (#2419): a build is
 * swapped in only whole, so a failure changes nothing the runs read.
 */
async function copyInPlaceWords(claimed: ClaimedBuild): Promise<string | null> {
  if (claimed.request.kind !== 'keep') return null;
  const descriptor = dumpNamed(claimed.dump);
  const keeper = descriptor ? keeperOf(descriptor.key) : null;
  if (!descriptor || !keeper) return null;
  // A ledger that cannot be read leaves the sentence general, never the failure unclosed.
  const kept = await Promise.resolve().then(() => keeper.latest()).catch(() => undefined);
  if (kept === undefined) return 'The copy in place, if any, is unchanged';
  if (kept === null) return 'No copy is in place yet, so nothing changed for the runs';
  const from = descriptor.datedBy === 'month' ? 'the counts up to' : 'the dump of';
  const date = dateWords(kept.dumpDate, descriptor.datedBy);
  if (keeper.keepsAsItGoes) return `What this build kept before it failed stays kept, and the rest of the copy in place, up to ${date}, is unchanged and still read`;
  return `The copy in place, built from ${from} ${date}, is unchanged and still read`;
}

/** What the next build does after a build the network cut: it resumes from the copy on disk, or reads the file again. */
function nextBuildWords(error: unknown, tries: number): string | null {
  if (!(error instanceof CutDownload) && hostFailure(error) === null) return null;
  const tried = tries > 1 ? `It was tried ${tries} times. ` : '';
  if (error instanceof CutDownload && error.local && error.held > 0) {
    return `${tried}The next build resumes from the ${sizeWords(error.held)} of ${error.file.fileName} on disk`;
  }
  return dumpsDir() ? `${tried}The next build resumes from what is on disk` : `${tried}The next build reads its files from their start`;
}

/** Close a build that did not end verified; what it did on the way (an older copy removed) is kept in its message. */
async function fail(claimed: ClaimedBuild, signal: AbortSignal, error: unknown, figures: Figures, notes: string[], tries: number): Promise<void> {
  const reason: unknown = signal.aborted ? signal.reason : error;
  const cancelled = signal.aborted && !(reason instanceof WorkerStopping);
  const status = cancelled ? 'cancelled' : 'failed';
  const said = reason instanceof Error ? reason.message : String(reason);
  const more = cancelled ? [] : [nextBuildWords(reason, tries), await copyInPlaceWords(claimed)].filter((w): w is string => !!w);
  const message = [more.length > 0 ? `${[said.replace(/\.$/, ''), ...more].join('. ')}.` : said, ...notes].join('; ');
  console.error('[Dumps] A build ended without a verified file:', claimed.dump, status, error);
  await closeBuild(claimed.id, { status, bytes: figures.bytes, lines: figures.lines, checksumActual: null, error: message })
    .catch(err => console.error('[Dumps] Could not close the build row:', err));
}
