#!/usr/bin/env node
/**
 * Apply every migration a change adds to a database that holds rows, and hold
 * what it leaves to the schema a fresh database gets (#2464).
 *
 *   node scripts/migrate-on-rows.mjs      the migrations this change adds, against its base
 *
 * Every other lane builds its database from `db/init/01-schema.sql`, so a file
 * in `db/migrations/` used to run for the first time on the development
 * database, after the merge. Migration 232 passed every check that way and then
 * aborted there: its backfill queued deferred trigger events on
 * `source_records`, and an `ALTER TABLE` on the same table later in the same
 * transaction was refused ("cannot ALTER TABLE ... because it has pending
 * trigger events"). On an empty table no row queues an event, so only a
 * database with rows sees it. This gate is that database:
 *
 * 1. A throwaway Postgres on the image `docker-compose.yml` pins, under a
 *    container name of its own, with no port but an ephemeral one on
 *    127.0.0.1. It never reaches the development database: nothing here reads
 *    `.env` or `DB_PORT`, which on a laptop may be a tunnel to it.
 * 2. A database built from the base's `db/init/` (the merge base with
 *    `GATES_BASE`, else `main`, the way `scripts/gates-base.mjs` settles it),
 *    seeded with the base's own smoke fixture (`backend/src/db/seed/`, run from
 *    the base's tree), so the fixture fits the schema it is loaded into.
 * 3. Each file `db/migrations/` holds on disk and the base does not, in filename
 *    order, the way `scripts/db-migrate.sh` applies one: the file as it is, with
 *    its ledger row appended, through one psql under `ON_ERROR_STOP=1`, nothing
 *    wrapped around it. The runner itself is not called: it reads `.env`, whose
 *    `DB_PORT` would win over this container's port, and it refuses a database
 *    with an empty ledger on purpose.
 * 4. The head's `db/init/` re-applied to that database, the other half of the
 *    workflow (`db/migrations/README.md` § A database that predates the
 *    ledger): new tables and columns arrive that way, and a migration says
 *    whether it runs before the next re-application.
 * 5. Its schema against a fresh database built from the head's `db/init/`, as
 *    sorted catalogue lines (`SNAPSHOT_SQL`): relations, each column's type,
 *    nullability and default, constraints, indexes, triggers, functions by
 *    signature, schemas and extensions. Column order and comments are out of
 *    scope; a function's body and a view's definition are too.
 *
 * Before each file it prints the tables the file's text writes or alters and
 * how many rows each held, and warns where one held none: the gate proved less
 * there. What it never measures is how long a file holds its locks on real
 * volumes, which is still a hand-run's on the development database.
 *
 * `MIGRATE_ON_ROWS_MIGRATIONS_DIR` names a directory whose `.sql` files are
 * applied instead of the ones the change adds: the gate's own test
 * (`scripts/test-migrate-on-rows.sh`) drives it over files written to fail.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { changedPaths } from './gates-base.mjs';
import { repoFile } from './repo-root.mjs';

/** A migration's name, as `scripts/db-migrate.sh` holds it: safe to embed in SQL. */
export const FILENAME_PATTERN = /^\d{3}-[a-z0-9]+(-[a-z0-9]+)*\.sql$/;

/** Both database names say `test`, which the base fixture's guard asks for (`backend/src/db/testDbName.ts`). */
const MIGRATED_DB = 'tyr_migrated_test';
const FRESH_DB = 'tyr_fresh_test';

/** The image `docker-compose.yml` gives its `db` service: the pin stays said once. */
export function composeDbImage(compose) {
  const service = /^ {2}db:\n((?: {4}.*\n|\s*\n)+)/m.exec(compose);
  const image = service && /^ {4}image:\s*(\S+)/m.exec(service[1]);
  if (!image) throw new Error('docker-compose.yml names no image for its db service.');
  return image[1];
}

/** The migrations the head adds over the base, in the order they are applied. */
export function addedMigrations(baseNames, headNames) {
  const before = new Set(baseNames);
  return headNames.filter((name) => name.endsWith('.sql') && !before.has(name)).sort();
}

