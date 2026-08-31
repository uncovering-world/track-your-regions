import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The ledger that says which files in db/migrations/ a database has been
// through (#435, ADR-0041). Two things have to hold for it to mean anything,
// and neither is visible from the runner's own test — that one needs a
// Postgres and stays a local gate:
//
//   * the table is in the canonical schema, so every database has one;
//   * every migration filename fits the shape the runner orders files by.
//
// The second is checked against the pattern read out of the runner itself,
// rather than against a copy of it written here. One rule, stated once: a
// change to the shell script that this repository's files no longer satisfy
// fails here instead of on somebody's db:migrate.

const SCHEMA_PATH = fileURLToPath(new URL('../../../db/init/01-schema.sql', import.meta.url));
const MIGRATIONS_DIR = fileURLToPath(new URL('../../../db/migrations', import.meta.url));
const RUNNER_PATH = fileURLToPath(new URL('../../../scripts/db-migrate.sh', import.meta.url));

// eslint-disable-next-line security/detect-non-literal-fs-filename -- path is a literal resolved against this module's own URL
const schema = readFileSync(SCHEMA_PATH, 'utf8');
// eslint-disable-next-line security/detect-non-literal-fs-filename -- path is a literal resolved against this module's own URL
const runner = readFileSync(RUNNER_PATH, 'utf8');
// eslint-disable-next-line security/detect-non-literal-fs-filename -- path is a literal resolved against this module's own URL
const migrationFiles = readdirSync(MIGRATIONS_DIR)
  .filter(name => name.endsWith('.sql'))
  .sort();

/** The filename rule, taken from the runner rather than restated. */
function runnerFilenamePattern(): RegExp {
  const match = /^FILENAME_PATTERN='(.+)'$/m.exec(runner);
  if (!match) {
    throw new Error('FILENAME_PATTERN not found in scripts/db-migrate.sh');
  }
  // eslint-disable-next-line security/detect-non-literal-regexp -- the pattern is read from a tracked file in this repository, deliberately, so that it and the runner cannot drift apart; no input reaches it
  return new RegExp(match[1]);
}

describe('the migration ledger', () => {
  it('is created by the canonical schema', () => {
    // A database that has no ledger cannot record a migration, and the runner
    // refuses to define the table itself rather than becoming a second source
    // of truth for it.
    expect(schema).toMatch(/CREATE TABLE IF NOT EXISTS schema_migrations\s*\(/);
  });

  it('carries the four things a record has to state', () => {
    const table = /CREATE TABLE IF NOT EXISTS schema_migrations\s*\(([\s\S]*?)\n\);/.exec(schema);
    expect(table).not.toBeNull();
    const body = table![1];

    // Which file, so a record can be matched to one; its checksum, so a file
    // edited afterwards can be told apart; whether this database ran it or a
    // person asserted it; and when.
    expect(body).toMatch(/filename\s+TEXT PRIMARY KEY/);
    expect(body).toMatch(/checksum\s+TEXT NOT NULL/);
    expect(body).toMatch(/ran\s+BOOLEAN NOT NULL/);
    expect(body).toMatch(/applied_at\s+TIMESTAMPTZ NOT NULL/);
  });
});

describe('db/migrations filenames', () => {
  it('finds the migrations it is supposed to guard', () => {
    // Guards the guard: a scanner reading an empty directory would pass every
    // assertion below by never making one.
    expect(migrationFiles.length).toBeGreaterThan(30);
  });

  it('all fit the shape the runner orders them by', () => {
    const pattern = runnerFilenamePattern();
    const offenders = migrationFiles.filter(name => !pattern.test(name));
    expect(offenders).toEqual([]);
  });

  it('rejects a name that does not, so the rule is a rule', () => {
    // The pattern is read from a shell script; a broken read that produced
    // something permissive would let the assertion above pass on anything.
    const pattern = runnerFilenamePattern();
    expect(pattern.test('41-no-padding.sql')).toBe(false);
    expect(pattern.test('041-Trailing-Caps.sql')).toBe(false);
    expect(pattern.test('041-a-migration.sql.bak')).toBe(false);
    expect(pattern.test('041-a-migration.sql')).toBe(true);
  });

  it('use each number once, so their order is not a guess', () => {
    const numbers = migrationFiles.map(name => name.slice(0, 3));
    expect(numbers).toEqual([...new Set(numbers)]);
  });
});
