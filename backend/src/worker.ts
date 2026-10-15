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
const { failBuildsOf } = await import('./services/dumps/ledger.js');

// Something no build caught ends the worker, but not before the builds it
// runs say why (#1467, #1488): the row gets the error's message, the log its
// stack, which the admin panel must not be sent. The first such error ends
// the worker; any that follow while the row is written are logged only.
// Compose starts the worker again (`restart: on-failure:5`).
let ending = false;
const end = (what: string) => (error: unknown) => {
  console.error('[Dumps] Worker ended by %s: %s', what, error instanceof Error ? error.stack ?? error.message : String(error));
  if (ending) return;
  ending = true;
  const message = error instanceof Error ? error.message : String(error);
  failBuildsOf(WORKER_RUNNER, `The dump worker ended on ${what}: ${message}`)
    .catch(recordError => console.error('[Dumps] Could not record why the worker ended:', recordError))
    .finally(() => process.exit(1));
};
process.on('uncaughtException', end('an uncaught exception'));
process.on('unhandledRejection', end('an unhandled rejection'));

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
