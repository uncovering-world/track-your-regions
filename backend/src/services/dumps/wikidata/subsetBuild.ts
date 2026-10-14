/**
 * A build of the local Wikidata subset from the entities dump (ADR-0101
 * decision 2, ADR-0105). Two passes over the file, each verified like any
 * read of the pipeline:
 *
 * 1. scan every line for what decides the scope (`ScopeCollector`), keeping
 *    ids only;
 * 2. write every kept entity, spool every other entity's terms, and gather the
 *    labels ring (`SubsetWriter`).
 *
 * Then the ring's labels are read back from the spool, the other tables are
 * derived from the entities, the copies are indexed and swapped in whole.
 * Anything that fails leaves the live subset as it was.
 */

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DumpFile } from '../catalog.js';
import { readDump, type ReadOptions } from '../read.js';
import { TermsSpool } from './labelsRing.js';
import { ScopeCollector, type ScopeCounts } from './scope.js';
import { SubsetWriter } from './subsetWriter.js';
import {
  createNextTables, deriveClassClosure, deriveFromEntities, dropNextTables, indexNextTables, insertLabels,
  type LabelRow, swapIn,
} from './subsetTables.js';

export interface SubsetBuildOptions extends ReadOptions {
  buildId: number;
  /** What the build is doing now, for the admin panel. */
  onPhase: (message: string) => void;
}

export interface SubsetResult {
  bytes: number;
  lines: number;
  checksumActual: string | null;
  counts: ScopeCounts & { written: number; ring: number; ringLabelled: number };
}

const LABEL_BATCH = 5000;

/** Insert the spooled terms of every entity the ring holds; answers how many entities got one. */
async function labelTheRing(spool: TermsSpool, ring: (id: number) => boolean, signal: AbortSignal): Promise<number> {
  let rows: LabelRow[] = [];
  let labelled = 0;
  for await (const { id, terms } of spool.read()) {
    signal.throwIfAborted();
    if (!ring(Number(id.slice(1)))) continue;
    labelled += 1;
    for (const [language, [label, description]] of Object.entries(terms)) rows.push({ id, language, label, description });
    if (rows.length >= LABEL_BATCH) {
      await insertLabels(rows);
      rows = [];
    }
  }
  await insertLabels(rows);
  return labelled;
}

export async function buildSubset(file: DumpFile, options: SubsetBuildOptions): Promise<SubsetResult> {
  const { onPhase } = options;
  onPhase('Pass 1 of 2: finding what the subset keeps...');
  const collector = new ScopeCollector();
  await readDump(file, {
    line: line => collector.line(line), commit: async () => undefined, abort: async () => undefined,
  }, options);
  const scope = collector.finish();

  const spool = new TermsSpool(join(options.dumpsDir ?? tmpdir(), `${file.fileName}.terms.gz`));
  try {
    await createNextTables();
    onPhase(`Pass 2 of 2: writing ${scope.counts.kept.toLocaleString('en')} items...`);
    const writer = new SubsetWriter(scope, spool);
    const read = await readDump(file, writer, options);

    // Past the reads, a cancel is honoured between steps and inside each
    // long statement, and always before the swap: a cancelled build keeps
    // nothing.
    const { signal } = options;
    onPhase('Labelling the entities the kept items name...');
    const ring = (id: number) => writer.ring.has(id) && !scope.kept.has(id);
    const ringLabelled = await labelTheRing(spool, ring, signal);
    onPhase('Deriving the claims, labels and sitelinks...');
    await deriveFromEntities(signal);
    onPhase('Indexing...');
    await indexNextTables(signal, ['wikidata_entities', 'wikidata_claims', 'wikidata_labels', 'wikidata_sitelinks']);
    onPhase('Walking the class tree...');
    await deriveClassClosure(signal);
    await indexNextTables(signal, ['wikidata_class_closure']);

    const counts = { ...scope.counts, written: writer.counts.written, ring: writer.ring.size, ringLabelled };
    signal.throwIfAborted();
    onPhase('Swapping the new subset in...');
    await swapIn(options.buildId, file.date, counts);
    return { ...read, counts };
  } catch (error) {
    await dropNextTables().catch(() => undefined);
    throw error;
  } finally {
    await spool.remove();
  }
}
