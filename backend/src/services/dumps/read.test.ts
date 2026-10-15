import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { DumpFile } from './catalog.js';
import { openStream } from './fetch.js';
import { countLines, readDump, type DumpConsumer } from './read.js';
import { ScopeReader } from './wikidata/scopeReader.js';

/**
 * The pipeline's reading and verifying (ADR-0101 decision 4), against a local
 * HTTP server that answers ranges the way the dump hosts do: a verified file
 * reaches its consumer's commit, and a wrong checksum, a cut stream or a short
 * file reaches its abort instead.
 */

const LINES = Array.from({ length: 2500 }, (_, i) => `{"id":"Q${i + 1}","labels":{}}`);
const TEXT = `${LINES.join('\n')}\n`;
const GZ = gzipSync(Buffer.from(TEXT));
const BZ2 = execFileSync('/usr/bin/bzip2', ['-c'], { input: Buffer.from(TEXT) });
// eslint-disable-next-line sonarjs/hashing -- the host publishes sha1 sums; this checks integrity, not security
const sha1 = (bytes: Buffer) => createHash('sha1').update(bytes).digest('hex');

const files = new Map<string, Buffer>([
  ['/whole.json.gz', GZ],
  ['/cut.json.gz', GZ.subarray(0, Math.floor(GZ.length / 2))],
  ['/whole.bz2', BZ2],
  ['/cut.bz2', BZ2.subarray(0, Math.floor(BZ2.length / 2))],
  ['/unsized.json.gz', GZ],
]);
/** Files whose size the host does not answer, as a HEAD with no Content-Length. */
const unsized = new Set(['/unsized.json.gz']);

