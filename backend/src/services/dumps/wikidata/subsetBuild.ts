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
import { insertRefusing, Refusals } from './refusals.js';
import type { Scope, ScopeCounts } from './scope.js';
import { ScopeReader } from './scopeReader.js';
import { loadScope, saveScope, scopePath } from './scopeFile.js';
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
  counts: ScopeCounts & { written: number; ring: number; ringLabelled: number; refused: number };
}

const LABEL_BATCH = 5000;

/** Insert the spooled terms of every entity the ring holds; answers how many entities got one. */
async function labelTheRing(
  spool: TermsSpool, ring: (id: number) => boolean, signal: AbortSignal, refusals: Refusals,
): Promise<number> {
  let rows: LabelRow[] = [];
  let labelled = 0;
  const insert = (batch: LabelRow[]) => insertRefusing(batch, row => `${row.id}@${row.language}`, insertLabels, refusals);
  for await (const { id, terms } of spool.read()) {
    signal.throwIfAborted();
    if (!ring(Number(id.slice(1)))) continue;
    labelled += 1;
    for (const [language, [label, description]] of Object.entries(terms)) rows.push({ id, language, label, description });
    if (rows.length >= LABEL_BATCH) {
      await insert(rows);
      rows = [];
    }
  }
  await insert(rows);
  return labelled;
}

/**
 * The first pass: what the subset keeps. With a local copy, its result is kept
 * beside the dump (#1468), and a build of the same file reads it back instead
 * of scanning the dump again; the second pass still verifies the file.
 */
async function scopeOf(file: DumpFile, options: SubsetBuildOptions): Promise<Scope> {
  const path = options.dumpsDir ? scopePath(options.dumpsDir, file) : null;
  const earlier = path ? await loadScope(path, file) : null;
  if (earlier) {
    options.onPhase(`Pass 1 of 2: read from an earlier build of ${file.fileName}, ${earlier.counts.kept.toLocaleString('en')} items`);
    return earlier;
  }
  options.onPhase('Pass 1 of 2: finding what the subset keeps...');
  const reader = new ScopeReader();
  await readDump(file, reader, options);
  const scope = reader.collector.finish();
  if (path) await saveScope(path, file, scope);
  return scope;
}

export async function buildSubset(file: DumpFile, options: SubsetBuildOptions): Promise<SubsetResult> {
  const { onPhase } = options;
  const scope = await scopeOf(file, options);

  const spool = new TermsSpool(join(options.dumpsDir ?? tmpdir(), `${file.fileName}.terms.gz`));
  try {
    await createNextTables();
    onPhase(`Pass 2 of 2: writing ${scope.counts.kept.toLocaleString('en')} items...`);
    // One budget for every row the build leaves out: `MAX_REFUSED` holds for entities and labels together.
    const refusals = new Refusals();
    const writer = new SubsetWriter(scope, spool, refusals);
    const read = await readDump(file, writer, options);

    // Past the reads, a cancel is honoured between steps and inside each
    // long statement, and always before the swap: a cancelled build keeps
    // nothing.
    const { signal } = options;
    onPhase('Labelling the entities the kept items name...');
    const ring = (id: number) => writer.ring.has(id) && !scope.kept.has(id);
    const ringLabelled = await labelTheRing(spool, ring, signal, refusals);
    const refused = refusals.note('rows (an entity, or a label as id@language)');
    if (refused) options.onNote?.(refused);
    onPhase('Deriving the claims, labels and sitelinks...');
    await deriveFromEntities(signal);
    onPhase('Indexing...');
    await indexNextTables(signal, ['wikidata_entities', 'wikidata_claims', 'wikidata_labels', 'wikidata_sitelinks']);
    onPhase('Walking the class tree...');
    await deriveClassClosure(signal);
    await indexNextTables(signal, ['wikidata_class_closure']);

    const counts = {
      ...scope.counts, written: writer.counts.written, ring: writer.ring.size, ringLabelled,
      refused: refusals.count,
    };
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
