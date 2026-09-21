/**
 * What a database has to be called before anything here will write test rows
 * into it.
 *
 * `db/index.ts` defaults to localhost:5432/track_regions — the developer's dev
 * catalogue — when no environment is set. Two things write fixture rows and
 * must never do so there: the E2E seed (`seed/e2eFixture.ts`), which deletes and
 * re-inserts world view 9001, experiences 9001–9005 and the curator and rewinds
 * three sequences, and the database-backed test lane (`vitest.db.config.ts`,
 * #522), whose specs build and tear down rows of their own. Both ask this one
 * pattern, so the rule for "a database a test may write to" is decided once.
 *
 * Anchored to a `test` path component rather than a bare substring: `/test/i`
 * would let "track_regions_latest" through, since "latest" itself contains
 * "test".
 */
export const TEST_DB_NAME_PATTERN = /(^|[_-])test($|[_-])/i;