/**
 * SQL text with its comments and string literals taken out, so a table named
 * in prose or in a `COMMENT ON ... IS '...'` is not read as one the file
 * writes. Dollar-quoted bodies stay: a `DO` block runs, and a function body
 * names what the function will write, which is said as such.
 */
export function sqlCode(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const skipped = skippedAt(text, i);
    if (skipped) {
      out += skipped.keep;
      i = skipped.end;
    } else {
      out += text[i];
      i += 1;
    }
  }
  return out;
}

/** The comment or string literal that starts at `i`: where it ends, and what stands for it. */
function skippedAt(text, i) {
  const after = (found, length) => (found === -1 ? text.length : found + length);
  if (text.startsWith('--', i)) return { end: after(text.indexOf('\n', i), 0), keep: '' };
  if (text.startsWith('/*', i)) return { end: after(text.indexOf('*/', i + 2), 2), keep: ' ' };
  if (text[i] !== "'") return null;
  let j = i + 1;
  while (j < text.length && !(text[j] === "'" && text[j + 1] !== "'")) j += text[j] === "'" ? 2 : 1;
  return { end: j + 1, keep: "''" };
}

const IDENT = String.raw`"?[A-Za-z_][A-Za-z0-9_]*"?(?:\."?[A-Za-z_][A-Za-z0-9_]*"?)?`;

/** What a statement does to a table it names: the first group is the table. */
const TOUCHES = [
  ['writes', new RegExp(String.raw`\bUPDATE\s+(?:ONLY\s+)?(${IDENT})(?:\s+(?:AS\s+)?${IDENT})?\s+SET\b`, 'gi')],
  ['writes', new RegExp(String.raw`\bINSERT\s+INTO\s+(${IDENT})`, 'gi')],
  ['writes', new RegExp(String.raw`\bDELETE\s+FROM\s+(?:ONLY\s+)?(${IDENT})`, 'gi')],
  ['writes', new RegExp(String.raw`\bMERGE\s+INTO\s+(?:ONLY\s+)?(${IDENT})`, 'gi')],
  ['writes', new RegExp(String.raw`\bTRUNCATE\s+(?:TABLE\s+)?(?:ONLY\s+)?(${IDENT})`, 'gi')],
  ['alters', new RegExp(String.raw`\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(${IDENT})`, 'gi')],
  ['alters', new RegExp(String.raw`\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(?:${IDENT}\s+)?ON\s+(?:ONLY\s+)?(${IDENT})`, 'gi')],
  ['alters', new RegExp(String.raw`\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(${IDENT})`, 'gi')],
];

/**
 * The tables a migration's text writes to or alters, each with what it does
 * to it, in the order the text first names them. Read with patterns rather
 * than parsed, so it answers for what the text names: a name it misses narrows
 * the row report, never the migration the gate applies.
 */
export function touchedTables(text) {
  const code = sqlCode(text);
  const found = new Map();
  for (const [verb, pattern] of TOUCHES) {
    for (const match of code.matchAll(pattern)) {
      const name = match[1].replaceAll('"', '').toLowerCase();
      if (!/^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/.test(name)) continue;
      const entry = found.get(name) ?? { name, verbs: new Set(), at: match.index };
      entry.verbs.add(verb);
      entry.at = Math.min(entry.at, match.index);
      found.set(name, entry);
    }
  }
  return [...found.values()]
    .sort((a, b) => a.at - b.at)
    .map(({ name, verbs }) => ({ name, verbs: ['writes', 'alters'].filter((verb) => verbs.has(verb)) }));
}

/**
 * One line per object of the schema, sorted, so two databases compare as text
 * whatever order their columns were added in. Extension members (PostGIS's own
 * functions and `spatial_ref_sys`) are left out: both sides run the same image.
 */
