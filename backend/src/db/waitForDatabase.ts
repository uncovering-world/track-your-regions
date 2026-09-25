import type { Pool } from 'pg';

/**
 * The errors a database that is still coming up answers with: refused or
 * dropped connections while nothing listens yet, a name the network does not
 * resolve yet, and Postgres' own `cannot_connect_now` while it starts or
 * restarts. Anything else — a wrong password, a missing database — is not
 * going to change by waiting, and is thrown at once.
 */
const TRANSIENT_CODES = new Set([
  '57P03', // cannot_connect_now: the database system is starting up
  'ECONNREFUSED',
  'ECONNRESET',
  'EAI_AGAIN',
  'ENOTFOUND',
]);

function transientCode(err: unknown): string | null {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' && TRANSIENT_CODES.has(code) ? code : null;
}

interface WaitOptions {
  attempts?: number;
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Ask the database for `SELECT 1` until it answers, before the server's first
 * real statement (#775).
 *
 * A fresh Postgres container runs its init scripts on a temporary server and
 * then restarts, and a backend that connects in that window is refused. A
 * refusal that ends the process is not recovered from: under `tsx watch`
 * nothing starts it again, and the stack's readiness probe waits out its whole
 * budget for a server that has already died. A bounded wait — about thirty
 * seconds by default, each attempt logged — rides out the restart and still
 * fails loudly on a database that is not coming.
 */
export async function waitForDatabase(
  pool: Pick<Pool, 'query'>,
  { attempts = 15, delayMs = 2000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }: WaitOptions = {},
): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      const code = transientCode(err);
      if (code === null || attempt >= attempts) throw err;
      console.log(`⏳ Database not ready (${code}), retrying in ${delayMs / 1000} s (attempt ${attempt}/${attempts})`);
      await sleep(delayMs);
    }
  }
}
