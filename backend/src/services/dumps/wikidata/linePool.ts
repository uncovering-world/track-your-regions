/**
 * Worker threads for a pass of a subset build (#1479). The main thread hands
 * over pieces of the dump's text, or batches of lines; a worker splits a
 * piece into lines (`textLines.ts`), runs the pass's pure function on them
 * (`scopeFactsOf`, `writeFactsOf`) and answers in typed arrays and strings,
 * which the main thread only merges.
 *
 * With no workers (`DUMP_WORKERS=0`) the same function runs on the main
 * thread: one code path, so a build in workers writes what a build without
 * them writes. The caller bounds how many batches are in flight.
 */

import { createRequire } from 'node:module';
import { availableParallelism } from 'node:os';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { linesOf } from './textLines.js';

/** What a worker is started with: which pass, and for pass 2 the scope's sets in shared memory. */
export type PassInit = { pass: 'scope' } | { pass: 'write'; kept: SharedArrayBuffer; properties: SharedArrayBuffer };

/** A batch's answer from a worker: what the pass made of it, or why it failed. */
export interface WorkerAnswer<R> { id: number; result?: R; error?: string }

/**
 * How many workers a pass runs: `DUMP_WORKERS` when set, else every core but
 * one, which the main thread and PostgreSQL share.
 */
export function workerCount(): number {
  const configured = process.env.DUMP_WORKERS;
  if (configured !== undefined && configured !== '') return Math.max(0, Math.floor(Number(configured)) || 0);
  return Math.max(1, availableParallelism() - 1);
}

const here = fileURLToPath(import.meta.url);
/** The worker's module beside this one: `.ts` under tsx and in the specs, `.js` once compiled. */
const WORKER_URL = new URL(`./lineWorker${extname(here)}`, import.meta.url);
/**
 * A compiled worker is started from its file. A `.ts` one is started from a
 * line that registers tsx in the worker and then imports it: a loader given
 * through `execArgv` does not reach a worker on every Node this runs on (the
 * image's Node 22 drops it), and Node's own type stripping would load the
 * worker but not resolve its `.js` imports to the sources beside it.
 */
function startWorker(init: PassInit): Worker {
  if (extname(here) !== '.ts') return new Worker(WORKER_URL, { workerData: init });
  const tsx = createRequire(import.meta.url).resolve('tsx/esm/api');
  const boot = `require(${JSON.stringify(tsx)}).register(); import(${JSON.stringify(WORKER_URL.href)});`;
  return new Worker(boot, { eval: true, workerData: init });
}

interface Waiting<R> {
  resolve: (result: R) => void;
  reject: (error: Error) => void;
  worker: number;
}

export class LinePool<R> {
  private readonly workers: Worker[] = [];
  private readonly load: number[] = [];
  private readonly waiting = new Map<number, Waiting<R>>();
  private nextId = 0;
  private broken: Error | null = null;

  constructor(size: number, init: PassInit, private readonly inline: (lines: string[]) => R) {
    for (let index = 0; index < size; index += 1) {
      const worker = startWorker(init);
      worker.on('message', (answer: WorkerAnswer<R>) => this.answered(answer));
      worker.on('error', error => this.fail(error));
      worker.on('exit', code => {
        if (code !== 0) this.fail(new Error(`A dump worker thread exited with code ${code}`));
      });
      this.workers.push(worker);
      this.load.push(0);
    }
  }

  get size(): number {
    return this.workers.length;
  }

  /**
   * What the pass makes of `input` — lines, or a piece of text that ends at a
   * line's end — from the least busy worker, or on this thread with none. A
   * piece is handed over, not copied, when it owns its memory from the start;
   * the caller does not touch it after.
   */
  run(input: string[] | Uint8Array): Promise<R> {
    if (this.broken) return Promise.reject(this.broken);
    if (this.workers.length === 0) {
      try {
        return Promise.resolve(this.inline(Array.isArray(input) ? input : linesOf(input)));
      } catch (error) {
        return Promise.reject(error as Error);
      }
    }
    const worker = this.load.indexOf(Math.min(...this.load));
    const id = this.nextId;
    this.nextId += 1;
    this.load[worker] += 1;
    return new Promise<R>((resolve, reject) => {
      this.waiting.set(id, { resolve, reject, worker });
      if (Array.isArray(input)) {
        this.workers[worker].postMessage({ id, lines: input });
        return;
      }
      const owned = input.byteOffset === 0 && input.buffer instanceof ArrayBuffer ? input : new Uint8Array(input);
      const buffer = owned.buffer as ArrayBuffer;
      this.workers[worker].postMessage({ id, text: buffer, length: owned.byteLength }, [buffer]);
    });
  }

  /** Stops every worker; a batch still waiting fails. */
  async close(): Promise<void> {
    this.fail(new Error('The dump workers were stopped'));
    await Promise.all(this.workers.map(worker => worker.terminate()));
  }

  private answered({ id, result, error }: WorkerAnswer<R>): void {
    const waiting = this.waiting.get(id);
    if (!waiting) return;
    this.waiting.delete(id);
    this.load[waiting.worker] -= 1;
    if (error !== undefined) waiting.reject(new Error(error));
    else waiting.resolve(result as R);
  }

  private fail(error: Error): void {
    this.broken ??= error;
    for (const waiting of this.waiting.values()) waiting.reject(this.broken);
    this.waiting.clear();
  }
}
