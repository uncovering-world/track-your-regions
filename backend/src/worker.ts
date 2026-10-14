/**
 * The dump worker's entry point (ADR-0106): runs the builds the admin panel
 * queues, in a process the backend's restarts do not touch. Started by the
 * `dump-worker` compose service with `npm run worker`, with no file watcher.
 * SIGTERM stops the build it runs, whose row then says to start it again,
 * and ends the process.
 */

import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env before the modules that read it, as the backend's entry does.
config({ path: resolve(process.cwd(), '.env') });
config({ path: resolve(process.cwd(), '../.env') });

const { pool } = await import('./db/index.js');
const { workLoop, WORKER_RUNNER } = await import('./services/dumps/dumpWorker.js');

const stop = new AbortController();
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    console.log(`[Dumps] Worker stopping on ${signal}`);
    stop.abort();
  });
}

console.log(`[Dumps] Worker ${WORKER_RUNNER} started`);
await workLoop(stop.signal);
await pool.end();
console.log('[Dumps] Worker stopped');