export const SNAPSHOT_SQL = `
WITH ns AS (
  SELECT oid, nspname FROM pg_namespace
   WHERE nspname NOT IN ('pg_catalog', 'information_schema') AND nspname !~ '^pg_(toast|temp)'
), member AS (
  SELECT classid, objid FROM pg_depend WHERE deptype = 'e'
), rel AS (
  SELECT c.oid, ns.nspname || '.' || c.relname AS name, c.relkind FROM pg_class c JOIN ns ON ns.oid = c.relnamespace
   WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
     AND (c.tableoid, c.oid) NOT IN (SELECT classid, objid FROM member)
)
SELECT line FROM (
  SELECT 'schema ' || nspname AS line FROM ns
   WHERE ('pg_namespace'::regclass, oid) NOT IN (SELECT classid, objid FROM member)
  UNION ALL
  SELECT 'extension ' || extname || ' ' || extversion FROM pg_extension
  UNION ALL
  SELECT 'relation ' || name || ' kind ' || relkind::text FROM rel
  UNION ALL
  SELECT 'column ' || rel.name || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
         || CASE WHEN a.attnotnull THEN ' not null' ELSE ' null' END
         || COALESCE(' default ' || pg_get_expr(d.adbin, d.adrelid), '')
         || CASE a.attgenerated WHEN 's' THEN ' generated stored' ELSE '' END
         || CASE WHEN a.attidentity <> '' THEN ' identity ' || a.attidentity::text ELSE '' END
    FROM rel JOIN pg_attribute a ON a.attrelid = rel.oid
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attnum > 0 AND NOT a.attisdropped
  UNION ALL
  SELECT 'constraint ' || rel.name || ' ' || con.conname || ': ' || pg_get_constraintdef(con.oid)
    FROM pg_constraint con JOIN rel ON rel.oid = con.conrelid
  UNION ALL
  SELECT 'index ' || rel.name || ' ' || pg_get_indexdef(i.indexrelid)
    FROM pg_index i JOIN rel ON rel.oid = i.indrelid
  UNION ALL
  SELECT 'trigger ' || rel.name || ' ' || pg_get_triggerdef(t.oid)
    FROM pg_trigger t JOIN rel ON rel.oid = t.tgrelid
   WHERE NOT t.tgisinternal
  UNION ALL
  SELECT 'function ' || ns.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
         || ' kind ' || p.prokind::text || COALESCE(' returns ' || pg_get_function_result(p.oid), '')
    FROM pg_proc p JOIN ns ON ns.oid = p.pronamespace
   WHERE ('pg_proc'::regclass, p.oid) NOT IN (SELECT classid, objid FROM member)
) lines
ORDER BY line COLLATE "C";
`;

/** What one sorted snapshot holds that the other does not, each side sorted. */
export function snapshotDiff(migrated, fresh) {
  const a = new Set(migrated);
  const b = new Set(fresh);
  return {
    onlyMigrated: migrated.filter((line) => !b.has(line)),
    onlyFresh: fresh.filter((line) => !a.has(line)),
  };
}

/** The diff as lines a reader can act on, at most `limit` of each side. */
export function describeDiff({ onlyMigrated, onlyFresh }, limit = Infinity) {
  const side = (lines, mark) => [
    ...lines.slice(0, limit).map((line) => `  ${mark} ${line}`),
    ...(lines.length > limit ? [`  ${mark} … and ${lines.length - limit} more`] : []),
  ];
  return [...side(onlyMigrated, '-'), ...side(onlyFresh, '+')];
}

// --- The run ---------------------------------------------------------------

const say = (line = '') => console.log(line);
const warn = (line) => {
  console.log(`warning: ${line}`);
  if (process.env.GITHUB_ACTIONS) console.log(`::warning title=Migration on rows::${line}`);
};

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...options });
}

function git(...args) {
  const result = run('git', args, { cwd: repoFile() });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
  return result.stdout;
}

class Database {
  constructor(image) {
    this.container = `tyr-migrate-on-rows-${process.pid}`;
    this.image = image;
  }

