import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';
import type { PoolClient } from 'pg';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'track_regions',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

export const db = drizzle(pool, { schema });

// Raw pool for custom queries (geometry operations)
export { pool };

/**
 * Undo a transaction without letting the undo replace what went wrong.
 *
 * A ROLLBACK on a connection that has already failed rejects in its own right,
 * and an unguarded `await` in a catch block throws that instead of the error
 * the caller needs to see. Lives here because more than one controller runs a
 * transaction and every one of them has this hazard.
 *
 * Returns the rollback's own failure, if any, for the caller to hand to
 * `client.release()`. That is not optional bookkeeping: `pg-pool` keeps a
 * released client unless the argument is truthy or the connection has already
 * gone unqueryable, so a client whose ROLLBACK failed while the socket still
 * works would go back to the idle pool carrying an open transaction.
 */
export async function rollbackQuietly(client: PoolClient): Promise<Error | undefined> {
  try {
    await client.query('ROLLBACK');
    return undefined;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}
