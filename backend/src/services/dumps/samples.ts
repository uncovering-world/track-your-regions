/**
 * A sample of a dump: the first `SAMPLE_JSON_BYTES` of a local copy's
 * entities, closed as a valid JSON array and gzipped, kept beside the copy in
 * `DUMPS_DIR` (#1527). A trial build reads it the way a build reads the dump,
 * so a change to the build is tried end to end in minutes instead of the
 * hours the whole file takes.
 *
 * A sample is named `sample-<size>-<copy's name>`: it is no copy of the dump,
 * so the catalog's test for the dump's files refuses it, `copyOf` reads no
 * date from it, and nothing that replaces or removes older copies touches it.
 */

import { once } from 'node:events';
import { createReadStream, createWriteStream } from 'node:fs';
import { readdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';
import { safeFileName, type DumpFile, type DumpKey } from './catalog.js';
import { copyOf } from './localCopies.js';

/**
 * The JSON a sample keeps. The dump begins with the oldest items, which are
 * among the largest, so a sample keeps fewer of them than its share of the
 * file would say.
 */
export const SAMPLE_JSON_BYTES = 4 * 1024 ** 3;

const SAMPLE_NAME = /^sample-(\d+)gb-(.+)$/;

/** The sample's name for a cut of `copyName`. */
export function sampleName(copyName: string, jsonBytes = SAMPLE_JSON_BYTES): string {
  return safeFileName(`sample-${Math.round(jsonBytes / 1024 ** 3)}gb-${copyName}`);
}

export interface Sample {
  fileName: string;
  /** The local copy it was cut from. */
  of: string;
  /** The dump's date, `YYYY-MM-DD`, as the copy's name gives it. */
  date: string;
  bytes: number;
}

/** What a sample's name says: the copy it was cut from and that copy's date; null for any other name. */
export function sampleOf(name: string): Omit<Sample, 'bytes'> | null {
  const match = SAMPLE_NAME.exec(name);
  const copy = match ? copyOf(match[2]) : null;
  if (!match || !copy || copy.date.length !== 8) return null;
  return { fileName: name, of: match[2], date: `${copy.date.slice(0, 4)}-${copy.date.slice(4, 6)}-${copy.date.slice(6, 8)}` };
}

/** The newest sample in `dir` cut from a file of the dump (`isFileName`), or null. */
export async function newestSample(dir: string, isFileName: (name: string) => boolean): Promise<Sample | null> {
  const names = await readdir(dir).catch(() => [] as string[]);
  const samples = names.map(sampleOf).filter((s): s is Omit<Sample, 'bytes'> => s !== null && isFileName(s.of))
    .sort((a, b) => b.date.localeCompare(a.date) || b.fileName.localeCompare(a.fileName));
  const newest = samples[0];
  if (!newest) return null;
  const bytes = await stat(join(dir, newest.fileName)).then(s => s.size).catch(() => null);
  return bytes === null ? null : { ...newest, bytes };
}

/** The sample `name` in `dir`; refuses a name that is no sample, or one not there. */
export async function sampleIn(dir: string, name: string): Promise<Sample> {
  const sample = sampleOf(safeFileName(name));
  if (!sample) throw new Error(`${name} is not a sample of a dump`);
  const bytes = await stat(join(dir, name)).then(s => s.size).catch(() => null);
  if (bytes === null) throw new Error(`There is no sample ${name}: cut one first`);
  return { ...sample, bytes };
}

/**
 * The sample as a file a build reads: on disk and nowhere else, so it has no
 * URL and no published checksum, and its size on disk is what the read
 * checks along with a clean end of the gzip stream.
 */
export function sampleFile(key: DumpKey, sample: Sample): DumpFile {
  return { key, fileName: sample.fileName, url: '', date: sample.date, checksum: null, expectedBytes: sample.bytes, compression: 'gzip' };
}

const NEWLINE = 0x0a;
const COMMA = 0x2c;

/**
 * Takes the dump's text until `limit` bytes have gone by, then to the end of
 * the line it is in, and closes the array there: the last line loses its
 * trailing comma and a `]` line follows. A dump shorter than the limit is
 * taken whole, already closed.
 */
export class CutAt {
  taken = 0;
  lines = 0;
  done = false;
  /** A comma that ended the last chunk, held back in case the next one ends its line there. */
  private held: Buffer | null = null;

  constructor(private readonly limit: number) {}

  /** What of `chunk` goes into the sample; after the cut, nothing. */
  take(chunk: Buffer): Buffer[] {
    if (this.done) return [];
    const data = this.held ? Buffer.concat([this.held, chunk]) : chunk;
    this.held = null;
    const from = Math.max(0, this.limit - this.taken);
    const end = from < data.length ? data.indexOf(NEWLINE, from) : -1;
    if (end === -1) {
      const out = data.length > 0 && data[data.length - 1] === COMMA ? data.subarray(0, data.length - 1) : data;
      if (out !== data) this.held = data.subarray(data.length - 1);
      this.count(out);
      return [out];
    }
    const last = end > 0 && data[end - 1] === COMMA ? end - 1 : end;
    this.count(data.subarray(0, end + 1));
    this.done = true;
    return [data.subarray(0, last), Buffer.from('\n]\n')];
  }

  /** What is left once the text has ended before the cut: the dump was shorter than the limit. */
  rest(): Buffer[] {
    const held = this.held;
    this.held = null;
    return held ? [held] : [];
  }

  private count(bytes: Buffer): void {
    this.taken += bytes.length;
    for (let i = bytes.indexOf(NEWLINE); i !== -1; i = bytes.indexOf(NEWLINE, i + 1)) this.lines += 1;
  }
}

export interface CutResult {
  sample: Sample;
  lines: number;
  /** The compressed bytes of the copy read to cut it. */
  read: number;
}

/**
 * The samples in `dir` of the dump `copyName` is a copy of, other than
 * `keep`, with what a build of each left beside it: what a new cut replaces,
 * so the directory holds one sample of a dump as it holds one copy.
 */
async function otherSamples(dir: string, copyName: string, keep: string): Promise<string[]> {
  const dump = copyOf(copyName)?.dump;
  const names = await readdir(dir).catch(() => [] as string[]);
  return names.filter(name => {
    const sample = sampleOf(name);
    return sample !== null && copyOf(sample.of)?.dump === dump && !name.startsWith(keep);
  });
}

/**
 * Cut a sample of `jsonBytes` from the local copy `copyName` in `dir`,
 * written beside it under a temporary name and renamed once whole, so a cut
 * stopped half way leaves no sample a trial would read. The copy is read only
 * as far as the cut. The dump's earlier samples, and what builds of them
 * left beside them, are removed once the new one is whole.
 */
export async function cutSample(
  dir: string, copyName: string,
  { signal, jsonBytes = SAMPLE_JSON_BYTES, onProgress }:
  { signal: AbortSignal; jsonBytes?: number; onProgress?: (p: { read: number; taken: number; lines: number }) => void },
): Promise<CutResult> {
  const name = sampleName(copyName, jsonBytes);
  const path = join(dir, name);
  const part = `${path}.part`;
  const reader = createReadStream(join(dir, safeFileName(copyName)));
  const gunzip = createGunzip();
  reader.once('error', error => gunzip.destroy(error));
  const text = reader.pipe(gunzip);
  const gzip = createGzip({ level: 1 });
  const written = pipeline(gzip, createWriteStream(part), { signal });
  written.catch(() => undefined);
  const cut = new CutAt(jsonBytes);
  const tick = setInterval(() => onProgress?.({ read: reader.bytesRead, taken: cut.taken, lines: cut.lines }), 1000);
  try {
    for await (const chunk of text) {
      signal.throwIfAborted();
      for (const piece of cut.take(chunk as Buffer)) {
        // A write the disk is slow to take waits for it; a failed write ends the wait.
        if (!gzip.write(piece)) await Promise.race([once(gzip, 'drain'), written]);
      }
      if (cut.done) break;
    }
    for (const piece of cut.rest()) gzip.write(piece);
    gzip.end();
    await written;
    await rename(part, path);
    for (const other of await otherSamples(dir, copyName, name)) await rm(join(dir, other), { force: true });
  } catch (error) {
    gzip.destroy();
    await rm(part, { force: true });
    throw error;
  } finally {
    clearInterval(tick);
    reader.destroy();
    gunzip.destroy();
  }
  const bytes = (await stat(path)).size;
  return { sample: { ...sampleOf(name)!, bytes }, lines: cut.lines, read: reader.bytesRead };
}
