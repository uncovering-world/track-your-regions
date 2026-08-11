import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The two schema homes must agree.
 *
 * `db/init/01-schema.sql` is what an empty database gets and what an existing
 * one is re-applied to gain new columns; `db/migrations/018-curation-gate.sql`
 * and `019-published-curation-action.sql` are what a database already holding
 * data gets by hand. A column added to one
 * and forgotten in the other is invisible until a fresh database behaves
 * differently from the dev one — which is exactly the class of bug nobody finds
 * quickly. There is no database in this suite, so this is a text-level guard;
 * it cannot prove the SQL runs, only that neither file lost a column.
 *
 * Every assertion works on the file with its whitespace collapsed, so the
 * statements can be indented and wrapped however the files find readable while
 * the expected text stays a plain literal.
 */
const repoRoot = join(__dirname, '..', '..', '..');
const collapse = (sql: string) => sql.replace(/\s+/g, ' ');
const schema = collapse(readFileSync(join(repoRoot, 'db', 'init', '01-schema.sql'), 'utf8'));
const migration = collapse(
  readFileSync(join(repoRoot, 'db', 'migrations', '018-curation-gate.sql'), 'utf8'),
);
const publishMigration = collapse(
  readFileSync(join(repoRoot, 'db', 'migrations', '019-published-curation-action.sql'), 'utf8'),
);
/** Uncollapsed, for the assertions that are about how a line starts. */
const migrationLines = readFileSync(
  join(repoRoot, 'db', 'migrations', '018-curation-gate.sql'),
  'utf8',
);
const publishMigrationLines = readFileSync(
  join(repoRoot, 'db', 'migrations', '019-published-curation-action.sql'),
  'utf8',
);

const GATE_COLUMNS: Array<[table: string, column: string]> = [
  ['experiences', 'curation_state'],
  ['experiences', 'published_at'],
  ['experiences', 'pending_change_sync_log_id'],
  ['experience_locations', 'curation_state'],
  ['experience_treasures', 'curation_state'],
  ['treasures', 'curation_state'],
];

/** The three sources that predate the gate and must keep publishing on arrival. */
const CATEGORIES_BEFORE_THE_GATE = [
  'UNESCO World Heritage Sites',
  'Top Art Museums',
  'Public Art & Monuments',
];

const STATE_TABLES = ['experiences', 'experience_locations', 'experience_treasures', 'treasures'];

describe('the curation gate exists in both schema homes', () => {
  for (const [table, column] of GATE_COLUMNS) {
    it(`01-schema.sql adds ${table}.${column}`, () => {
      expect(schema).toContain(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column}`);
    });

    it(`migration 018 adds ${table}.${column}`, () => {
      expect(migration).toContain(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column}`);
    });
  }

  it('every state column is constrained to the three states, per table, in both files', () => {
    // A column that accepts any string is a column that will eventually hold
    // 'Pending' or 'published' and silently stop matching every predicate.
    // Named per table rather than counted: four occurrences with two on one
    // table and none on another satisfies a count and leaves a column open.
    for (const table of STATE_TABLES) {
      const constraint =
        `ADD CONSTRAINT ${table}_curation_state_check ` +
        `CHECK (curation_state IN ('pending', 'auto', 'verified'))`;
      expect(schema).toContain(constraint);
      expect(migration).toContain(constraint);
    }
  });

  it('both files state the truth about the three categories that predate the gate', () => {
    // Leaving them `true` would not record that they publish unread,
    // it would silently change it — every arrival from the next run invisible
    // with nobody having decided anything. Named one at a time rather than
    // blanket-updated, so a source added between either file being written and
    // being applied is not silently trusted.
    for (const sql of [schema, migration]) {
      expect(sql).toContain(
        'UPDATE experience_categories SET requires_curation = false WHERE name IN (',
      );
      for (const name of CATEGORIES_BEFORE_THE_GATE) {
        expect(sql).toContain(`'${name}'`);
      }
    }
  });

  it('creates the gate column and answers for the three predating sources in one guard, identically in both files', () => {
    // The whole ordering problem lives here. Nothing in this repo records which
    // of these files a database has seen, and either can reach it first:
    //
    //  - an unguarded UPDATE re-runs after an admin has gated a source and
    //    silently un-gates it;
    //  - an UPDATE guarded only on the column existing is skipped when the other
    //    file created the column first, leaving all three gated by the
    //    `DEFAULT true` backfill — and the next run of each publishing nothing a
    //    reader can see.
    //
    // Creating the column and naming those three inside one guard is what makes
    // both orders and any number of re-applications come out the same. Asserted
    // as one block, byte-identical in both files, because a copy that drifted in
    // either direction is the bug.
    const named = CATEGORIES_BEFORE_THE_GATE.map(name => `'${name}'`).join(', ');
    const guard =
      `DO $$ BEGIN ` +
      `IF NOT EXISTS ( SELECT 1 FROM information_schema.columns ` +
      `WHERE table_name = 'experience_categories' AND column_name = 'requires_curation' ` +
      `) THEN ` +
      `ALTER TABLE experience_categories ` +
      `ADD COLUMN requires_curation BOOLEAN NOT NULL DEFAULT true; ` +
      `UPDATE experience_categories SET requires_curation = false ` +
      `WHERE name IN (${named}); ` +
      `END IF; ` +
      `END $$;`;
    expect(schema).toContain(guard);
    expect(migration).toContain(guard);
  });

  it('never sets requires_curation outside that guard', () => {
    // An `ADD COLUMN IF NOT EXISTS` for this one column, or a second `UPDATE`
    // anywhere, reintroduces exactly the ordering hole the guard closes.
    for (const sql of [schema, migration]) {
      expect(sql).not.toContain(
        'ALTER TABLE experience_categories ADD COLUMN IF NOT EXISTS requires_curation',
      );
      expect(sql.match(/UPDATE experience_categories SET requires_curation/g) ?? []).toHaveLength(1);
    }
  });

  it('every seeded category decides its own gate in 01-schema.sql', () => {
    // A fresh database gets its categories from these INSERTs and never runs
    // migration 018, so a seed that omits the column takes the `true` default
    // and gates a source the migrated database publishes from — the two homes
    // agreeing about columns while disagreeing about behaviour.
    const seeds = schema.match(/INSERT INTO experience_categories .*?ON CONFLICT [^;]*;/g) ?? [];
    // Every seed must be captured, or a future one written without ON CONFLICT
    // would slip past the loop below without failing anything.
    expect(seeds.length).toBe((schema.match(/INSERT INTO experience_categories/g) ?? []).length);
    expect(seeds.length).toBeGreaterThan(0);
    for (const seed of seeds) {
      expect(seed).toContain('requires_curation');
    }
    // Naming the column is not enough: a seed that names it and passes `true`
    // would gate a source on every fresh database while the migrated one keeps
    // publishing from it. The three that predate the gate must say `false`.
    for (const name of CATEGORIES_BEFORE_THE_GATE) {
      const seed = seeds.find(statement => statement.includes(`'${name}'`));
      expect(seed, `${name} is not seeded`).toBeDefined();
      expect(seed, `${name} is seeded gated`).toContain('false');
    }
  });

  it('the migration is not defeated by how it is invoked', () => {
    // db/migrations/README.md: psql exits 0 when a statement in a piped script
    // fails, so the file sets this itself rather than trusting the caller.
    expect(migrationLines).toMatch(/^\\set ON_ERROR_STOP on$/m);
  });
});

