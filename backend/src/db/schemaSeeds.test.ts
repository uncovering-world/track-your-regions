import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// db/init/01-schema.sql is applied by docker-entrypoint-initdb.d on a fresh
// database, but it is also re-applied by hand to existing databases whenever
// the schema grows new tables or columns (db/migrations/README.md). Every seed
// in it must therefore be idempotent.
const SCHEMA_PATH = fileURLToPath(new URL('../../../db/init/01-schema.sql', import.meta.url));
// eslint-disable-next-line security/detect-non-literal-fs-filename -- path is a literal resolved against this module's own URL
const schema = readFileSync(SCHEMA_PATH, 'utf8');

/** Tables the schema file is expected to seed. A new entry here is a signal to
 *  check that the new seed carries an arbiter of its own. */
const SEEDED_TABLES = ['experience_categories', 'world_views'];

/**
 * Blank out the contents of every `$$ … $$` block, preserving length so offsets
 * into the result still address the original file. Trigger and function bodies
 * are not seeds — their semicolons are not statement terminators, and an
 * `INSERT INTO` inside one (an audit-log write, say) would otherwise be
 * reported as an unguarded seed.
 */
function blankDollarQuotedBodies(sql: string): string {
  return sql
    .split('$$')
    .map((part, i) => (i % 2 === 1 ? ' '.repeat(part.length) : part))
    .join('$$');
}

/** Each `INSERT INTO ...` seed statement, up to its terminating semicolon. */
function seedStatements(): { table: string; sql: string; offset: number }[] {
  // Split on the statement terminator first, then match the table name inside
  // each chunk — a single regex spanning the statement body would need chained
  // quantifiers over overlapping character classes.
  const statements: { table: string; sql: string; offset: number }[] = [];
  const scannable = blankDollarQuotedBodies(schema);
  let offset = 0;

  for (const chunk of scannable.split(';')) {
    // Tolerant of case and of any whitespace run, including a line break: a
    // seed the scanner fails to see would pass the arbiter assertion below by
    // never being collected, which is the one way this guard can go quiet.
    const match = /\bINSERT\s+INTO\s+(\w+)/i.exec(chunk);
    if (match) {
      statements.push({
        table: match[1],
        sql: `${chunk.slice(match.index)};`,
        offset: offset + match.index,
      });
    }
    offset += chunk.length + 1;
  }

  return statements;
}

describe('db/init/01-schema.sql seeds', () => {
  it('finds the seeds it is supposed to guard', () => {
    // Guards the guard: a scanner that silently collects nothing would make
    // every assertion below vacuously true.
    const tables = [...new Set(seedStatements().map((s) => s.table))].sort();

    expect(tables).toEqual(SEEDED_TABLES);
  });

  it('pins every seed to an explicit ON CONFLICT arbiter', () => {
    // A bare `ON CONFLICT DO NOTHING` is not a guard: it only fires on a real
    // unique/exclusion violation, so on a table whose sole unique constraint is
    // a serial primary key it never fires at all. That is how re-applying this
    // file used to add a second "GADM (Default)" world view on every run.
    // Naming the arbiter forces the guard to be backed by an actual index.
    for (const { table, sql } of seedStatements()) {
      expect(sql, `seed into ${table} must name an ON CONFLICT arbiter`).toMatch(
        /ON CONFLICT \([^)]+\)/,
      );
    }
  });

  it('creates the single-default index before seeding GADM', () => {
    const indexOffset = schema.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS idx_world_views_single_default');
    const seed = seedStatements().find((s) => s.table === 'world_views');

    expect(indexOffset).toBeGreaterThan(-1);
    expect(seed).toBeDefined();
    // The arbiter index has to exist before the INSERT that names it, or the
    // seed raises "no unique or exclusion constraint matching the ON CONFLICT".
    expect(indexOffset).toBeLessThan(seed!.offset);
    expect(seed!.sql).toMatch(/ON CONFLICT \(is_default\)\s+WHERE is_default\s+DO NOTHING/);
  });
});