  start() {
    // A cap and a little shared memory: a schema build makes parallel index
    // workers, which the image's default 64 MB of /dev/shm can refuse.
    const started = run('docker', [
      'run', '-d', '--rm', '--name', this.container, '--memory', '2g', '--shm-size', '256m',
      '-e', 'POSTGRES_PASSWORD=postgres', '-p', '127.0.0.1::5432', this.image,
    ]);
    if (started.status !== 0) throw new Error(`docker run ${this.image} failed: ${started.stderr.trim()}`);
    // initdb starts a socket-only server first and restarts it; only the
    // final one listens on TCP, so the probe goes over TCP (scripts/db-types.sh).
    for (let attempt = 0; attempt < 90; attempt += 1) {
      if (this.psql('postgres', 'SELECT 1', { host: true }).status === 0) break;
      run('sleep', ['1']);
    }
    if (this.psql('postgres', 'SELECT 1', { host: true }).status !== 0) {
      throw new Error(`the database in ${this.container} never answered.`);
    }
    const port = run('docker', ['port', this.container, '5432/tcp']).stdout.trim().split('\n')[0];
    this.port = port.slice(port.lastIndexOf(':') + 1);
    if (!/^\d+$/.test(this.port) || this.port === '5432') {
      throw new Error(`refusing the port docker gave the container (${port}).`);
    }
  }

  stop() {
    run('docker', ['rm', '-f', this.container]);
  }

  /** psql inside the container, the SQL on stdin, notices kept out of the output. */
  psql(database, sql, { host = false, quiet = true } = {}) {
    return run('docker', [
      'exec', '-i', '-e', 'PGOPTIONS=-c client_min_messages=warning', '-e', 'PGPASSWORD=postgres', this.container,
      'psql', '-X', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-At',
      ...(quiet ? ['-q'] : []), ...(host ? ['-h', '127.0.0.1'] : []),
    ], { input: sql });
  }

  /** psql that must succeed, its rows as lines. */
  query(database, sql, what) {
    const result = this.psql(database, sql);
    if (result.status !== 0) throw new Error(`${what} failed:\n${result.stderr.trim()}`);
    return result.stdout.split('\n').filter(Boolean);
  }
}

/** Every `.sql` file of `db/init/`, at a commit or on disk, in the order initdb applies them. */
function initFiles(at) {
  if (at) {
    return git('ls-tree', '--name-only', at, 'db/init/').split('\n').filter((path) => path.endsWith('.sql')).sort()
      .map((path) => ({ path, text: git('show', `${at}:${path}`) }));
  }
  return readdirSync(repoFile('db', 'init')).filter((name) => name.endsWith('.sql')).sort()
    .map((name) => ({ path: `db/init/${name}`, text: readFileSync(repoFile('db', 'init', name), 'utf8') }));
}

function buildSchema(db, database, files, what) {
  for (const file of files) {
    const result = db.psql(database, file.text);
    if (result.status !== 0) throw new Error(`${what}: ${file.path} failed:\n${result.stderr.trim()}`);
  }
}

/**
 * The base's smoke fixture, from the base's own tree: its backend source and
 * shared package, with this checkout's installed modules linked in beside them
 * and the shared package pointed at the base's copy.
 */
function seedBaseFixture(db, base) {
  const tree = mkdtempSync(join(tmpdir(), 'migrate-on-rows-'));
  try {
    const archive = run('git', ['archive', '--format=tar', base, 'backend/src', 'backend/package.json', 'backend/tsconfig.json', 'packages/shared'], { cwd: repoFile(), encoding: 'buffer' });
    if (archive.status !== 0) throw new Error(`git archive ${base} failed: ${archive.stderr.toString().trim()}`);
    const untar = run('tar', ['-x', '-C', tree], { input: archive.stdout, encoding: 'buffer' });
    if (untar.status !== 0) throw new Error(`unpacking the base's tree failed: ${untar.stderr.toString().trim()}`);
    const installed = repoFile('backend', 'node_modules');
    const modules = join(tree, 'backend', 'node_modules');
    mkdirSync(join(modules, '@tyr'), { recursive: true });
    for (const entry of readdirSync(installed)) {
      if (entry !== '@tyr') symlinkSync(join(installed, entry), join(modules, entry));
    }
    symlinkSync(join(tree, 'packages', 'shared'), join(modules, '@tyr', 'shared'));
    const seeded = run('npm', ['--prefix', join(tree, 'backend'), 'run', '--silent', 'seed:e2e'], {
      env: {
        ...process.env, DB_HOST: '127.0.0.1', DB_PORT: db.port, DB_NAME: MIGRATED_DB, DB_USER: 'postgres', DB_PASSWORD: 'postgres',
      },
    });
    if (seeded.status !== 0) throw new Error(`the base's fixture did not seed:\n${(seeded.stderr || seeded.stdout).trim()}`);
  } finally {
    rmSync(tree, { recursive: true, force: true });
  }
}

