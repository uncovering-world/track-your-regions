import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The two schema homes must agree.
 *
 * `db/init/01-schema.sql` is what an empty database gets and what an existing
 * one is re-applied to gain new columns; `db/migrations/018-curation-gate.sql`,
 * `019-published-curation-action.sql`, `020-deferred-withdrawal.sql` and
 * `021-held-change-type.sql` are what
 * a database already holding data gets by hand. A column added to one
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
/**
 * The newest migration that restates the curation-log action list, found rather than named.
 *
 * Every migration that widens the list carries the *whole* list, so only the last one states
 * what the column accepts today; the earlier ones are correct history and must not be edited.
 * Naming a file here would pin the guard to whichever migration was newest the day it was
 * written — 019 when the list gained `published`, 022 when it gained `declined_source` — and
 * a guard that quietly checks a superseded file passes for the wrong reason.
 */
const ACTION_CHECK_CONSTRAINT = 'experience_curation_log_action_check';
const migrationsDir = join(repoRoot, 'db', 'migrations');
const actionMigrationFile = readdirSync(migrationsDir)
  .filter(name => name.endsWith('.sql'))
  // The names come from a listing of a fixed in-repo directory, in a test that no request
  // data reaches — the rule is about paths a caller can steer.
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- listing of a fixed in-repo directory
  .filter(name => readFileSync(join(migrationsDir, name), 'utf8').includes(ACTION_CHECK_CONSTRAINT))
  .sort()
  .at(-1) as string;
