/**
 * The second pass of a subset build (ADR-0105): every kept entity parsed and
 * written in its compact form, every other entity's terms spooled for the
 * labels ring, and the items the kept ones name gathered as the ring.
 *
 * The pieces of the dump go to worker threads (`linePool.ts`, #1479), which
 * parse and compact them (`writeFactsOf`); this thread only writes what they
 * answer. A piece is written whole or not at all (#1493): its terms are
 * appended to the spool, then its rows and its record go in one transaction
 * (`commitPiece`), so a build that picks up after a cut skips exactly the
 * pieces it finds recorded. How many pieces are in flight is bounded, the
 * database's share included, so a slow insert slows the read rather than
 * filling memory.
 */

import type { DumpConsumer } from '../read.js';
import { IdSet } from './idSets.js';
import type { TermsSpool } from './labelsRing.js';
import { LinePool, workerCount } from './linePool.js';
import { type WriteFacts, writeFactsOf } from './lineWork.js';
import type { Refusals } from './refusals.js';
import type { Scope } from './scope.js';
import { commitPiece, type EntityRow, type PieceRecord, PIECES_IN_FLIGHT, type ResumeState } from './subsetTables.js';

/** How a piece's rows and record are written: `commitPiece`, or a stand-in for a measurement or a spec. */
export type WritePiece = (record: PieceRecord, rows: EntityRow[], refusals: Pick<Refusals, 'refuse'>) => Promise<number>;

/** Lines a worker is handed at once on the line path, or fewer when they run long. */
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
  /** Pieces handed to a worker and not yet written. */
  private readonly tasks = new Set<Promise<void>>();
  private readonly maxTasks: number;
  private readonly done: ResumeState['pieces'];
  private lines: string[] = [];
  private chars = 0;
  private linesTaken = 0;
  /** The next piece's number on the line path, where the read numbers none. */
  private nextPiece = 0;
  private failure: unknown = null;
  /** Piece transactions open now, held under `PIECES_IN_FLIGHT` whatever the worker count. */
  private committing = 0;
  private readonly waitingToCommit: Array<() => void> = [];

  constructor(
    scope: Scope,
    private readonly spool: TermsSpool,
    /** The build's refused rows, entities and labels alike, under one budget. */
    private readonly refusals: Refusals,
    /** What an earlier build of the same file and scope wrote, to skip (#1493). */
    resume: ResumeState | null = null,
    /** Where a piece is written; the table's transaction, but a measurement can stand in for it. */
    private readonly writePiece: WritePiece = commitPiece,
    workers = workerCount(),
  ) {
    const shared = workers > 0
      ? { kept: scope.kept.toShared(), properties: scope.properties.toShared() }
      : { kept: new SharedArrayBuffer(1), properties: new SharedArrayBuffer(1) };
    this.pool = new LinePool<WriteFacts>(workers, { pass: 'write', ...shared }, lines => writeFactsOf(lines, scope.kept, scope.properties));
    this.maxTasks = Math.max(2, workers * 2);
    this.done = resume?.pieces ?? new Map();
    for (const piece of this.done.values()) {
      for (const item of piece.ring) this.ring.add(item);
      this.counts.written += piece.written;
      this.counts.spooled += piece.spooled;
      this.refusals.restore(piece.refused);
    }
  }

  async line(line: string): Promise<void> {
    if (this.failure) throw this.failure;
    this.lines.push(line);
    this.chars += line.length;
    if (this.lines.length >= LINES_PER_TASK || this.chars >= CHARS_PER_TASK) await this.dispatch();
  }

  /** A piece of the dump's text, split into lines by a worker (`readDump`'s chunk path); skipped when already written. */
  async chunk(text: Uint8Array, piece: number): Promise<void> {
    if (this.failure) throw this.failure;
    const written = this.done.get(piece);
    if (written) {
      this.linesTaken += written.lines;
      return;
    }
    await this.send(text, piece);
  }

  lineCount(): number {
    return this.linesTaken;
  }

  async commit(): Promise<void> {
    try {
      await this.dispatch();
      await Promise.all(this.tasks);
      if (this.failure) throw this.failure;
    } finally {
      await this.pool.close();
    }
  }

  async abort(): Promise<void> {
    await this.pool.close();
    await Promise.allSettled(this.tasks);
  }

  private async dispatch(): Promise<void> {
    const lines = this.lines;
    this.lines = [];
    this.chars = 0;
    if (lines.length > 0) {
      await this.send(lines, this.nextPiece);
      this.nextPiece += 1;
    }
  }

  private async send(input: string[] | Uint8Array, piece: number): Promise<void> {
    while (this.tasks.size >= this.maxTasks) await Promise.race(this.tasks);
    if (this.failure) throw this.failure;
    const task = this.pool.run(input)
      .then(facts => this.write(facts, piece))
      .catch((error: unknown) => { this.failure ??= error; })
      .finally(() => { this.tasks.delete(task); });
    this.tasks.add(task);
  }

  /** The piece's terms to the spool, then its rows and record in one transaction; only then is it counted. */
  private async write(facts: WriteFacts, piece: number): Promise<void> {
    const spoolEnd = await this.spool.append(facts.spool);
    while (this.committing >= PIECES_IN_FLIGHT) await new Promise<void>(resolve => this.waitingToCommit.push(resolve));
    this.committing += 1;
    let written: number;
    try {
      written = await this.writePiece(
        { piece, lines: facts.lines, spooled: facts.spooled, spoolEnd, ring: facts.ring }, facts.rows, this.refusals,
      );
    } finally {
      this.committing -= 1;
      this.waitingToCommit.shift()?.();
    }
    this.linesTaken += facts.lines;
    this.counts.written += written;
    this.counts.spooled += facts.spooled;
    for (const item of facts.ring) this.ring.add(item);
  }
}
