import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { at, dumpLine, item } from './dumpLineFixture.js';
import { TermsSpool } from './labelsRing.js';
import { Refusals } from './refusals.js';
import type { Scope } from './scope.js';
import { ScopeReader } from './scopeReader.js';
import type { EntityRow } from './subsetTables.js';
import { SubsetWriter } from './subsetWriter.js';

/**
 * Both passes of a subset build in worker threads (#1479) make what they make
 * on the main thread: the same scope, rows, spooled terms and labels ring,
 * whether the lines arrive one by one or as pieces of text, and whatever
 * order the workers finish in. The dump is long enough for several batches,
 * and its chains cross batch boundaries.
 */

const ROOM = 9000001;
const PALACE = 9000002;

/** Several thousand items: places with a coordinate, objects in rooms of a palace, and items nothing keeps. */
function dump(): string[] {
  const lines = [
    dumpLine('P625', 'coordinate location', [], { datatype: 'globe-coordinate' }),
    dumpLine('P276', 'location', [], { datatype: 'wikibase-item' }),
    dumpLine('P361', 'part of', [], { datatype: 'wikibase-item' }),
  ];
  for (let n = 1; n <= 6000; n += 1) {
    const id = `Q${n}`;
    if (n % 7 === 0) lines.push(dumpLine(id, `place ${n}`, [{ property: 625, value: at(48 + n / 1e4, 2 + n / 1e4) }]));
    else if (n % 5 === 0) lines.push(dumpLine(id, `object ${n}`, [{ property: 276, value: item(ROOM) }], { labels: { de: `Objekt ${n}\0` } }));
    else lines.push(dumpLine(id, `other ${n}`, [{ property: 31, value: item(n + 1) }], { descriptions: { fr: `autre ${n}` } }));
  }
  // The chain closes at the end of the dump: the room, then the palace with its coordinate.
  lines.push(dumpLine(`Q${ROOM}`, 'Room 325', [{ property: 361, value: item(PALACE) }]));
  lines.push(dumpLine(`Q${PALACE}`, 'Louvre Palace', [{ property: 625, value: at(48.861, 2.336) }]));
  return ['[', ...lines, ']'];
}

const LINES = dump();
const TEXT = new TextEncoder().encode(`${LINES.join('\n')}\n`);

/** The text in pieces ending at a line's end, as `readDump` hands a chunk consumer it. */
function pieces(): Uint8Array[] {
  const out: Uint8Array[] = [];
  let start = 0;
  while (start < TEXT.length) {
    let end = Math.min(start + 300_000, TEXT.length);
    while (end < TEXT.length && TEXT[end - 1] !== 10) end += 1;
    out.push(TEXT.slice(start, end));
    start = end;
  }
  return out;
}

async function scopeOf(workers: number, asText: boolean): Promise<Scope> {
  const reader = new ScopeReader(workers);
  if (asText) for (const piece of pieces()) await reader.chunk(piece);
  else for (const line of LINES) await reader.line(line);
  await reader.commit();
  expect(reader.lineCount()).toBe(LINES.length);
  return reader.collector.finish();
}

async function writeOf(scope: Scope, workers: number, asText: boolean) {
  const dir = mkdtempSync(join(tmpdir(), 'parallel-passes-'));
  const spool = new TermsSpool(join(dir, 'terms.gz'));
  const rows: EntityRow[] = [];
  await spool.open();
  const writer = new SubsetWriter(scope, spool, new Refusals(), null, async (_record, batch) => { rows.push(...batch); return batch.length; }, workers);
  try {
    if (asText) for (const [index, piece] of pieces().entries()) await writer.chunk(piece, index);
    else for (const line of LINES) await writer.line(line);
    await writer.commit();
    const terms: string[] = [];
    for await (const entry of spool.read()) terms.push(JSON.stringify(entry));
    return {
      rows: rows.sort((a, b) => a.id.localeCompare(b.id)),
      terms: terms.sort(),
      ring: [...writer.ring],
      counts: writer.counts,
    };
  } finally {
    await spool.remove();
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('a subset build in worker threads (#1479)', () => {
  it('keeps the scope the main thread keeps, the chain closed at the end of the dump included', async () => {
    const alone = await scopeOf(0, false);
    expect(alone.kept.has(ROOM)).toBe(true);
    expect(alone.kept.has(35)).toBe(true);
    for (const asText of [false, true]) {
      const parallel = await scopeOf(2, asText);
      expect([...parallel.kept]).toEqual([...alone.kept]);
      expect([...parallel.properties]).toEqual([...alone.properties]);
      expect(parallel.counts).toEqual(alone.counts);
    }
  });

  it('writes the rows, spools the terms and gathers the ring the main thread does', async () => {
    const scope = await scopeOf(0, false);
    const alone = await writeOf(scope, 0, false);
    expect(alone.rows.length).toBeGreaterThan(1000);
    expect(alone.terms.length).toBeGreaterThan(1000);
    for (const asText of [false, true]) {
      expect(await writeOf(scope, 2, asText)).toEqual(alone);
    }
  });
});
