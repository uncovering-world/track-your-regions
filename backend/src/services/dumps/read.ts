/**
 * Read a dump file line by line into a consumer, and let the consumer keep
 * what it built only once the file is verified (ADR-0101 decision 4).
 *
 * The compressed bytes pass through a hash on their way to the decompressor,
 * so a stream is verified without being stored: against the host's published
 * checksum where there is one, and otherwise against the host's size and a
 * clean end of the compressed stream. A stream cut short reads as a clean end
 * of file to a line reader (ADR-0055 measured it), so neither alone would do:
 * the decompressor fails on a truncated gzip or bzip2 stream, and the size
 * catches a cut that happens to fall on a block boundary.
 *
 * A local copy, where one is configured (`DUMPS_DIR`), is brought to full size
 * first, resuming a cut download, and read from disk; otherwise the file is
 * read straight from the host. A local copy that is not the host's file is
 * deleted, since a copy at full size is never downloaded again.
 *
 * A binary file that a tool reads whole (the planet's PBF, ADR-0134) is never
 * read by lines: `holdVerifiedCopy` brings its local copy to full size and
 * verifies it from disk, and the build hands the tool the path.
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { PassThrough, Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { dumpNamed, safeFileName, type DumpFile } from './catalog.js';
import { downloadTo, openStream } from './fetch.js';
import { freeBytes, olderCopies, removeCopies } from './localCopies.js';
import { bytesHeld } from './rangedDownload.js';

/** What a build does with the lines: kept only after `commit`, dropped by `abort`. */
export interface DumpConsumer {
  line(text: string): void | Promise<void>;
  /**
   * A consumer that splits the lines itself, in worker threads (#1479): the
   * read hands it the decompressed text in pieces of several megabytes, each
   * ending at a line's end and owning its memory, so a piece can be handed to
   * a worker whole; `line` is then never called, and `lineCount` says how
   * many lines it has taken so far. `piece` numbers the pieces in the order
   * of the file, and a read of the same file cuts the same pieces (#1493), so
   * a consumer can know which it has already done.
   */
  chunk?(text: Uint8Array, piece: number): Promise<void>;
  lineCount?(): number;
  commit(): Promise<void>;
  abort(): Promise<void>;
}

export interface ReadOptions {
  /** A directory to keep the file in; absent, the file is read as a stream from the host. */
  dumpsDir?: string;
  signal: AbortSignal;
  onProgress?: (progress: { downloaded: number; read: number; lines: number }) => void;
  /** Something the build did beside reading that its admin should be told: an older copy removed. */
  onNote?: (note: string) => void;
  /** The grid a chunk consumer's pieces are cut on; `PIECE_BYTES` unless a spec needs small pieces. */
  pieceBytes?: number;
  /**
   * The file is in `dumpsDir` and nowhere else, as a sample is (#1527): it is
   * read as it is, never downloaded, and no older copy of the dump is
   * removed for it.
   */
  held?: boolean;
}

export interface ReadResult {
  bytes: number;
  lines: number;
  checksumActual: string | null;
}

/** How often, in lines, progress is reported and the cancel flag is looked at. */
const PROGRESS_EVERY = 100_000;
/** The size of the pieces the gzip decoder writes. */
const GUNZIP_CHUNK = 1 << 20;
/** The grid a chunk consumer's pieces are cut on: a piece is about this size, give or take a line. */
export const PIECE_BYTES = 8 << 20;

/** The bytes read are not the host's file: a checksum or size mismatch, or a stream the decoder refused. */
class DamagedFile extends Error {}

/** zlib names its refusals of a damaged or truncated stream `Z_DATA_ERROR`, `Z_BUF_ERROR`, ... */
const isDamage = (error: unknown) =>
  error instanceof DamagedFile || /^Z_/.test(String((error as NodeJS.ErrnoException | null)?.code ?? ''));

/** Whether a read failed because the file is not the host's: what a consumer must not pick up after (#1493). */
export const isDamagedRead = (error: unknown): boolean =>
  isDamage(error) || isDamage((error as { cause?: unknown } | null)?.cause);

interface Decompressor {
  input: NodeJS.WritableStream;
  output: Readable;
  /** Settles when the decoder ended: rejected when it refused the stream. */
  done: Promise<void>;
  /** Ends the decoder now: a read that failed or was cancelled leaves no process behind. */
  stop(): void;
}

