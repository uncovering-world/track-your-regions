import { Pool } from 'pg';
import { TEST_DB_NAME_PATTERN } from '../db/testDbName.js';

/**
 * The database-backed lane's one gate, run once before any of its specs
 * (`vitest.db.config.ts`, #522).
 *
 * Two refusals, and both fail the run rather than skip it. A lane that skipped
 * when no database answered would report green in exactly the places that have
 * none — CI's Unit Tests job, a laptop without Docker — having executed nothing,
 * and the suite's own summary would count that as passing. So a database that
 * does not answer is an error naming the host, and the answer to it is the
 * command that runs this lane where a database exists.
 *
 * The name is checked on the connection, not on the environment: `SELECT
 * current_database()` says where the pool actually landed, which is what the
 * specs are about to write into. `src/db/index.ts` defaults to the developer's
 * own catalogue when nothing is set, and a spec here builds and tears down rows,
 * so anything not named like a test database is refused before a spec loads.
 * Same pattern as the E2E seed's guard, decided once in `src/db/testDbName.ts`.
 *
 * Then it lifts every sequence of the schema to `SEQUENCE_FLOOR` (#2602). The
 * specs pin their rows' ids by hand, below the floor, and the code under test
 * numbers what it creates from the sequences. The E2E seed leaves each
 * sequence just above its own ids, and the lane's writers take values from
 * it, so without the lift a sequence walks through the pinned ids and turns
 * an unchanged spec red whenever an earlier one makes one row more, or the
 * files run in another order. Every sequence is lifted, not only the places': a pinned id is a
 * pinned id in any table, and a floor no spec reaches costs nothing.
 */

/** Above every id a spec pins, and within an `integer` column. */
export const SEQUENCE_FLOOR = 100_000_000;
export default async function requireTestDatabase(): Promise<void> {
  const host = process.env.DB_HOST || 'localhost';
  const port = parseInt(process.env.DB_PORT || '5432');
  const pool = new Pool({
    host,
    port,
    database: process.env.DB_NAME || 'track_regions',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    max: 1,
    connectionTimeoutMillis: 5000,
  });

  let landedOn: string;
  try {
    const result = await pool.query<{ name: string }>('SELECT current_database() AS name');
    landedOn = result.rows[0].name;
  } catch (error) {
    await pool.end().catch(() => undefined);
    // A refused connection arrives as an AggregateError whose message is empty
    // and whose code says what happened; take whichever the error offers.
    const reason = error instanceof Error
      ? ((error as Error & { code?: string }).code ?? error.message)
      : String(error);
    throw new Error(
      `The database-backed lane could not reach PostgreSQL at ${host}:${port} (${reason}). ` +
        'This lane fails rather than skips without a database: `npm run test:db` runs it ' +
        'inside the isolated test stack, against track_regions_test.',
    );
  }

  if (!TEST_DB_NAME_PATTERN.test(landedOn)) {
    await pool.end();
    throw new Error(
      `The database-backed lane landed on "${landedOn}", which is not named like a test ` +
        'database. Its specs write rows, so anything else is refused. Run `npm run test:db`, ' +
        'which points the lane at the isolated test stack.',
    );
  }

  try {
    await liftSequences(pool);
  } finally {
    await pool.end();
  }
}

/**
 * Every sequence of the schema at `SEQUENCE_FLOOR` at least, so nothing the
 * code under test creates takes an id a spec pins. A sequence already past
 * the floor (a second run on the same database) keeps its place.
 */
async function liftSequences(pool: Pool): Promise<void> {
  const { rows } = await pool.query<{ name: string; last_value: string | null }>(
    `SELECT format('%I.%I', schemaname, sequencename) AS name, last_value
       FROM pg_sequences
      WHERE schemaname = 'public' AND max_value >= $1`,
    [SEQUENCE_FLOOR],
  );
  for (const { name, last_value: stood } of rows) {
    if (stood !== null && Number(stood) >= SEQUENCE_FLOOR) continue;
    await pool.query('SELECT setval($1::regclass, $2)', [name, SEQUENCE_FLOOR]);
  }
}
