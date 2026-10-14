import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DumpFile } from '../catalog.js';
import { at, dumpLine, item } from './dumpLineFixture.js';
import { IdSet } from './idSets.js';
import { ScopeCollector } from './scope.js';
import { loadScope, saveScope, scopePath } from './scopeFile.js';

/** The first pass's result kept beside the dump and read back for the same file (#1468). */

const file: DumpFile = {
  key: 'wikidata-entities', fileName: 'wikidata-20261005-all.json.gz', url: 'https://dumps.wikimedia.org/x',
  date: '2026-10-05', checksum: { kind: 'sha1', value: '6bb03b402f91103fe025e138f9e7205ef2adfba7' },
  expectedBytes: 156402652329, compression: 'gzip',
};

// The Louvre Palace (Q1075988) has a coordinate; the Mona Lisa (Q12418) names the Louvre (Q19675), which has one.
function scope() {
  const collector = new ScopeCollector();
  for (const line of [
    dumpLine('P625', 'coordinate location', [], { datatype: 'globe-coordinate' }),
    dumpLine('Q1075988', 'Louvre Palace', [{ property: 625, value: at(48.861, 2.336) }]),
    dumpLine('Q19675', 'Louvre Museum', [{ property: 625, value: at(48.861, 2.3358) }]),
    dumpLine('Q12418', 'Mona Lisa', [{ property: 276, value: item(19675) }]),
  ]) collector.line(line);
  return collector.finish();
}

let dir = '';
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'scope-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('the first pass kept beside the dump (#1468)', () => {
  it('reads back the same kept items, properties and counts for the same file', async () => {
    const written = scope();
    await saveScope(scopePath(dir, file), file, written);
    const read = await loadScope(scopePath(dir, file), file);
    expect([...read!.kept]).toEqual([...written.kept]);
    expect([...read!.properties]).toEqual([625]);
    expect(read!.counts).toEqual(written.counts);
    expect(read!.kept.size).toBe(written.kept.size);
  });

  it('removes a result written for another checksum instead of reading it', async () => {
    await saveScope(scopePath(dir, file), file, scope());
    const other = { ...file, checksum: { kind: 'sha1' as const, value: 'b'.repeat(40) } };
    expect(await loadScope(scopePath(dir, file), other)).toBeNull();
    expect(existsSync(scopePath(dir, file))).toBe(false);
  });

  it('removes a result made under other rules', async () => {
    await saveScope(scopePath(dir, file), file, scope());
    const path = scopePath(dir, file);
    const bytes = readFileSync(path);
    const length = bytes.readUInt32BE(0);
    const header = JSON.parse(bytes.subarray(4, 4 + length).toString());
    const changed = Buffer.from(JSON.stringify({ ...header, rules: header.rules.replace('"chainDepth":8', '"chainDepth":9') }));
    const size = Buffer.alloc(4);
    size.writeUInt32BE(changed.length);
    writeFileSync(path, Buffer.concat([size, changed, bytes.subarray(4 + length)]));
    expect(await loadScope(path, file)).toBeNull();
    expect(existsSync(path)).toBe(false);
  });

  it('removes a result it cannot read', async () => {
    writeFileSync(scopePath(dir, file), 'not a scope');
    expect(await loadScope(scopePath(dir, file), file)).toBeNull();
    expect(existsSync(scopePath(dir, file))).toBe(false);
  });

  it('keeps an id set whole through its bytes', () => {
    const set = new IdSet();
    for (const id of [1, 8, 9, 140_000_000]) set.add(id);
    const back = IdSet.fromBytes(set.toBytes());
    expect([...back]).toEqual([1, 8, 9, 140_000_000]);
    expect(back.size).toBe(4);
  });
});
