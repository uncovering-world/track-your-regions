/**
 * A local copy brought to full size over several ranged connections (#1455).
 * `dumps.wikimedia.org` serves about 5 MB/s per connection and allows three,
 * so one connection took about 8 hours over the 156 GB entities dump where
 * three took under 3.
 *
 * The bytes go to `<file>.part`, each range written at its own offset, and
 * what each range has reached is kept in `<file>.part.json`, so a cut download
 * resumes every range where it stopped. The file takes its own name only once
 * every range is complete: a copy at the host's full size is read as whole,
 * and a sparse file with holes in it never has that name.
 */

import { open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import type { Readable } from 'node:stream';

interface Range {
  /** The next byte this range writes. */
  next: number;
  /** The byte after this range's last. */
  end: number;
}

interface PartState {
  size: number;
  ranges: Range[];
}

export interface RangedDownload {
  url: string;
  /** The bytes `from`–`to` inclusive of the file, over one of the host's connections (`openStream`). */
  openRange: (signal: AbortSignal, from: number, to: number) => Promise<Readable>;
  path: string;
  /** The host's size of the file. */
  expected: number;
  /** What a copy downloaded in order before already holds, from byte 0. */
  have: number;
  signal: AbortSignal;
  onBytes: (n: number) => void;
  connections: number;
  /** The shortest range worth its own connection; below it a file is fetched over fewer. */
  minRange?: number;
}

/** How many bytes a range writes between two saves of where it has got to. */
const SAVE_EVERY = 64 * 1024 * 1024;

const partOf = (path: string) => `${path}.part`;
const stateOf = (path: string) => `${path}.part.json`;

/** Split `[from, size)` into at most `count` ranges of about equal length, none shorter than `minRange` but one. */
export function splitRanges(from: number, size: number, count: number, minRange = SAVE_EVERY): Range[] {
  const remaining = size - from;
  if (remaining <= 0) return [];
  const parts = Math.max(1, Math.min(count, Math.floor(remaining / minRange)));
  const step = Math.ceil(remaining / parts);
  const ranges: Range[] = [];
  for (let next = from; next < size; next += step) ranges.push({ next, end: Math.min(size, next + step) });
  return ranges;
}

async function readState(path: string, expected: number): Promise<PartState | null> {
  const state = await readFile(stateOf(path), 'utf8').then(text => JSON.parse(text) as PartState).catch(() => null);
  if (!state || state.size !== expected) return null;
  const part = await stat(partOf(path)).catch(() => null);
  return part ? state : null;
}

/**
 * Written aside and renamed over the old state: a state cut short by a kill or
 * a full disk would read as none, and the copy would be started again.
 */
async function writeState(path: string, state: PartState): Promise<void> {
  await writeFile(`${stateOf(path)}.tmp`, JSON.stringify(state));
  await rename(`${stateOf(path)}.tmp`, stateOf(path));
}

/**
 * The ranges to fetch: those of a download in progress, or new ones over what
 * is left. The state is written before an in-order copy takes the part's name:
 * a state with no part reads as none, a part with no state would be deleted.
 */
async function startOrResume(job: RangedDownload): Promise<PartState> {
  const resumed = await readState(job.path, job.expected);
  if (resumed) return resumed;
  await rm(partOf(job.path), { force: true });
  const state = { size: job.expected, ranges: splitRanges(job.have, job.expected, job.connections, job.minRange) };
  await writeState(job.path, state);
  if (job.have > 0) await rename(job.path, partOf(job.path));
  else await writeFile(partOf(job.path), '');
  return state;
}

export async function downloadRanges(job: RangedDownload): Promise<number> {
  const state = await startOrResume(job);
  const done = job.expected - state.ranges.reduce((sum, range) => sum + (range.end - range.next), 0);
  if (done > 0) job.onBytes(done);
  // One range failing stops the others; where each got to is saved either way.
  const stop = new AbortController();
  const signal = AbortSignal.any([job.signal, stop.signal]);
  let saving = Promise.resolve();
  const save = () => {
    saving = saving.then(() => writeState(job.path, state)).catch(() => undefined);
    return saving;
  };
  const file = await open(partOf(job.path), 'r+');
  let outcomes: PromiseSettledResult<void>[];
  try {
    // Every range is let stop before the file closes and the state is saved,
    // so no write lands after the save or on a closed file.
    outcomes = await Promise.allSettled(state.ranges.map(range => fetchRange(job, range, file, signal, save).catch((error: unknown) => {
      stop.abort(error);
      throw error;
    })));
  } finally {
    await file.close();
    await save();
  }
  const failed = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected');
  // The range that failed first is the cause; the others stopped because of it.
  if (failed) throw stop.signal.aborted ? stop.signal.reason : failed.reason;
  await rename(partOf(job.path), job.path);
  await rm(stateOf(job.path), { force: true });
  return job.expected;
}

async function fetchRange(
  job: RangedDownload, range: Range, file: Awaited<ReturnType<typeof open>>, signal: AbortSignal, save: () => Promise<void>,
): Promise<void> {
  if (range.next >= range.end) return;
  const source = await job.openRange(signal, range.next, range.end - 1);
  let unsaved = 0;
  try {
    for await (const chunk of source as AsyncIterable<Buffer>) {
      const take = Math.min(chunk.length, range.end - range.next);
      await file.write(chunk, 0, take, range.next);
      range.next += take;
      job.onBytes(take);
      unsaved += take;
      if (unsaved >= SAVE_EVERY) {
        unsaved = 0;
        await save();
      }
    }
  } finally {
    source.destroy();
  }
  if (range.next < range.end) throw new Error(`${job.url}: a range ended at byte ${range.next} of ${range.end}`);
}

/**
 * How many bytes of the file a download in progress already holds: what its
 * saved ranges reached, or, with none, a copy written in order (`path`).
 * The `.part` itself is sparse, written at offsets, so its size says nothing.
 */
export async function bytesHeld(path: string, expected: number): Promise<number> {
  const state = await readState(path, expected);
  if (state) return expected - state.ranges.reduce((sum, range) => sum + (range.end - range.next), 0);
  return stat(path).then(s => s.size).catch(() => 0);
}
