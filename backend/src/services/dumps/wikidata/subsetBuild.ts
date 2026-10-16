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

import { rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { DumpFile } from '../catalog.js';
import { isDamagedRead, PIECE_BYTES, readDump, type ReadOptions } from '../read.js';
import { sampleOf } from '../samples.js';
import { assertRoomForCopies, assertRoomToWrite } from './diskRoom.js';
import { IdSet } from './idSets.js';
import { WRITE_VERSION } from './lineWork.js';
import { TermsSpool } from './labelsRing.js';
import { insertRefusing, Refusals } from './refusals.js';
import type { Scope, ScopeCounts } from './scope.js';
import { ScopeReader } from './scopeReader.js';
import { loadScope, saveScope, scopePath } from './scopeFile.js';
import { SubsetWriter } from './subsetWriter.js';
import {
  carryRingLabels, createDerivedNextTables, createNextTables, DERIVED_TABLES, derivedTablesSize, dropDerivedNextTables, earlierSpool, entitiesAreHeld, entitiesCopySize,
  latestSubsetCounts, nextTablesSize, resetAfterPassTwo, type StepReport, resumableBuild, deriveClassClosure, deriveFromEntities, dropNextTables, indexNextTables, insertLabels,
  type LabelRow, type ResumeState, swapIn,
} from './subsetTables.js';
import { currentRules, DERIVE_VERSION } from './buildRules.js';

export interface SubsetBuildOptions extends ReadOptions {
  buildId: number;
  /** What the build is doing now, for the admin panel. */
  onPhase: (message: string) => void;
  /**
   * A trial of the build (#1527): every step runs into the copies, which are
   * then dropped instead of swapped in, so the subset the runs read is never
   * touched.
   */
  trial?: boolean;
  /** How far a step that reads a file of its own has got: the labelling's terms spool (#1519). */
  onMeasure?: (read: number, total: number) => void;
}

export interface SubsetResult {
  bytes: number;
  lines: number;
  checksumActual: string | null;
  counts: ScopeCounts & { written: number; ring: number; ringLabelled: number; refused: number };
  /** What the build kept and what its tables took, in words, for its row. */
  summary: string;
}

const GB = 1024 ** 3;
const gb = (bytes: number) => `${(bytes / GB).toFixed(2)} GB`;

/** What a build kept and what its copies took on disk, against the kept lines' bytes the disk check estimates from. */
function summaryOf(counts: SubsetResult['counts'], tableBytes: number): string {
  const n = (value: number) => value.toLocaleString('en');
  const share = counts.keptBytes > 0 ? (tableBytes / counts.keptBytes).toFixed(3) : '—';
  return `kept ${n(counts.kept)} of ${n(counts.items)} items (${n(counts.seeds)} seeds), wrote ${n(counts.written)}, `
    + `labelled ${n(counts.ringLabelled)} of the ${n(counts.ring)} entities they name, refused ${n(counts.refused)}; `
    + `the tables took ${gb(tableBytes)}, ${share} of the kept lines' ${gb(counts.keptBytes)}`;
}

const LABEL_BATCH = 5000;

/** What a step says while it runs, under the step's own name: the name before the colon is what times it (`stepTimes.ts`). */
const inStep = (onPhase: (message: string) => void, step: string): StepReport => detail => onPhase(`${step}: ${detail}...`);

/** Insert the spooled terms of every entity the ring holds; answers how many entities got one. */
async function labelTheRing(
  spool: TermsSpool, ring: (id: number) => boolean, signal: AbortSignal, refusals: Refusals,
  onMeasure?: (read: number, total: number) => void,
): Promise<number> {
  let rows: LabelRow[] = [];
  let labelled = 0;
  const insert = (batch: LabelRow[]) => insertRefusing(batch, row => `${row.id}@${row.language}`, insertLabels, refusals);
  // A piece written again after a cut (#1493) spooled its terms twice; each entity is labelled once.
  const seen = new IdSet();
  const total = (await stat(spool.path).catch(() => null))?.size ?? 0;
  for await (const { id, terms } of spool.read(read => onMeasure?.(read, total))) {
    signal.throwIfAborted();
    const item = Number(id.slice(1));
    if (!ring(item) || !seen.add(item)) continue;
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
 * of scanning the dump again; the second pass still verifies the file. A
 * trial always scans: the first pass's code is part of what it tries, and its
 * time one of the steps it reports.
 */
async function scopeOf(file: DumpFile, options: SubsetBuildOptions): Promise<Scope> {
  const path = options.dumpsDir && !options.trial ? scopePath(options.dumpsDir, file) : null;
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

/**
 * What the `_next` copies of an earlier build must have been built from for
 * this one to pick up after them: the same file, its checksum, the same
 * scope (its counts, which the kept first pass reads back unchanged), the
 * same grid of pieces, and the same way of writing a line (`WRITE_VERSION`),
 * so rows of two versions of the code never end up in one subset.
 */
const resumeKeyOf = (file: DumpFile, scope: Scope) => JSON.stringify({
  file: file.fileName, checksum: file.checksum?.value ?? null, scope: scope.counts, piece: PIECE_BYTES, write: WRITE_VERSION,
});

/** The size of the file at `path`, or 0 where there is none. */
const sizeOf = async (path: string) => (await stat(path).catch(() => null))?.size ?? 0;

/**
 * What an earlier build of the same file left to pick up after, or null to
 * start afresh, in which case an earlier build's spool elsewhere is removed.
 * A trial always starts afresh: what it reports is every step, run whole.
 */
async function whatToPickUpAfter(resumeKey: string, spoolPath: string, options: SubsetBuildOptions): Promise<ResumeState | null> {
  const resume = options.trial ? null : await resumableBuild(resumeKey);
  // The spool in a temporary directory goes with a recreated container while
  // the copies stay in the database: without the terms the records point to,
  // the copies cannot be picked up after.
  if (resume && await sizeOf(spoolPath) >= resume.spoolEnd) return resume;
  if (resume) options.onNote?.('an earlier build\'s copies were found without its spool: starting afresh');
  const stale = await earlierSpool();
  if (stale && stale !== spoolPath) await rm(stale, { force: true });
  // Copies no build can pick up after go now, before the disk check counts them as used.
  await dropNextTables();
  return null;
}

/**
 * Whether a trial would throw away the copies a build of the dump left to be
 * picked up after (#1493). A trial's own leftovers, from one stopped before it
 * could drop them, no build picks up after, and the next trial drops them.
 */
async function trialWouldDiscard(): Promise<boolean> {
  const left = await earlierSpool();
  return left !== null && sampleOf(basename(left)) === null;
}

export async function buildSubset(file: DumpFile, options: SubsetBuildOptions): Promise<SubsetResult> {
  const { onPhase, signal } = options;
  if (options.trial && await trialWouldDiscard()) {
    throw new Error('A build cut in its second pass left its copies for the next build of its file to pick up after: a trial would throw them away. Finish that build first.');
  }
  const scope = await scopeOf(file, options);

  // An earlier build of the same file and scope that was cut in pass 2 left
  // its copies and its spool (#1493): this one picks up after the pieces it
  // finds written, reading the file whole all the same, which verifies it.
  const resumeKey = resumeKeyOf(file, scope);
  const spoolDir = options.dumpsDir ?? tmpdir();
  const spoolPath = join(spoolDir, `${file.fileName}.terms.gz`);
  const resume = await whatToPickUpAfter(resumeKey, spoolPath, options);
  const written = resume ? { tables: await entitiesCopySize(), spool: resume.spoolEnd } : undefined;
  for (const note of await assertRoomToWrite(spoolDir, scope.counts, undefined, written)) options.onNote?.(note);
  const spool = new TermsSpool(spoolPath);
  let keep = false;
  try {
    if (resume) {
      await resetAfterPassTwo();
      await spool.open(resume.spoolEnd);
      options.onNote?.(`picked up after ${resume.pieces.size.toLocaleString('en')} pieces an earlier build of this file wrote`);
    } else {
      await createNextTables(resumeKey, spoolPath);
      await spool.open();
    }
    onPhase(`Pass 2 of 2: writing ${scope.counts.kept.toLocaleString('en')} items...`);
    // One budget for every row the build leaves out: `MAX_REFUSED` holds for entities and labels together.
    const refusals = new Refusals();
    const writer = new SubsetWriter(scope, spool, refusals, resume);
    const read = await readDump(file, writer, options);

    // Past the reads, a cancel is honoured between steps and inside each
    // long statement, and always before the swap: a cancelled build keeps
    // nothing.
    onPhase('Labelling the entities the kept items name...');
    const ring = (id: number) => writer.ring.has(id) && !scope.kept.has(id);
    const ringLabelled = await labelTheRing(spool, ring, signal, refusals, options.onMeasure);
    const refused = refusals.note('rows (an entity, or a label as id@language)');
    if (refused) options.onNote?.(refused);
    onPhase('Deriving the claims, labels and sitelinks...');
    await deriveFromEntities(signal, undefined, undefined, inStep(onPhase, 'Deriving the claims, labels and sitelinks'));
    onPhase('Indexing...');
    await indexNextTables(signal, ['wikidata_entities', 'wikidata_claims', 'wikidata_labels', 'wikidata_sitelinks'], inStep(onPhase, 'Indexing'));
    onPhase('Walking the class tree...');
    await deriveClassClosure(signal);
    await indexNextTables(signal, ['wikidata_class_closure'], inStep(onPhase, 'Walking the class tree'));

    const counts = {
      ...scope.counts, written: writer.counts.written, ring: writer.ring.size, ringLabelled,
      refused: refusals.count,
    };
    const summary = summaryOf(counts, await nextTablesSize());
    signal.throwIfAborted();
    if (options.trial) {
      onPhase('Throwing the trial\'s tables away...');
      await dropNextTables();
      return { ...read, counts, summary };
    }
    onPhase('Swapping the new subset in...');
    await swapIn(options.buildId, file.date, counts, currentRules());
    return { ...read, counts, summary };
  } catch (error) {
    // What pass 2 wrote is kept for the next build of the same file to pick
    // up after, unless the build was cancelled, which keeps nothing, or the
    // file was not the host's, whose rows no build may reuse, or the build
    // was a trial, which keeps nothing either.
    keep = !signal.aborted && !isDamagedRead(error) && !options.trial;
    if (keep) options.onNote?.('what pass 2 wrote is kept: the next build of this file picks up after it');
    else await dropNextTables().catch(() => undefined);
    throw error;
  } finally {
    if (keep) await spool.close().catch(() => undefined);
    else await spool.remove();
  }
}

export interface RederiveOptions {
  buildId: number;
  signal: AbortSignal;
  onPhase: (message: string) => void;
  onNote?: (note: string) => void;
}

/**
 * Derive the claims, labels, sitelinks and class closure again from the
 * entities in place, without reading the dump (#1526): what a change to a
 * derivation needs, in the time the derive takes rather than the passes'.
 * The ring's labels come from the dump's terms, which this does not read, so
 * they are carried over from the live table. The derived tables are swapped
 * in alone, and the build is recorded under the dump date and counts of the
 * one whose entities it read. Anything that fails leaves the live subset as
 * it was, and a cut keeping build's entities copy where it was.
 */
export async function rederiveSubset({ buildId, signal, onPhase, onNote }: RederiveOptions): Promise<void> {
  const latest = await latestSubsetCounts();
  if (!latest) throw new Error('There is no subset in place to derive again: build it from the dump first');
  if (!await entitiesAreHeld()) {
    throw new Error('The subset\'s entities are empty, as a crash of the database leaves them: build it from the dump again');
  }
  for (const note of await assertRoomForCopies(await derivedTablesSize())) onNote?.(note);
  try {
    await createDerivedNextTables();
    onPhase('Carrying the labels of the entities the kept items name...');
    await carryRingLabels(signal);
    onPhase('Deriving the claims, labels and sitelinks...');
    await deriveFromEntities(signal, undefined, 'wikidata_entities', inStep(onPhase, 'Deriving the claims, labels and sitelinks'));
    onPhase('Indexing...');
    await indexNextTables(signal, ['wikidata_claims', 'wikidata_labels', 'wikidata_sitelinks'], inStep(onPhase, 'Indexing'));
    onPhase('Walking the class tree...');
    await deriveClassClosure(signal);
    await indexNextTables(signal, ['wikidata_class_closure'], inStep(onPhase, 'Walking the class tree'));
    signal.throwIfAborted();
    onPhase('Swapping the derived tables in...');
    // The entities are the build's in place, so are what kept and wrote them; the derivations are this code's.
    await swapIn(buildId, latest.dumpDate, latest.counts, { ...(latest.rules ?? currentRules()), derive: DERIVE_VERSION }, DERIVED_TABLES);
  } catch (error) {
    await dropDerivedNextTables().catch(() => undefined);
    throw error;
  }
}