function decompressor(kind: Exclude<DumpFile['compression'], 'none'>): Decompressor {
  if (kind === 'gzip') {
    // In megabyte pieces: at zlib's default 16 KB the image's Node 22 decoded
    // the entities dump at 207 MB/s, at 1 MB at 392 MB/s, and the decoder is
    // what bounds a pass once its work runs in worker threads (#1479).
    const gunzip = createGunzip({ chunkSize: GUNZIP_CHUNK });
    return { input: gunzip, output: gunzip, done: Promise.resolve(), stop: () => gunzip.destroy() };
  }
  // bzip2 is a child process: the worker's image installs only bzip2, no
  // parallel decoder (backend/Dockerfile), and Node has no bzip2 of its own. Its exit code is what
  // says the stream ended cleanly.
  // By its absolute path: a decoder found through PATH is whatever PATH names.
  const child = spawn('/usr/bin/bzip2', ['-dc'], { stdio: ['pipe', 'pipe', 'pipe'] });
  const done = new Promise<void>((resolve, reject) => {
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', code => (code === 0 ? resolve() : reject(new DamagedFile(`bzip2 failed (${code}): ${stderr.trim()}`))));
  });
  const stop = () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  };
  return { input: child.stdin, output: child.stdout, done, stop };
}

/** Where the local copy of `file` is kept, or null when the file is streamed. */
const localPath = (file: DumpFile, options: ReadOptions) =>
  (options.dumpsDir ? join(options.dumpsDir, safeFileName(file.fileName)) : null);

/**
 * Remove the older copies of the dump before the download when the disk
 * cannot hold what is left of this one beside them (#1456).
 */
async function makeRoom(file: DumpFile, dir: string, path: string, options: ReadOptions): Promise<void> {
  if (file.expectedBytes === null) return;
  const older = await olderCopies(dir, file.fileName, fileNamesOf(file));
  if (older.length === 0) return;
  const have = await bytesHeld(path, file.expectedBytes);
  if (await freeBytes(dir) >= file.expectedBytes - have) return;
  await removeCopies(dir, older);
  options.onNote?.(`removed ${older.join(', ')} first: the disk could not hold ${file.fileName} beside it`);
}

/** The catalog's test for the dump's files, where the dump is one a newer file replaces; else none passes. */
function fileNamesOf(file: DumpFile): (name: string) => boolean {
  const descriptor = dumpNamed(file.key);
  return descriptor?.datedBy === 'day' ? descriptor.isFileName : () => false;
}

/** The file's compressed bytes: a local copy brought to full size first, or the host's stream. */
async function openSource(file: DumpFile, path: string | null, options: ReadOptions, onDownloaded: (n: number) => void): Promise<Readable> {
  if (!path) return openStream(file.url, options.signal);
  if (options.held) return createReadStream(path);
  await makeRoom(file, options.dumpsDir!, path, options);
  await downloadTo(file.url, path, options.signal, onDownloaded);
  return createReadStream(path);
}

/** The published checksum, or the host's size where none is published; throws on a mismatch. */
function verify(file: DumpFile, bytes: number, checksumActual: string | null): void {
  if (file.checksum && checksumActual !== file.checksum.value) {
    throw new DamagedFile(`${file.fileName}: ${file.checksum.kind} ${checksumActual} is not the published ${file.checksum.value}`);
  }
  if (file.expectedBytes !== null && bytes !== file.expectedBytes) {
    throw new DamagedFile(`${file.fileName}: read ${bytes} bytes of the host's ${file.expectedBytes}`);
  }
}

export async function readDump(file: DumpFile, consumer: DumpConsumer, options: ReadOptions): Promise<ReadResult> {
  if (file.compression === 'none') throw new Error(`${file.fileName} is read whole by a tool, not by lines: hold a verified copy of it`);
  const path = localPath(file, options);
  let downloaded = 0;
  let source: Readable | undefined;
  try {
    source = await openSource(file, path, options, n => {
      downloaded += n;
      options.onProgress?.({ downloaded, read: 0, lines: 0 });
    });
    const result = await readSource(file, file.compression, source, consumer, options, () => downloaded);
    if (options.dumpsDir && !options.held) await retireOlderCopies(file, options.dumpsDir, options);
    return result;
  } catch (error) {
    source?.destroy();
    await consumer.abort();
    throw await withDamagedCopyDeleted(error, path, options);
  }
}

