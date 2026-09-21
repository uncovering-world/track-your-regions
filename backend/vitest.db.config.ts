import { defineConfig } from 'vitest/config';

/**
 * The database-backed lane: specs that execute a statement against a real
 * PostgreSQL and assert on the rows it selected (#522).
 *
 * The unit suite (`vitest.config.ts`) mocks the `pg` pool and asserts the text of
 * the SQL a function sends, which pins predicates and parameter binding cheaply
 * and cannot see which row a statement picks. The pairing CTE in
 * `src/services/sync/locationWriter.ts` passed twelve text tests while choosing
 * the wrong old row; four statements on a database found it. A spec belongs here
 * when its assertion is about which rows a statement selects, not about what it
 * says — see docs/tech/development-guide.md § Tests that need a database.
 *
 * A second config rather than a second `projects` entry in the first one, on
 * purpose: a bare `vitest run` runs every project, and the two places that type
 * it — CI's Unit Tests job and the host lane under TEST_REPORT_LOCAL=1 — have no
 * database to offer. Kept apart, those never select a `*.db.test.ts`, and this
 * lane is asked for by name: `npm run test:db`, which runs it inside the isolated
 * test stack against track_regions_test (scripts/test-stack.sh run-backend-db).
 *
 * The global setup refuses to start unless the connection lands on a database
 * whose name says `test`, and fails — never skips — when none answers: a green
 * run of this lane always executed its statements.
 *
 * This file is baked into the backend image (backend/Dockerfile copies the
 * package root; only `src/` is bind-mounted), so an edit here reaches the
 * container through the `--build` that `ensure_up` always performs, not through
 * the mount.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.db.test.ts'],
    // The specs share one database. Run files one after another so a fixture
    // being built in one is never read half-built by another.
    fileParallelism: false,
    globalSetup: ['src/testSupport/dbLane.globalSetup.ts'],
  },
});