/**
 * Every action a curator's write records, in both schema homes.
 *
 * `experience_curation_log.action` is a CHECK, so an endpoint writing a value
 * the list does not carry does not merely lose its audit row — the insert sits
 * inside the write's own transaction, so the whole decision rolls back. That
 * makes the list part of the contract of every curator endpoint, and adding an
 * action a code change alone.
 */
describe('the curation log accepts every action a curator endpoint writes', () => {
  const ACTIONS = [
    'created', 'rejected', 'unrejected', 'edited', 'added_to_region', 'removed_from_region',
    'marked_former', 'marked_lost', 'state_restored', 'accepted_source', 'missing_dismissed',
    'admission_confirmed', 'admission_overridden',
    // ADR-0025 § 4.4 — what POST /:id/publish records.
    'published',
  ];
  const quoted = ACTIONS.map(action => `'${action}'`).join(', ');
  const actionCheck = `CHECK (action IN (${quoted}))`;

  it('01-schema.sql names them in both of its two copies', () => {
    // The file states the list twice on purpose: once inline, for a fresh
    // database, and once as a DROP/ADD, for an existing one being re-applied.
    // Widening only the second leaves a fresh database with the old list —
    // until the ALTER two lines later happens to fix it, which makes the inline
    // copy look optional and is exactly how it would come to drift. Counted,
    // because `toContain` is satisfied by either one alone.
    expect(schema.split(actionCheck)).toHaveLength(3);
  });

  it('migration 019 names the same list', () => {
    expect(publishMigration).toContain(actionCheck);
  });

  it('migration 019 is not defeated by how it is invoked', () => {
    expect(publishMigrationLines).toMatch(/^\\set ON_ERROR_STOP on$/m);
  });

  it('migration 019 re-adds the constraint it drops, so either file may run first', () => {
    // A bare ADD would fail on a database `01-schema.sql` reached first, and a
    // bare DROP would leave the column unconstrained. The pair is what makes
    // both orders, and any number of re-applications, come out the same.
    const drop = 'ALTER TABLE experience_curation_log DROP CONSTRAINT IF EXISTS experience_curation_log_action_check;';
    expect(publishMigration).toContain(drop);
    expect(publishMigration).toContain(
      `ALTER TABLE experience_curation_log ADD CONSTRAINT experience_curation_log_action_check ${actionCheck}`,
    );
    expect(publishMigration.indexOf(drop)).toBeLessThan(publishMigration.indexOf(actionCheck));
  });
});