/** How many chunks of a copy are hashed between two progress reports and cancel checks. */
const HASH_REPORT_EVERY = 256;

/**
 * A binary file a tool reads whole (`compression: 'none'`): its local copy
 * brought to full size, then read from disk through the checksum and verified
 * against the host's checksum and size, as `readDump` verifies a stream.
 * Answers the copy's path. A copy that is not the host's file is deleted.
 */
export async function holdVerifiedCopy(file: DumpFile, options: ReadOptions): Promise<ReadResult & { path: string }> {
  const { signal } = options;
  if (file.compression !== 'none') throw new Error(`${file.fileName} is read by lines, through readDump`);
  const path = localPath(file, options);
  if (!path) throw new Error(`${file.fileName} is read whole by a tool, so it needs a local copy (DUMPS_DIR is not set)`);
  let downloaded = 0;
  try {
    if (!options.held) {
      await makeRoom(file, options.dumpsDir!, path, options);
      await downloadTo(file.url, path, signal, n => {
        downloaded += n;
        options.onProgress?.({ downloaded, read: 0, lines: 0 });
      });
    }
    const hash = file.checksum ? createHash(file.checksum.kind) : null;
    let bytes = 0;
    let chunks = 0;
    for await (const chunk of createReadStream(path, { signal })) {
      hash?.update(chunk as Buffer);
      bytes += (chunk as Buffer).length;
      chunks += 1;
      if (chunks % HASH_REPORT_EVERY === 0) options.onProgress?.({ downloaded, read: bytes, lines: 0 });
    }
    const checksumActual = hash ? hash.digest('hex') : null;
    verify(file, bytes, checksumActual);
    if (!options.held) await retireOlderCopies(file, options.dumpsDir!, options);
    return { bytes, lines: 0, checksumActual, path };
  } catch (error) {
    throw await withDamagedCopyDeleted(error, path, options);
  }
}

/**
 * The error a failed read ends with: where the local copy is not the host's
 * file, the copy is deleted first and the message says so, since a copy at
 * full size is never downloaded again.
 */
async function withDamagedCopyDeleted(error: unknown, path: string | null, options: ReadOptions): Promise<unknown> {
  if (!path || !isDamage(error) || options.signal.aborted) return error;
  await rm(path, { force: true });
  const next = options.held ? 'cut it again to read it' : 'the next build downloads it again';
  return new Error(`${(error as Error).message}; the local copy was deleted, and ${next}`, { cause: error });
}

/** Once a copy is verified, the older copies of its dump go: two copies of the entities dump do not fit where one does. */
async function retireOlderCopies(file: DumpFile, dir: string, options: ReadOptions): Promise<void> {
  const older = await olderCopies(dir, file.fileName, fileNamesOf(file));
  if (older.length === 0) return;
  // The read is verified and committed: a copy that cannot be removed is said, never a failed build.
  try {
    await removeCopies(dir, older);
    options.onNote?.(`removed the older ${older.join(', ')}`);
  } catch (error) {
    options.onNote?.(`could not remove the older ${older.join(', ')}: ${(error as Error).message}`);
  }
}

/** Read `source` through its decoder, which is stopped when the read fails. */
async function readSource(
  file: DumpFile, compression: Exclude<DumpFile['compression'], 'none'>, source: Readable, consumer: DumpConsumer,
  options: ReadOptions, downloaded: () => number,
): Promise<ReadResult> {
  const decoder = decompressor(compression);
  try {
    return await decode(file, source, decoder, consumer, options, downloaded);
  } catch (error) {
    decoder.stop();
    throw error;
  }
}

