import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dumpNamed } from './catalog.js';
import { copyOf } from './localCopies.js';
import { CutAt, cutSample, newestSample, sampleFile, sampleName, sampleOf } from './samples.js';

const COPY = 'wikidata-20261005-all.json.gz';
const entity = (n: number) => JSON.stringify({ id: `Q${n}`, type: 'item', labels: { en: { language: 'en', value: `item ${n}` } } });
/** The dump's own shape: `[`, one entity a line with a trailing comma but the last, `]`. */
const dumpText = (count: number) => `[\n${Array.from({ length: count }, (_, i) => entity(i + 1)).join(',\n')}\n]\n`;

/** Feed `text` to a cut in chunks of `size` bytes, as the decoder hands it. */
function cutInChunks(text: string, limit: number, size: number): string {
  const cut = new CutAt(limit);
  const out: Buffer[] = [];
  const bytes = Buffer.from(text);
  for (let i = 0; i < bytes.length && !cut.done; i += size) out.push(...cut.take(bytes.subarray(i, i + size)));
  out.push(...cut.rest());
  return Buffer.concat(out).toString();
}

describe('CutAt', () => {
  it('closes the array at the end of the line the limit falls in, at any chunk size', () => {
    const text = dumpText(50);
    for (const size of [1, 7, 64, 4096]) {
      for (const limit of [1, 30, 333, 1500]) {
        const sample = cutInChunks(text, limit, size);
        const items = JSON.parse(sample) as { id: string }[];
        expect(sample.length).toBeGreaterThanOrEqual(Math.min(limit, text.length) - 2);
        expect(items.map(item => item.id)).toEqual(Array.from({ length: items.length }, (_, i) => `Q${i + 1}`));
      }
    }
  });

  it('drops the comma that ends a chunk when the next one ends the line there', () => {
    const text = dumpText(3);
    const comma = text.indexOf(',\n');
    const sample = cutInChunks(text, comma, comma + 1);
    expect(JSON.parse(sample)).toHaveLength(1);
  });

  it('takes a dump shorter than the limit whole', () => {
    const text = dumpText(5);
    expect(cutInChunks(text, 10_000, 9)).toBe(text);
  });
});

describe('a sample\'s name', () => {
  it('is no copy of the dump, and says which copy it was cut from', () => {
    const name = sampleName(COPY, 4 * 1024 ** 3);
    expect(name).toBe(`sample-4gb-${COPY}`);
    expect(copyOf(name)).toBeNull();
    expect(dumpNamed('wikidata-entities')!.isFileName(name)).toBe(false);
    expect(sampleOf(name)).toEqual({ fileName: name, of: COPY, date: '2026-10-05' });
    expect(sampleOf(COPY)).toBeNull();
  });

  it('reads as a file on disk only: no URL, no checksum, its own size', () => {
    const file = sampleFile('wikidata-entities', { fileName: `sample-4gb-${COPY}`, of: COPY, date: '2026-10-05', bytes: 123 });
    expect(file).toMatchObject({ url: '', checksum: null, expectedBytes: 123, compression: 'gzip', date: '2026-10-05' });
  });
});

describe('cutSample', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'samples-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('writes the first part of the copy as a gzipped JSON array beside it, and lists it', async () => {
    await writeFile(join(dir, COPY), gzipSync(dumpText(2000)));
    const result = await cutSample(dir, COPY, { signal: new AbortController().signal, jsonBytes: 10_000 });
    const items = JSON.parse(gunzipSync(await readFile(join(dir, result.sample.fileName))).toString()) as unknown[];
    expect(items.length).toBeGreaterThan(50);
    expect(items.length).toBeLessThan(2000);
    expect(result.lines).toBe(items.length + 1);
    expect((await readdir(dir)).sort()).toEqual([COPY, result.sample.fileName].sort());
    const isFileName = dumpNamed('wikidata-entities')!.isFileName;
    expect(await newestSample(dir, isFileName)).toEqual(result.sample);
  });

  it('replaces the dump\'s earlier samples and what builds of them left, and no other dump\'s', async () => {
    const older = 'sample-4gb-wikidata-20260921-all.json.gz';
    const otherDump = 'sample-4gb-wikidata-20261005-lexemes.json.gz';
    await writeFile(join(dir, COPY), gzipSync(dumpText(200)));
    for (const name of [older, `${older}.scope`, `${older}.terms.gz`, otherDump]) await writeFile(join(dir, name), 'x');
    const result = await cutSample(dir, COPY, { signal: new AbortController().signal, jsonBytes: 1_000 });
    expect((await readdir(dir)).sort()).toEqual([COPY, otherDump, result.sample.fileName].sort());
  });

  it('leaves no sample when it is stopped', async () => {
    await writeFile(join(dir, COPY), gzipSync(dumpText(2000)));
    const controller = new AbortController();
    controller.abort();
    await expect(cutSample(dir, COPY, { signal: controller.signal, jsonBytes: 10_000 })).rejects.toThrow();
    expect(await readdir(dir)).toEqual([COPY]);
  });
});
