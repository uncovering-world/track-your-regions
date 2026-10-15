/**
 * What the second pass of a subset build makes of a batch of dump lines
 * (#1479), as a pure function over strings: a worker thread and the main
 * thread run the same code, so a build in workers writes what a build without
 * them writes. It answers in strings and a typed array, which pass between
 * threads cheaply; the main thread only merges. The first pass's counterpart
 * is `scopeFactsOf` (`scope.ts`).
 */

import { gzipSync } from 'node:zlib';
import { arrayItemOf, compactEntity, type DumpEntity, storableJson } from './compactEntity.js';
import { entityJson, entityOf, forEachMainItemValue } from './entityLine.js';
import { type IdSet, Numbers } from './idSets.js';
import { termsOf } from './labelsRing.js';
import type { EntityRow } from './subsetTables.js';

/**
 * The version of what pass 2 writes from a line: raised by hand with any
 * change to it — here, in `compactEntity.ts` (the compact form and what it
 * keeps storable) or in `termsOf` — so that a build cut in pass 2 is not
 * picked up after by code that writes rows another way (#1493): the new
 * version is part of the resume key, and the next build starts afresh.
 */
export const WRITE_VERSION = 1;

/** What pass 2 makes of a batch of lines (`SubsetWriter`). */
export interface WriteFacts {
  /** Every line of the batch, entity or not. */
  lines: number;
  /** The kept entities, compact and storable. */
  rows: EntityRow[];
  /** Every other entity's terms, as the spool's lines in one gzip member (empty when there are none). */
  spool: Uint8Array;
  spooled: number;
  /** The items the kept ones name: the labels ring. */
  ring: Uint32Array;
}

export function writeFactsOf(lines: readonly string[], kept: IdSet, properties: IdSet): WriteFacts {
  const rows: EntityRow[] = [];
  const spool: string[] = [];
  const ring = new Numbers();
  for (const line of lines) {
    const entity = entityOf(line);
    if (!entity) continue;
    const isKept = entity.kind === 'property' ? properties.has(entity.id) : kept.has(entity.id);
    if (!isKept) {
      const terms = termsOf(`Q${entity.id}`, line);
      if (terms) spool.push(`${JSON.stringify(terms)}\n`);
      continue;
    }
    if (entity.kind === 'item') forEachMainItemValue(line, (_property, item) => ring.push(item));
    const parsed = JSON.parse(entityJson(line)) as DumpEntity;
    rows.push({
      id: parsed.id,
      sitelinkCount: Object.keys(parsed.sitelinks ?? {}).length,
      arrayItem: arrayItemOf(storableJson(JSON.stringify(compactEntity(parsed)))),
    });
  }
  return {
    lines: lines.length,
    rows,
    // Compressed here, in the worker, rather than on the thread that writes the
    // file; copied into memory of its own, since a small Buffer can sit in
    // Node's shared pool and is then not safe to hand to another thread.
    spool: spool.length > 0 ? new Uint8Array(gzipSync(spool.join(''), { level: 1 })) : new Uint8Array(0),
    spooled: spool.length,
    ring: ring.take(),
  };
}
