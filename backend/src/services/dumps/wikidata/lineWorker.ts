/**
 * A worker thread of a subset build's pass (`linePool.ts`, #1479): it runs
 * the pass's pure function on each batch of lines it is sent and answers with
 * the result, its typed arrays handed over rather than copied.
 */

import { parentPort, workerData } from 'node:worker_threads';
import { IdSet } from './idSets.js';
import { writeFactsOf } from './lineWork.js';
import type { PassInit, WorkerAnswer } from './linePool.js';
import { scopeFactsOf } from './scope.js';
import { linesOf } from './textLines.js';

const init = workerData as PassInit;
const port = parentPort!;

/** The pass's function for this worker, with pass 2's sets read over the main thread's memory. */
function passOf(pass: PassInit): (lines: string[]) => { answer: unknown; transfer: ArrayBuffer[] } {
  if (pass.pass === 'scope') {
    return lines => {
      const facts = scopeFactsOf(lines);
      const arrays = [facts.properties, facts.sizes, facts.coordinates, facts.classes, facts.neighbours, facts.edges];
      return { answer: facts, transfer: arrays.map(array => array.buffer as ArrayBuffer) };
    };
  }
  const kept = IdSet.overShared(pass.kept);
  const properties = IdSet.overShared(pass.properties);
  return lines => {
    const facts = writeFactsOf(lines, kept, properties);
    return { answer: facts, transfer: [facts.ring.buffer as ArrayBuffer] };
  };
}

const run = passOf(init);

/** A batch: its lines, or a piece of text handed over whole, of which the first `length` bytes are lines. */
interface Batch { id: number; lines?: string[]; text?: ArrayBuffer; length?: number }

port.on('message', ({ id, lines, text, length }: Batch) => {
  try {
    const { answer, transfer } = run(lines ?? linesOf(new Uint8Array(text!, 0, length)));
    port.postMessage({ id, result: answer } satisfies WorkerAnswer<unknown>, transfer);
  } catch (error) {
    port.postMessage({ id, error: error instanceof Error ? error.stack ?? error.message : String(error) } satisfies WorkerAnswer<unknown>);
  }
});