/** How many rows each table that holds any has, largest first. */
function heldRows(db) {
  return db.query(MIGRATED_DB, `
    SELECT t.n || ' ' || t.c FROM (
      SELECT table_schema || '.' || table_name AS n,
             (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name), false, true, '')))[1]::text::bigint AS c
        FROM information_schema.tables
       WHERE table_type = 'BASE TABLE' AND table_schema NOT IN ('pg_catalog', 'information_schema')
    ) t WHERE t.c > 0 ORDER BY t.c DESC, t.n`, 'counting the fixture').map((line) => line.replace(/^public\./, ''));
}

/** Rows each named table holds now, or null where it does not exist yet. */
function rowCounts(db, tables) {
  if (tables.length === 0) return new Map();
  const quoted = tables.map(({ name }) => `('${name}')`).join(', ');
  const present = new Set(db.query(MIGRATED_DB, `SELECT n FROM (VALUES ${quoted}) v(n) WHERE to_regclass(n) IS NOT NULL`, 'finding the tables'));
  const counts = new Map(tables.map(({ name }) => [name, null]));
  const existing = tables.filter(({ name }) => present.has(name));
  if (existing.length) {
    const union = existing.map(({ name }) => `SELECT '${name}' || ' ' || count(*) FROM ${name}`).join(' UNION ALL ');
    for (const line of db.query(MIGRATED_DB, union, 'counting rows')) {
      const [name, count] = line.split(' ');
      counts.set(name, Number(count));
    }
  }
  return counts;
}

/** One migration, as the runner applies it: the file, then its ledger row, under ON_ERROR_STOP. */
function applyMigration(db, name, text) {
  const checksum = createHash('sha256').update(text).digest('hex');
  const sql = `${text}\n-- Recorded as scripts/db-migrate.sh records it\n`
    + `INSERT INTO schema_migrations (filename, checksum, ran) VALUES ('${name}', '${checksum}', TRUE);\n`;
  const started = Date.now();
  const result = db.psql(MIGRATED_DB, sql, { quiet: false });
  return { ...result, ms: Date.now() - started };
}

