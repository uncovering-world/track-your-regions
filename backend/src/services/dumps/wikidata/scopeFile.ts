/**
 * The first pass's result kept beside the dump (#1468): a subset build that
 * stops in its second pass, or is started again on the same file, reads it
 * instead of scanning the 156 GB dump again for about four hours. The file is
 * `<dump file>.scope`, a leftover of its copy that goes with it (#1456): a
 * JSON header naming the dump file, its checksum and the rules it was made
 * under, then the kept and the property id sets, a bit per id.
 *
 * A result is used only for the same file with the same checksum, under the
 * same rules, and is removed, not read, otherwise. The rules are the scope's
 * constants (`SCOPE_RULES` in `scope.ts`), written whole, so a change to one
 * makes the result stale by itself, and `SCOPE_VERSION`, raised by hand
 * whenever the code that applies them keeps something else, more or less:
 * how a line is read (`entityLine.ts`) or `ScopeCollector` itself.
 */

import { readFile, rm, writeFile, rename } from 'node:fs/promises';
import type { DumpFile } from '../catalog.js';
import { IdSet } from './idSets.js';
import { SCOPE_RULES, type Scope, type ScopeCounts } from './scope.js';

/** Raised whenever `entityLine.ts` or `ScopeCollector` keeps something else, more or less. */
export const SCOPE_VERSION = 1;

interface Header {
  version: number;
  rules: string;
  fileName: string;
  checksum: string | null;
  counts: ScopeCounts;
  keptBytes: number;
  propertyBytes: number;
}

export const scopePath = (dir: string, file: DumpFile) => `${dir}/${file.fileName}.scope`;

/** Write the first pass's result, aside and renamed into place, so a cut write is never read. */
export async function saveScope(path: string, file: DumpFile, scope: Scope): Promise<void> {
  const kept = scope.kept.toBytes();
  const properties = scope.properties.toBytes();
  const header: Header = {
    version: SCOPE_VERSION, rules: SCOPE_RULES, fileName: file.fileName, checksum: file.checksum?.value ?? null, counts: scope.counts,
    keptBytes: kept.length, propertyBytes: properties.length,
  };
  const json = Buffer.from(JSON.stringify(header));
  const length = Buffer.alloc(4);
  length.writeUInt32BE(json.length);
  await writeFile(`${path}.tmp`, Buffer.concat([length, json, kept, properties]));
  await rename(`${path}.tmp`, path);
}

/** The first pass's result for exactly this file under these rules, or null; a stale one is removed. */
export async function loadScope(path: string, file: DumpFile): Promise<Scope | null> {
  const bytes = await readFile(path).catch(() => null);
  if (!bytes) return null;
  try {
    const length = bytes.readUInt32BE(0);
    const header = JSON.parse(bytes.subarray(4, 4 + length).toString()) as Header;
    const same = header.version === SCOPE_VERSION && header.rules === SCOPE_RULES && header.fileName === file.fileName
      && header.checksum === (file.checksum?.value ?? null);
    const start = 4 + length;
    if (same && bytes.length === start + header.keptBytes + header.propertyBytes) {
      return {
        kept: IdSet.fromBytes(bytes.subarray(start, start + header.keptBytes)),
        properties: IdSet.fromBytes(bytes.subarray(start + header.keptBytes)),
        counts: header.counts,
      };
    }
  } catch {
    // An unreadable result is a stale one.
  }
  await rm(path, { force: true });
  return null;
}