// eslint-disable-next-line security/detect-non-literal-fs-filename -- same directory listing
const publishMigrationRaw = readFileSync(join(migrationsDir, actionMigrationFile), 'utf8');
const publishMigration = collapse(publishMigrationRaw);
/** Uncollapsed, for the assertions that are about how a line starts. */
const migrationLines = readFileSync(
  join(repoRoot, 'db', 'migrations', '018-curation-gate.sql'),
  'utf8',
);
const publishMigrationLines = publishMigrationRaw;
const deferralMigrationRaw = readFileSync(
  join(repoRoot, 'db', 'migrations', '020-deferred-withdrawal.sql'),
  'utf8',
);
const deferralMigration = collapse(deferralMigrationRaw);
const heldTypeMigrationRaw = readFileSync(
  join(repoRoot, 'db', 'migrations', '021-held-change-type.sql'),
  'utf8',
);
const heldTypeMigration = collapse(heldTypeMigrationRaw);
const contentsMigrationRaw = readFileSync(
  join(repoRoot, 'db', 'migrations', '023-contents-delta.sql'),
  'utf8',
);
const contentsMigration = collapse(contentsMigrationRaw);
/** The two TypeScript homes of the same list, read as text for the same reason. */
const changeRecorderSource = collapse(
  readFileSync(join(__dirname, '..', 'services', 'sync', 'changeRecorder.ts'), 'utf8'),
);
const backendTypesSource = collapse(
  readFileSync(join(__dirname, '..', 'types', 'index.ts'), 'utf8'),
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
 * Every word a run's changeset can use, in all four homes.
 *
 * `experience_sync_changes.change_type` is a CHECK, and `recordSyncChanges`
 * writes a run's whole per-object record as one batched INSERT — so a single row
 * whose type the list does not carry loses the **entire** breakdown for that run,
 * and the admin is left with a "per-object record could not be written" alert
 * beside real counters and nothing to read. Exactly the screen #519 exists to
 * fix, empty.
 *
 * Two of the homes are SQL: the inline CHECK, and the DROP/ADD that re-applies to
 * an existing database — plus migration 021, for a database that gets only the
 * migration. Widen some of them and a fresh database accepts a value a migrated
 * one rejects, invisible until a real run hits it.
 *
 * The other two are TypeScript, and they are the side a change starts on:
 * `ChangeRecord.changeType` is what the recorder will happily insert, and the
 * `type` filter's zod enum is what the admin API will accept. A ninth type added
 * there alone compiles, passes review, and loses a run's changeset the first time
 * it is written. Whichever home you are editing, the other three are the diff.
 */
describe('the changeset accepts every type a run records', () => {
  const CHANGE_TYPES = [
    'created', 'updated', 'conflict',
    // #519 — the gate refused the write, and a verdict is waiting. Distinct from
    // 'conflict', which is a claim a person made on purpose.
    'held',
    'missing', 'returned', 'failed', 'filtered',
  ];
  const quoted = CHANGE_TYPES.map(type => `'${type}'`).join(', ');
  const typeCheck = `CHECK (change_type IN (${quoted}))`;
  /** The same eight values as a TypeScript union, for the recorder's own home. */
  const union = CHANGE_TYPES.map(type => `'${type}'`).join(' | ');

  it('01-schema.sql names them in both of its two copies', () => {
    // Counted, because `toContain` is satisfied by either copy alone, and the
    // inline one is the only thing a fresh database ever reads.
    expect(schema.split(typeCheck)).toHaveLength(3);
  });

  it('migration 021 names the same list', () => {
    expect(heldTypeMigration).toContain(typeCheck);
  });

  it('migration 021 is not defeated by how it is invoked', () => {
    expect(heldTypeMigrationRaw).toMatch(/^\\set ON_ERROR_STOP on$/m);
  });

  it('the changeset recorder names the same list, in the same order', () => {
    // The type that decides what `recordSyncChanges` will insert. Asserted with
    // its trailing `;` so a ninth member appended before it cannot pass — a
    // substring check on the list alone survives exactly that edit, which is the
    // shape this whole describe exists to catch.
    expect(changeRecorderSource).toContain(`changeType: ${union};`);
  });

  it('the admin API filter accepts the same list, and no more', () => {
    // `?type=` is validated before the controller sees it, so a value missing here
    // answers 400 for a row the changeset legitimately holds — the mirror image of
    // the CHECK problem, and just as invisible from the SQL side. The closing
    // `])` is what makes an added member fail rather than pass.
    expect(backendTypesSource).toContain(`type: z.enum([${quoted}])`);
  });

  it('migration 021 re-adds the constraint it drops, so either file may run first', () => {
    // A bare ADD would fail on a database `01-schema.sql` reached first, and a
    // bare DROP would leave the column unconstrained. The pair is what makes both
    // orders, and any number of re-applications, come out the same.
    const drop = 'ALTER TABLE experience_sync_changes DROP CONSTRAINT IF EXISTS experience_sync_changes_change_type_check;';
    expect(heldTypeMigration).toContain(drop);
    expect(heldTypeMigration).toContain(
      `ALTER TABLE experience_sync_changes ADD CONSTRAINT experience_sync_changes_change_type_check ${typeCheck}`,
    );
    expect(heldTypeMigration.indexOf(drop)).toBeLessThan(heldTypeMigration.indexOf(typeCheck));
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
    'marked_former', 'marked_lost', 'state_restored', 'accepted_source',
    // What POST /:id/decline-source records: a curator standing by their own value,
    // which used to be the absence of an action and therefore left no trace at all.
    // Beside its opposite, because the SQL lists it there and this is a literal
    // comparison — the list's *order* is part of what the two files must agree on.
    'declined_source',
    'missing_dismissed', 'admission_confirmed', 'admission_overridden',
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

  it('the newest action migration names the same list', () => {
    expect(publishMigration).toContain(actionCheck);
  });

  it('the newest action migration is not defeated by how it is invoked', () => {
    expect(publishMigrationLines).toMatch(/^\\set ON_ERROR_STOP on$/m);
  });

  it('the newest action migration re-adds the constraint it drops, so either file may run first', () => {
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

/**
 * Where a held withdrawal is recorded, in both schema homes.
 *
 * One nullable self-reference on `experience_locations`, carried by the arrival
 * and naming the point it replaces. Absent from either file, a gated run writes
 * the pairing into a column that is not there and the whole location write for
 * that experience rolls back on every sync — which is the loudest possible
 * failure and still worth a text-level guard, because the two files are edited
 * separately and nothing else compares them.
 */
describe('a held withdrawal has a column in both schema homes', () => {
  const addColumn =
    'ALTER TABLE experience_locations ADD COLUMN IF NOT EXISTS ' +
    'withdrawal_deferred_for_location_id INTEGER REFERENCES experience_locations(id) ' +
    'ON DELETE SET NULL;';

  it('both files add the column, with the same reference behaviour', () => {
    // `ON DELETE SET NULL` and not `CASCADE`, stated as one literal so the two
    // cannot drift: cascading would make deleting the point a curator wants gone
    // delete the arrival that replaces it — the row a reader is waiting for.
    // `ADD COLUMN IF NOT EXISTS` carries the REFERENCES inside it, so a second
    // application adds neither the column nor a duplicate constraint, whichever
    // file reached the database first.
    expect(schema).toContain(addColumn);
    expect(deferralMigration).toContain(addColumn);
  });

  it('both files index it the same way, partially', () => {
    // The withdrawal statement asks, for each stored row, whether anything is
    // waiting on it — a predicate with no `experience_id` to narrow it, so
    // without this index every changed object of every run scans the table.
    // Partial because the column is NULL on all 6680 rows today and every query
    // asks only about the ones that are not.
    const index =
      'CREATE INDEX IF NOT EXISTS idx_experience_locations_deferred_withdrawal ' +
      'ON experience_locations(withdrawal_deferred_for_location_id) ' +
      'WHERE withdrawal_deferred_for_location_id IS NOT NULL;';
    expect(schema).toContain(index);
    expect(deferralMigration).toContain(index);
  });

  it('migration 020 is not defeated by how it is invoked', () => {
    // db/migrations/README.md: psql exits 0 when a statement in a piped script
    // fails, so the file sets this itself rather than trusting the caller.
    expect(deferralMigrationRaw).toMatch(/^\\set ON_ERROR_STOP on$/m);
  });

  it('nothing on experiences can move a column out from under the upsert', () => {
    // The second of the two facts that make `RETURNING ${HELD} AS was_held`
    // answer with the value the guards read (`syncUtils.ts`). The first — that
    // `curation_state` is never assigned in the `DO UPDATE SET` list — is
    // asserted where that list is built. This is the other one: `RETURNING`
    // reads the post-write tuple, so a BEFORE trigger on `experiences` that
    // touched `curation_state` would make the reported hold describe a
    // different row version than the one the statement acted on, and a held
    // field would be reported as applied (#519) with nothing failing.
    //
    // Every trigger in this schema is on `regions` or `administrative_divisions`
    // (geometry simplification, region metadata, focus data, is_leaf). Asserted
    // rather than assumed, because the invariant lives nowhere else in code and
    // the next person to add a trigger here has no reason to know it exists.
    // `OR REPLACE` is optional in the grammar, and the first version of this
    // guard split on the literal `CREATE OR REPLACE TRIGGER` — so a plain
    // `CREATE TRIGGER … ON experiences` produced no segment, the loop body ran
    // zero times, and the test passed by inspecting nothing. Every trigger in
    // the file happens to carry `OR REPLACE`, which is exactly what made the
    // hole invisible: green for the right reason today, green for the wrong one
    // the moment someone writes the other form.
    // Sliced rather than matched with a lazy quantifier: `[\s\S]*?` over a
    // 2000-line file is what `security/detect-unsafe-regex` objects to, and it
    // is right that a guard about safety should not itself be the backtracking
    // risk. Each `CREATE … TRIGGER` is found by a bounded pattern and its
    // definition read forward to the `EXECUTE FUNCTION` that ends it.
    // Literal spaces, not `\s+`: this file's `schema` already has its
    // whitespace collapsed (see the header), and `\s+(?:…\s+)?` is the nested
    // quantifier `security/detect-unsafe-regex` objects to — fairly, since a
    // guard about safety should not be the backtracking risk in the file.
    const starts = [...schema.matchAll(/CREATE (?:OR REPLACE )?TRIGGER\b/g)];
    const definitions = starts.map((match) => {
      const from = match.index ?? 0;
      const end = schema.indexOf('EXECUTE FUNCTION', from);
      return schema.slice(from, end === -1 ? schema.length : end);
    });

    // Every start yielded a definition, because the previous version's own
    // guard — "at least one was found" — proves that *some* trigger exists
    // rather than that the one just added is among them.
    expect(definitions.length, 'no trigger definitions found at all — has the schema moved?')
      .toBe(starts.length);
    expect(definitions.length).toBeGreaterThan(0);

    for (const definition of definitions) {
      expect(definition, `a trigger fires on experiences: ${definition.slice(0, 120)}`)
        .not.toMatch(/\bON experiences\b/);
    }
  });
});

/**
 * Where a run records what the object holds, in both schema homes (ADR-0026).
 *
 * Missing from `01-schema.sql`, a fresh database takes every insert of a run that
 * moved any contents and fails on an unknown column — every object of every run,
 * since the recorder names the column unconditionally. Missing from the migration,
 * the dev database does the same while a fresh one is fine, which is the harder
 * direction to find.
 */
describe('the contents delta has a column in both schema homes', () => {
  const addColumn = 'ALTER TABLE experience_sync_changes ADD COLUMN IF NOT EXISTS contents JSONB;';

  it('both files add the column', () => {
    // Stated as an ALTER in `01-schema.sql` as well as in the CREATE TABLE:
    // `CREATE TABLE IF NOT EXISTS` is a no-op on a database that already holds
    // the table, so re-applying that file is the only way an existing database
    // gains a column and the ALTER is what carries it.
    expect(schema).toContain(addColumn);
    expect(contentsMigration).toContain(addColumn);
  });

  it('both files say what NULL means, because the data cannot', () => {
    // A row written before this column existed is indistinguishable from a run
    // that moved nothing, and only one of those is true. Nothing can be
    // backfilled — `experience_locations.created_at` was overwritten wholesale on
    // 2026-08-04 — so the column comment is where that warning lives, in both
    // files, or a later reader counts absent deltas as quiet runs.
    for (const sql of [schema, contentsMigration]) {
      expect(sql).toContain('COMMENT ON COLUMN experience_sync_changes.contents IS');
      expect(sql).toContain('NULL means the run recorded nothing here');
    }
  });

  it('the column is added before it is commented on', () => {
    // On a database that already holds the table, the COMMENT is the statement
    // that would fail: the column reaches it through the ALTER above, and a file
    // that commented first would abort there and never run the ALTER at all.
    for (const sql of [schema, contentsMigration]) {
      expect(sql.indexOf(addColumn))
        .toBeLessThan(sql.indexOf('COMMENT ON COLUMN experience_sync_changes.contents'));
    }
  });

  it('migration 023 is not defeated by how it is invoked', () => {
    // db/migrations/README.md: psql exits 0 when a statement in a piped script
    // fails, so the file sets this itself rather than trusting the caller.
    expect(contentsMigrationRaw).toMatch(/^\\set ON_ERROR_STOP on$/m);
  });
});