let server: Server;
let base = '';
const ranges: string[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    const body = files.get(req.url ?? '');
    if (!body) { res.statusCode = 404; res.end(); return; }
    const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '');
    if (range) {
      ranges.push(req.headers.range!);
      const from = Number(range[1]);
      const to = range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
      if (from >= body.length) {
        res.writeHead(416, { 'Content-Range': `bytes */${body.length}` });
        res.end();
        return;
      }
      res.writeHead(206, { 'Content-Length': to - from + 1, 'Content-Range': `bytes ${from}-${to}/${body.length}` });
      res.end(req.method === 'HEAD' ? undefined : body.subarray(from, to + 1));
      return;
    }
    if (req.method === 'HEAD' && unsized.has(req.url ?? '')) {
      res.writeHead(200);
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Length': body.length });
    res.end(req.method === 'HEAD' ? undefined : body);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

const file = (path: string, over: Partial<DumpFile> = {}): DumpFile => ({
  key: 'wikidata-lexemes', fileName: path.slice(1), url: `${base}${path}`, date: '2026-10-07',
  checksum: null, expectedBytes: null, compression: path.endsWith('.bz2') ? 'bzip2' : 'gzip', ...over,
});

function recording(): DumpConsumer & { kept: string[]; outcome: string } {
  const seen: string[] = [];
  const consumer = {
    kept: [] as string[], outcome: 'open',
    line: (text: string) => { seen.push(text); },
    commit: async () => { consumer.kept = seen; consumer.outcome = 'committed'; },
    abort: async () => { consumer.outcome = 'aborted'; },
  };
  return consumer;
}

const signal = () => new AbortController().signal;

describe('reading a dump through the pipeline', () => {
  it('commits every line of a gzip file whose sha1 is the published one', async () => {
    const consumer = recording();
    const result = await readDump(file('/whole.json.gz', { checksum: { kind: 'sha1', value: sha1(GZ) }, expectedBytes: GZ.length }), consumer, { signal: signal() });
    expect(result).toEqual({ bytes: GZ.length, lines: LINES.length, checksumActual: sha1(GZ) });
    expect(consumer.outcome).toBe('committed');
    expect(consumer.kept).toEqual(LINES);
  });

  it('aborts a file whose sha1 is not the published one, whatever it read', async () => {
    const consumer = recording();
    await expect(readDump(file('/whole.json.gz', { checksum: { kind: 'sha1', value: '0'.repeat(40) } }), consumer, { signal: signal() }))
      .rejects.toThrow(/is not the published/);
    expect(consumer.outcome).toBe('aborted');
  });

  it('verifies a bzip2 file with no published checksum by its size and a clean end of stream', async () => {
    const consumer = recording();
    const result = await readDump(file('/whole.bz2', { expectedBytes: BZ2.length }), consumer, { signal: signal() });
    expect(result.lines).toBe(LINES.length);
    expect(consumer.outcome).toBe('committed');
  });

  it('hands a consumer that splits lines itself the text in pieces that end at a line end', async () => {
    for (const path of ['/whole.json.gz', '/whole.bz2']) {
      const consumer = recording();
      const pieces: Buffer[] = [];
      let taken = 0;
      const chunked = {
        ...consumer,
        line: () => { throw new Error('a chunk consumer is never handed a line'); },
        chunk: async (text: Uint8Array) => {
          expect(text.at(-1)).toBe(10);
          pieces.push(Buffer.from(text));
          taken += Buffer.from(text).toString().split('\n').length - 1;
        },
        lineCount: () => taken,
      };
      const result = await readDump(file(path, { expectedBytes: path.endsWith('.bz2') ? BZ2.length : GZ.length }), chunked, { signal: signal() });
      expect(Buffer.concat(pieces).toString()).toBe(TEXT);
      expect(result.lines).toBe(LINES.length);
      expect(consumer.outcome).toBe('committed');
    }
  });

  it('cuts the same numbered pieces on a fixed grid whatever sizes the decoder hands over (#1493)', async () => {
    const piecesOf = async (path: string) => {
      const pieces: Array<{ piece: number; text: string }> = [];
      const consumer = {
        ...recording(),
        chunk: async (text: Uint8Array, piece: number) => { pieces.push({ piece, text: Buffer.from(text).toString() }); },
        lineCount: () => 0,
      };
      await readDump(file(path), consumer, { signal: signal(), pieceBytes: 10_000 });
      return pieces;
    };
    const gz = await piecesOf('/whole.json.gz');
    expect(await piecesOf('/whole.bz2')).toEqual(gz);
    expect(gz.map(p => p.piece)).toEqual(gz.map((_, index) => index));
    expect(gz.map(p => p.text).join('')).toBe(TEXT);
    let start = 0;
    for (const { piece, text } of gz.slice(0, -1)) {
      const end = start + text.length;
      // Each piece ends at the first line end at or past its grid point.
      expect(text.endsWith('\n')).toBe(true);
      expect(end).toBeGreaterThanOrEqual((piece + 1) * 10_000);
      expect(TEXT.lastIndexOf('\n', end - 2) + 1).toBeLessThan((piece + 1) * 10_000);
      start = end;
    }
  });

  it("counts the lines a consumer in worker threads took once they have all answered", async () => {
    // Pieces still in flight when the read ends are counted by the commit's wait, not before it.
    const reader = new ScopeReader(2);
    const result = await readDump(file('/whole.json.gz', { expectedBytes: GZ.length }), reader, { signal: signal() });
    expect(result.lines).toBe(LINES.length);
  });

  it("rejects with the consumer's own error when it throws mid-file, and the process keeps running", async () => {
    // Stopping the decoder after the line loop has left must not reach the
    // line reader as an unhandled 'error' event: that ended the whole backend
    // and lost the error that stopped the build (a NUL the database refused).
    for (const path of ['/whole.json.gz', '/whole.bz2']) {
      const consumer = recording();
      let seen = 0;
      const failing = { ...consumer, line: () => { seen += 1; if (seen === 1200) throw new Error('the database refused a row'); } };
      await expect(readDump(file(path), failing, { signal: signal() })).rejects.toThrow('the database refused a row');
      expect(consumer.outcome).toBe('aborted');
      const failingChunks = { ...consumer, chunk: async () => { throw new Error('a worker refused the piece'); }, lineCount: () => 0 };
      await expect(readDump(file(path), failingChunks, { signal: signal() })).rejects.toThrow('a worker refused the piece');
    }
    // An 'error' emitted after the rejection surfaces on a later tick.
    await new Promise(resolve => setTimeout(resolve, 50));
  });

  it('aborts a stream cut short, which a line reader alone would read as a clean end', async () => {
    for (const path of ['/cut.json.gz', '/cut.bz2']) {
      const consumer = recording();
      await expect(readDump(file(path), consumer, { signal: signal() })).rejects.toThrow();
      expect(consumer.outcome).toBe('aborted');
    }
  });

  it("aborts a file shorter than the host's size", async () => {
    const consumer = recording();
    await expect(readDump(file('/whole.bz2', { expectedBytes: BZ2.length + 1 }), consumer, { signal: signal() }))
      .rejects.toThrow(/bytes of the host's/);
    expect(consumer.outcome).toBe('aborted');
  });

  it('resumes a local copy from where it stopped, then reads it from disk', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dumps-'));
    try {
      writeFileSync(join(dir, 'whole.json.gz'), GZ.subarray(0, 100));
      ranges.length = 0;
      const result = await readDump(
        file('/whole.json.gz', { checksum: { kind: 'sha1', value: sha1(GZ) }, expectedBytes: GZ.length }),
        countLines(), { signal: signal(), dumpsDir: dir },
      );
      // A file this small is one range: the rest of it, over one connection.
      expect(ranges).toEqual([`bytes=100-${GZ.length - 1}`]);
      expect(result.lines).toBe(LINES.length);
      expect(readFileSync(join(dir, 'whole.json.gz')).equals(GZ)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('removes the older copy of the same dump once the newer one is verified, and tells the build (#1456)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dumps-'));
    try {
      writeFileSync(join(dir, 'wikidata-20260928-lexemes.json.gz'), 'older');
      writeFileSync(join(dir, 'wikidata-20260928-all.json.gz'), 'another dump');
      const notes: string[] = [];
      await readDump(
        file('/whole.json.gz', { fileName: 'wikidata-20261005-lexemes.json.gz', checksum: { kind: 'sha1', value: sha1(GZ) }, expectedBytes: GZ.length }),
        countLines(), { signal: signal(), dumpsDir: dir, onNote: note => notes.push(note) },
      );
      expect(existsSync(join(dir, 'wikidata-20260928-lexemes.json.gz'))).toBe(false);
      expect(existsSync(join(dir, 'wikidata-20260928-all.json.gz'))).toBe(true);
      expect(existsSync(join(dir, 'wikidata-20261005-lexemes.json.gz'))).toBe(true);
      expect(notes).toEqual(['removed the older wikidata-20260928-lexemes.json.gz']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps the earlier months of the pageview counts, which are not copies of one another', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dumps-'));
    try {
      writeFileSync(join(dir, 'pageviews-202608-user.bz2'), 'August');
      await readDump(
        file('/whole.bz2', { key: 'pageviews-user', fileName: 'pageviews-202609-user.bz2', expectedBytes: BZ2.length }),
        countLines(), { signal: signal(), dumpsDir: dir },
      );
      expect(existsSync(join(dir, 'pageviews-202608-user.bz2'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps the older copy when the newer one fails verification', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dumps-'));
    try {
      writeFileSync(join(dir, 'wikidata-20260928-lexemes.json.gz'), 'older');
      await expect(readDump(
        file('/whole.json.gz', { fileName: 'wikidata-20261005-lexemes.json.gz', checksum: { kind: 'sha1', value: 'b'.repeat(40) }, expectedBytes: GZ.length }),
        countLines(), { signal: signal(), dumpsDir: dir },
      )).rejects.toThrow();
      expect(existsSync(join(dir, 'wikidata-20260928-lexemes.json.gz'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a file name that is more than one plain path segment for the local copy', async () => {
    await expect(readDump(file('/whole.json.gz', { fileName: '../escape.gz' }), countLines(), { signal: signal(), dumpsDir: tmpdir() }))
      .rejects.toThrow(/one plain segment/);
  });

  it('reads a local copy already at full size when the host names no size, and lets the checksum decide', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dumps-'));
    try {
      writeFileSync(join(dir, 'unsized.json.gz'), GZ);
      ranges.length = 0;
      const consumer = recording();
      const result = await readDump(
        file('/unsized.json.gz', { checksum: { kind: 'sha1', value: sha1(GZ) } }), consumer, { signal: signal(), dumpsDir: dir },
      );
      expect(ranges).toEqual([`bytes=${GZ.length}-`]);
      expect(result.lines).toBe(LINES.length);
      expect(consumer.outcome).toBe('committed');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('aborts the consumer when the host refuses the file before a byte is read', async () => {
    const consumer = recording();
    await expect(readDump(file('/missing.json.gz'), consumer, { signal: signal() })).rejects.toThrow(/answered 404/);
    expect(consumer.outcome).toBe('aborted');
  });

  it('deletes a local copy at full size that is not the host\'s file, so the next build downloads it again', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dumps-'));
    try {
      const damaged = Buffer.from(GZ);
      damaged[damaged.length - 20] ^= 0xff;
      writeFileSync(join(dir, 'whole.json.gz'), damaged);
      const consumer = recording();
      await expect(readDump(
        file('/whole.json.gz', { checksum: { kind: 'sha1', value: sha1(GZ) }, expectedBytes: GZ.length }),
        consumer, { signal: signal(), dumpsDir: dir },
      )).rejects.toThrow(/local copy was deleted/);
      expect(consumer.outcome).toBe('aborted');
      expect(existsSync(join(dir, 'whole.json.gz'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the host's connection cap", () => {
  it('lets a build waiting for a slot be cancelled instead of queueing behind the reads holding them', async () => {
    const held = await Promise.all([1, 2, 3].map(() => openStream(`${base}/whole.json.gz`, signal())));
    try {
      const controller = new AbortController();
      const waiting = openStream(`${base}/whole.json.gz`, controller.signal);
      controller.abort(new Error('Cancelled while waiting'));
      await expect(waiting).rejects.toThrow(/Cancelled while waiting/);
    } finally {
      for (const stream of held) stream.destroy();
    }
  });
});
