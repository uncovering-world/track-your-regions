/**
 * The second pass of a subset build (ADR-0105): every kept entity parsed and
 * written in its compact form, every other entity's terms spooled for the
 * labels ring, and the items the kept ones name gathered as the ring.
 *
 * The lines go to worker threads in batches (`linePool.ts`, #1479), which
 * parse and compact them (`writeFactsOf`); this thread only merges what they
 * answer and writes it. How many batches are in flight is bounded, waiting
 * on the database included, so a slow insert slows the read rather than
 * filling memory.
 */

import type { DumpConsumer } from '../read.js';
import { IdSet } from './idSets.js';
import type { TermsSpool } from './labelsRing.js';
import { LinePool, workerCount } from './linePool.js';
import { type WriteFacts, writeFactsOf } from './lineWork.js';
import { insertRefusing, type Refusals } from './refusals.js';
import type { Scope } from './scope.js';
import { type EntityRow, insertEntities } from './subsetTables.js';

/** Rows per insert: a few megabytes of JSON. */
const BATCH = 2000;
/** Inserts in flight at once while the pass reads on. */
const IN_FLIGHT = 3;
/** Lines a worker is handed at once, or fewer when they run long: the dump's first items run to megabytes each. */
const LINES_PER_TASK = 1000;
const CHARS_PER_TASK = 16_000_000;

export interface WriterCounts {
  written: number;
  spooled: number;
}

export class SubsetWriter implements DumpConsumer {
  readonly ring = new IdSet();
  readonly counts: WriterCounts = { written: 0, spooled: 0 };
  private readonly pool: LinePool<WriteFacts>;
  /** Batches handed to a worker and not yet merged, with what merging them waits on. */
  private readonly tasks = new Set<Promise<void>>();
  private readonly maxTasks: number;
  private lines: string[] = [];
  private chars = 0;
  private linesTaken = 0;
  private batch: EntityRow[] = [];
  private readonly inFlight = new Set<Promise<void>>();
  private failure: unknown = null;

  constructor(
    scope: Scope,
    private readonly spool: TermsSpool,
    /** The build's refused rows, entities and labels alike, under one budget. */
    private readonly refusals: Refusals,
    /** Where the rows go; the table's insert, but a measurement can stand in for it. */
    private readonly insert: (rows: EntityRow[]) => Promise<void> = insertEntities,
    workers = workerCount(),
  ) {
    const shared = workers > 0
      ? { kept: scope.kept.toShared(), properties: scope.properties.toShared() }
      : { kept: new SharedArrayBuffer(1), properties: new SharedArrayBuffer(1) };
    this.pool = new LinePool<WriteFacts>(workers, { pass: 'write', ...shared }, lines => writeFactsOf(lines, scope.kept, scope.properties));
    this.maxTasks = Math.max(2, workers * 2);
  }

  async line(line: string): Promise<void> {
    if (this.failure) throw this.failure;
    this.lines.push(line);
    this.chars += line.length;
    if (this.lines.length >= LINES_PER_TASK || this.chars >= CHARS_PER_TASK) await this.dispatch();
  }

  /** A piece of the dump's text, split into lines by a worker (`readDump`'s chunk path). */
  async chunk(text: Uint8Array): Promise<void> {
    if (this.failure) throw this.failure;
    await this.dispatch();
    await this.send(text);
  }

  lineCount(): number {
    return this.linesTaken;
  }

  async commit(): Promise<void> {
    try {
      await this.dispatch();
      await Promise.all(this.tasks);
      if (this.failure) throw this.failure;
      await this.flush();
      await Promise.all(this.inFlight);
      if (this.failure) throw this.failure;
    } finally {
      await this.pool.close();
    }
  }

  async abort(): Promise<void> {
    await this.pool.close();
    await Promise.allSettled([...this.tasks, ...this.inFlight]);
  }

  /** Hand the lines gathered so far to a worker, once fewer than the bound are in flight. */
  private async dispatch(): Promise<void> {
    const lines = this.lines;
    this.lines = [];
    this.chars = 0;
    if (lines.length > 0) await this.send(lines);
  }

  private async send(input: string[] | Uint8Array): Promise<void> {
    while (this.tasks.size >= this.maxTasks) await Promise.race(this.tasks);
    if (this.failure) throw this.failure;
    const task = this.pool.run(input)
      .then(facts => this.merge(facts))
      .catch((error: unknown) => { this.failure ??= error; })
      .finally(() => { this.tasks.delete(task); });
    this.tasks.add(task);
  }

  private async merge(facts: WriteFacts): Promise<void> {
    this.linesTaken += facts.lines;
    for (const item of facts.ring) this.ring.add(item);
    if (facts.spooled > 0) {
      await this.spool.writeText(facts.spool);
      this.counts.spooled += facts.spooled;
    }
    for (const row of facts.rows) {
      this.batch.push(row);
      if (this.batch.length >= BATCH) await this.flush();
    }
  }

  private async flush(): Promise<void> {
    const rows = this.batch;
    this.batch = [];
    if (rows.length === 0) return;
    while (this.inFlight.size >= IN_FLIGHT) await Promise.race(this.inFlight);
    const insert = insertRefusing(rows, row => row.id, this.insert, this.refusals)
      .then(written => { this.counts.written += written; })
      .catch((error: unknown) => { this.failure ??= error; })
      .finally(() => { this.inFlight.delete(insert); });
    this.inFlight.add(insert);
  }
}
