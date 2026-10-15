/**
 * The first pass of a subset build as a dump consumer (#1479): lines go to
 * worker threads in batches (`linePool.ts`), each scanned by `scopeFactsOf`,
 * and what they answer is absorbed into the `ScopeCollector` in the order of
 * the dump, whatever order the workers finish in. The order is the scope:
 * `ScopeCollector.chains` walks its edges in the order they arrived, so an
 * absorb in finishing order could keep another set of items.
 */

import type { DumpConsumer } from '../read.js';
import { LinePool, workerCount } from './linePool.js';
import { ScopeCollector, type ScopeFacts, scopeFactsOf } from './scope.js';

const LINES_PER_TASK = 2000;
const CHARS_PER_TASK = 16_000_000;

export class ScopeReader implements DumpConsumer {
  readonly collector = new ScopeCollector();
  private readonly pool: LinePool<ScopeFacts>;
  private readonly maxTasks: number;
  /** Batches handed over and not yet absorbed, by their place in the dump. */
  private readonly pending = new Map<number, Promise<ScopeFacts>>();
  private lines: string[] = [];
  private chars = 0;
  private sent = 0;
  private absorbed = 0;
  private linesTaken = 0;

  constructor(workers = workerCount()) {
    this.pool = new LinePool<ScopeFacts>(workers, { pass: 'scope' }, scopeFactsOf);
    this.maxTasks = Math.max(2, workers * 2);
  }

  async line(line: string): Promise<void> {
    this.lines.push(line);
    this.chars += line.length;
    if (this.lines.length >= LINES_PER_TASK || this.chars >= CHARS_PER_TASK) await this.dispatch();
  }

  /** A piece of the dump's text, split into lines by a worker (`readDump`'s chunk path). */
  async chunk(text: Uint8Array): Promise<void> {
    await this.dispatch();
    await this.send(text);
  }

  lineCount(): number {
    return this.linesTaken;
  }

  async commit(): Promise<void> {
    try {
      await this.dispatch();
      while (this.absorbed < this.sent) await this.absorbNext();
    } finally {
      await this.pool.close();
    }
  }

  async abort(): Promise<void> {
    await this.pool.close();
    await Promise.allSettled(this.pending.values());
  }

  private async dispatch(): Promise<void> {
    const lines = this.lines;
    this.lines = [];
    this.chars = 0;
    if (lines.length > 0) await this.send(lines);
  }

  private async send(input: string[] | Uint8Array): Promise<void> {
    while (this.sent - this.absorbed >= this.maxTasks) await this.absorbNext();
    const answer = this.pool.run(input);
    // Settled here so a batch that fails before its turn is not an unhandled rejection; its turn rethrows.
    answer.catch(() => undefined);
    this.pending.set(this.sent, answer);
    this.sent += 1;
  }

  /** Absorb the oldest batch in flight, waiting for it if a later one finished first. */
  private async absorbNext(): Promise<void> {
    const answer = this.pending.get(this.absorbed)!;
    this.pending.delete(this.absorbed);
    this.absorbed += 1;
    const facts = await answer;
    this.linesTaken += facts.lines;
    this.collector.absorb(facts);
  }
}
