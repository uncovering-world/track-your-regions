import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStream } from './fetch.js';
import { bytesHeld, downloadRanges, splitRanges } from './rangedDownload.js';

/**
 * A local copy fetched over several ranged connections (#1455), against a
 * local HTTP server that answers ranges the way the dump hosts do and can cut
 * one range short the first time it is asked for.
 */

const BODY = Buffer.from(Array.from({ length: 30_000 }, (_, i) => String.fromCharCode(65 + (i % 26))).join(''));
const requested: string[] = [];
let cutOnce = false;
let server: Server;
let url = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    const range = /bytes=(\d+)-(\d+)/.exec(req.headers.range ?? '');
    if (!range) { res.writeHead(200, { 'Content-Length': BODY.length }); res.end(BODY); return; }
    requested.push(req.headers.range!);
    const from = Number(range[1]);
    const to = Number(range[2]);
    res.writeHead(206, { 'Content-Length': to - from + 1, 'Content-Range': `bytes ${from}-${to}/${BODY.length}` });
    if (cutOnce && from > 0) {
      cutOnce = false;
      res.write(BODY.subarray(from, from + 100));
      res.destroy();
      return;
    }
    res.end(BODY.subarray(from, to + 1));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/file`;
});

afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

function download(path: string, have = 0) {
  let bytes = 0;
  const run = downloadRanges({
    url, path, expected: BODY.length, have, signal: new AbortController().signal, connections: 3, minRange: 1000,
    onBytes: n => { bytes += n; },
    openRange: (signal, from, to) => openStream(url, signal, from, to),
  });
  return { run, bytes: () => bytes };
}

describe('a download over several ranges (#1455)', () => {
  it('splits what is left into one range per connection, none shorter than the minimum', () => {
    expect(splitRanges(0, 3000, 3, 1000)).toEqual([{ next: 0, end: 1000 }, { next: 1000, end: 2000 }, { next: 2000, end: 3000 }]);
    expect(splitRanges(500, 1500, 3, 1000)).toEqual([{ next: 500, end: 1500 }]);
    expect(splitRanges(1500, 1500, 3)).toEqual([]);
  });

  it('fetches a new copy over three connections and gives it its name only once whole', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ranges-'));
    try {
      const path = join(dir, 'file.gz');
      requested.length = 0;
      const { run, bytes } = download(path);
      expect(await run).toBe(BODY.length);
      expect(requested.sort()).toEqual(['bytes=0-9999', 'bytes=10000-19999', 'bytes=20000-29999']);
      expect(readFileSync(path).equals(BODY)).toBe(true);
      expect(bytes()).toBe(BODY.length);
      expect(existsSync(`${path}.part`) || existsSync(`${path}.part.json`)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('continues a copy downloaded in order before, from where it stopped', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ranges-'));
    try {
      const path = join(dir, 'file.gz');
      writeFileSync(path, BODY.subarray(0, 3000));
      requested.length = 0;
      expect(await download(path, 3000).run).toBe(BODY.length);
      expect(requested.sort()).toEqual(['bytes=12000-20999', 'bytes=21000-29999', 'bytes=3000-11999']);
      expect(readFileSync(path).equals(BODY)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps a cut download under its part name and resumes every range where it stopped', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ranges-'));
    try {
      const path = join(dir, 'file.gz');
      cutOnce = true;
      await expect(download(path).run).rejects.toThrow();
      expect(existsSync(path)).toBe(false);
      const state = JSON.parse(readFileSync(`${path}.part.json`, 'utf8')) as { ranges: Array<{ next: number; end: number }> };
      const left = state.ranges.filter(range => range.next < range.end);
      expect(left.length).toBeGreaterThan(0);
      // What the download holds is what its ranges reached, not the sparse part's size.
      expect(await bytesHeld(path, BODY.length)).toBe(BODY.length - left.reduce((sum, range) => sum + range.end - range.next, 0));
      requested.length = 0;
      expect(await download(path).run).toBe(BODY.length);
      // Each range is asked for again from where the saved state says it stopped, and only those.
      expect(requested.sort()).toEqual(left.map(range => `bytes=${range.next}-${range.end - 1}`).sort());
      expect(readFileSync(path).equals(BODY)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