function migrationsToApply(mergeBase) {
  const dir = process.env.MIGRATE_ON_ROWS_MIGRATIONS_DIR;
  if (dir) {
    return readdirSync(dir).filter((name) => name.endsWith('.sql')).sort()
      .map((name) => ({ name, text: readFileSync(join(dir, name), 'utf8') }));
  }
  const baseNames = git('ls-tree', '--name-only', mergeBase, 'db/migrations/').split('\n').map((path) => path.replace(/^db\/migrations\//, ''));
  return addedMigrations(baseNames, readdirSync(repoFile('db', 'migrations')))
    .map((name) => ({ name, text: readFileSync(repoFile('db', 'migrations', name), 'utf8') }));
}

function report(name, tables, counts) {
  if (tables.length === 0) {
    say(`  ${name} names no table it writes or alters.`);
    return;
  }
  for (const { name: table, verbs } of tables) {
    const count = counts.get(table);
    const rows = count === 1 ? 'row' : 'rows';
    const held = count === null ? 'does not exist yet' : `held ${count} ${rows}`;
    say(`  ${verbs.join(' and ')} ${table}: ${held}`);
    if (count === 0) warn(`${name} ${verbs.join(' and ')} ${table}, which held 0 rows: the gate proved less there.`);
  }
}

function migrate(db, files) {
  for (const [index, { name, text }] of files.entries()) {
    if (!FILENAME_PATTERN.test(name)) throw new Error(`Migration name does not fit NNN-slug.sql: ${name}`);
    say(`--> ${name}`);
    const tables = touchedTables(text);
    report(name, tables, rowCounts(db, tables));
    const result = applyMigration(db, name, text);
    if (result.status !== 0) {
      say('');
      say(`${name} failed on a database that holds rows. Postgres said:`);
      say(result.stderr.trim().split('\n').map((line) => `  ${line}`).join('\n'));
      const left = files.length - index - 1;
      if (left > 0) say(`${left} later migration(s) were not attempted.`);
      return false;
    }
    say(`    applied in ${(result.ms / 1000).toFixed(1)} s on the fixture's rows`);
  }
  return true;
}

function main() {
  const { base: named, mergeBase, reason } = changedPaths({ base: undefined, rev: 'HEAD' });
  if (!named) {
    say(`No base was named, so there is no database to migrate from: ${(reason ?? '').replace(/,? so every gate applies\.?$/, '')}`);
    return 0;
  }
  if (!mergeBase) {
    say(`No migration was applied: ${reason}`);
    return 1;
  }
  const files = migrationsToApply(mergeBase);
  if (files.length === 0) {
    say(`No migration added over ${mergeBase.slice(0, 9)}: nothing to apply on rows.`);
    return 0;
  }

  const db = new Database(composeDbImage(readFileSync(repoFile('docker-compose.yml'), 'utf8')));
  const stop = () => db.stop();
  process.on('SIGINT', () => { stop(); process.exit(130); });
  process.on('SIGTERM', () => { stop(); process.exit(143); });
  try {
    say(`Applying ${files.length} migration(s) to the base ${mergeBase.slice(0, 9)} with its fixture's rows (${db.image})`);
    db.start();
    for (const database of [MIGRATED_DB, FRESH_DB]) db.query('postgres', `CREATE DATABASE ${database}`, `creating ${database}`);
    buildSchema(db, MIGRATED_DB, initFiles(mergeBase), "The base's schema");
    seedBaseFixture(db, mergeBase);
    say(`The base's fixture holds rows in: ${heldRows(db).join(', ')}`);

    if (!migrate(db, files)) return 1;

    const migratedOnly = db.query(MIGRATED_DB, SNAPSHOT_SQL, 'reading the migrated schema');
    const head = initFiles(null);
    buildSchema(db, MIGRATED_DB, head, "Re-applying the head's schema to the migrated database");
    buildSchema(db, FRESH_DB, head, "The head's schema");
    const migrated = db.query(MIGRATED_DB, SNAPSHOT_SQL, 'reading the migrated schema');
    const fresh = db.query(FRESH_DB, SNAPSHOT_SQL, 'reading the fresh schema');

    const before = snapshotDiff(migratedOnly, fresh);
    if (before.onlyMigrated.length + before.onlyFresh.length > 0) {
      say(`Before db/init is re-applied, the migrated schema differs from a fresh one in ${before.onlyMigrated.length + before.onlyFresh.length} line(s):`);
      describeDiff(before, 20).forEach((line) => say(line));
    }
    const after = snapshotDiff(migrated, fresh);
    if (after.onlyMigrated.length + after.onlyFresh.length > 0) {
      say('');
      say('The migrated database, with db/init re-applied, is not the schema a fresh database gets.');
      say('  - only in the migrated database   + only in a fresh one');
      describeDiff(after).forEach((line) => say(line));
      return 1;
    }
    say(`The migrated database's schema is a fresh one's: ${fresh.length} catalogue lines alike.`);
    return 0;
  } catch (error) {
    say(error.message);
    return 1;
  } finally {
    stop();
  }
}

if (process.argv[1] && process.argv[1].endsWith('migrate-on-rows.mjs')) process.exit(main());