/** Decode, hash and count `source` into the consumer, and commit once the file is verified. */
async function decode(
  file: DumpFile, source: Readable, decoder: Decompressor, consumer: DumpConsumer, options: ReadOptions, downloaded: () => number,
): Promise<ReadResult> {
  const { signal } = options;
  const hash = file.checksum ? createHash(file.checksum.kind) : null;
  let bytes = 0;
  const tap = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash?.update(chunk);
      bytes += chunk.length;
      callback(null, chunk);
    },
  });
  const { input, output, done: decoded } = decoder;
  const text = new PassThrough();
  const fed = pipeline(source, tap, input as NodeJS.WritableStream, { signal });
  const drained = pipeline(output, text, { signal });
  // Awaited together below; a consumer that throws first must not leave them unhandled.
  for (const stage of [fed, drained, decoded]) stage.catch(() => undefined);

  const progress = (lines: number) => {
    if (signal.aborted) throw new Error('Cancelled');
    options.onProgress?.({ downloaded: downloaded(), read: bytes, lines });
  };
  const lines = consumer.chunk
    ? await feedChunks(text, consumer as ChunkConsumer, progress, options.pieceBytes ?? PIECE_BYTES)
    : await feedLines(text, consumer, progress);
  // The decoder's own verdict first: a bzip2 that refused the stream also
  // breaks the pipe that fed it, and that error says less.
  await decoded;
  await Promise.all([fed, drained]);
  if (signal.aborted) throw new Error('Cancelled');
  const checksumActual = hash ? hash.digest('hex') : null;
  verify(file, bytes, checksumActual);
  await consumer.commit();
  // A chunk consumer counts a piece's lines once a worker has answered for
  // it, so its count is whole only after the commit has waited for them all.
  return { bytes, lines: consumer.lineCount ? consumer.lineCount() : lines, checksumActual };
}

/** Hand the consumer every line, one call each; answers how many there were. */
async function feedLines(text: Readable, consumer: DumpConsumer, progress: (lines: number) => void): Promise<number> {
  let lines = 0;
  const reader = createInterface({ input: text, crlfDelay: Infinity });
  try {
    for await (const line of reader) {
      await consumer.line(line);
      lines += 1;
      if (lines % PROGRESS_EVERY === 0) progress(lines);
    }
  } finally {
    // A loop left early (a consumer that threw, a cancel) is followed by the
    // decoder being stopped, which breaks the text stream; the line reader
    // re-emits that as 'error' with nobody listening any more, and an
    // unheard 'error' ends the process with the error that stopped the read
    // unrecorded. The error that counts is the one already thrown.
    reader.on('error', () => undefined);
    reader.close();
  }
  return lines;
}

type ChunkConsumer = DumpConsumer & Required<Pick<DumpConsumer, 'chunk' | 'lineCount'>>;

/**
 * Hand the consumer the text in pieces, each ending at a line's end and in
 * memory of its own (a worker can be given it without a copy). A piece ends
 * at the first line end at or past the next multiple of `pieceBytes` in the
 * text: a fixed grid, so a read of the same file cuts the same pieces with
 * the same numbers whatever sizes the decoder hands over, and a build can
 * pick up after the pieces it already wrote (#1493). Answers how many lines
 * the consumer took.
 */
async function feedChunks(
  text: Readable, consumer: ChunkConsumer, progress: (lines: number) => void, pieceBytes: number,
): Promise<number> {
  let gathered: Buffer[] = [];
  let size = 0;
  /** Bytes of text handed over so far: where the next piece starts. */
  let handed = 0;
  let piece = 0;
  /** Hand over the next piece if the text gathered reaches its end; answers whether it did. */
  const hand = async (final: boolean): Promise<boolean> => {
    if (size === 0) return false;
    // Nothing is joined before the text reaches the grid point: the decoder hands over 1 MB at a time.
    if (!final && handed + size < (piece + 1) * pieceBytes) return false;
    const whole = gathered.length === 1 ? gathered[0] : Buffer.concat(gathered, size);
    let end = size;
    if (!final) {
      const gridAt = Math.max(0, (piece + 1) * pieceBytes - handed - 1);
      if (gridAt >= size) return false;
      end = whole.indexOf(10, gridAt) + 1;
      // The line that crosses the grid point is not whole yet.
      if (end === 0) {
        gathered = [whole];
        return false;
      }
    }
    const own = Buffer.allocUnsafeSlow(end);
    whole.copy(own, 0, 0, end);
    gathered = end < size ? [Buffer.from(whole.subarray(end))] : [];
    size -= end;
    handed += end;
    await consumer.chunk(own, piece);
    piece += 1;
    progress(consumer.lineCount());
    return true;
  };
  try {
    for await (const chunk of text) {
      gathered.push(chunk as Buffer);
      size += (chunk as Buffer).length;
      while (await hand(false));
    }
    await hand(true);
  } finally {
    // As in `feedLines`: a read left early stops the decoder, which breaks the
    // text stream; its late 'error' must not end the process.
    text.on('error', () => undefined);
  }
  return consumer.lineCount();
}

/** The verify build's consumer: counts the lines and keeps nothing. */
export function countLines(): DumpConsumer {
  return { line: () => undefined, commit: async () => undefined, abort: async () => undefined };
}
