/**
 * Generate `schema.generated.ts` from a live database (ADR-0064, #792).
 *
 *   tsx src/db/generateSchemaTypes.ts            write the file
 *   tsx src/db/generateSchemaTypes.ts --check    exit 1 when the file differs
 *
 * The database is the one `db/init/01-schema.sql` builds in a fresh
 * container — `scripts/db-types.sh` stands it up, points the four DB_* variables
 * at it and runs this. It is never the developer's catalogue: that one holds
 * whatever branches have been applied to it, and the types would describe the
 * machine rather than the schema. So the same guard the seed and the database
 * lane apply is applied here, on the connection: a database not named like a
 * test one is refused before a catalog row is read.
 *
 * The catalog is read from `pg_attribute` rather than `information_schema`,
 * because only `format_type(atttypid, atttypmod)` says the element width of a
 * `VARCHAR(10)[]` — `information_schema.columns` reports NULL for an array —
 * and the width is one of the two things this file exists to carry. Relations
 * an extension owns (PostGIS's `spatial_ref_sys`, `geometry_columns`) are
 * not this schema's and are left out.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { TEST_DB_NAME_PATTERN } from './testDbName.js';
import {
  renderSchemaTypes,
  type CatalogCheck,
  type CatalogColumn,
  type CatalogEnum,
} from './schemaTypesRender.js';

const OUTPUT = join(dirname(fileURLToPath(import.meta.url)), 'schema.generated.ts');

/** Relations `pg_depend` records as owned by an extension. */
const NOT_EXTENSION_OWNED = `NOT EXISTS (
  SELECT 1 FROM pg_depend d
  WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e'
)`;

interface ColumnRow {
  table: string;
  relkind: string;
  column: string;
  formatted: string;
  udt_name: string;
  typtype: string;
  element_udt_name: string | null;
  element_typtype: string | null;
  not_null: boolean;
}

async function readCatalog(pool: Pool): Promise<{
  columns: CatalogColumn[];
  enums: CatalogEnum[];
  checks: CatalogCheck[];
}> {
  const columns = await pool.query<ColumnRow>(`
    SELECT c.relname AS "table", c.relkind, a.attname AS "column",
           format_type(a.atttypid, a.atttypmod) AS formatted,
           t.typname AS udt_name, t.typtype,
           et.typname AS element_udt_name, et.typtype AS element_typtype,
           a.attnotnull AS not_null
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_type t ON t.oid = a.atttypid
    LEFT JOIN pg_type et ON et.oid = t.typelem AND t.typcategory = 'A'
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p', 'v', 'm')
      AND a.attnum > 0 AND NOT a.attisdropped
      AND ${NOT_EXTENSION_OWNED}
    ORDER BY c.relname, a.attnum
  `);
  const enums = await pool.query<{ name: string; value: string }>(`
    SELECT t.typname AS name, e.enumlabel AS value
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
    ORDER BY t.typname, e.enumsortorder
  `);
  const checks = await pool.query<CatalogCheck>(`
    SELECT c.relname AS "table", con.conname AS name, pg_get_constraintdef(con.oid) AS definition
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.contype = 'c' AND n.nspname = 'public'
      AND ${NOT_EXTENSION_OWNED}
    ORDER BY c.relname, con.conname
  `);

  const enumsByName = new Map<string, string[]>();
  for (const row of enums.rows) {
    const values = enumsByName.get(row.name);
    if (values) values.push(row.value);
    else enumsByName.set(row.name, [row.value]);
  }

  return {
    columns: columns.rows.map((row) => ({
      table: row.table,
      relkind: row.relkind,
      column: row.column,
      formatted: row.formatted,
      udtName: row.udt_name,
      typtype: row.typtype,
      elementUdtName: row.element_udt_name,
      elementTyptype: row.element_typtype,
      notNull: row.not_null,
    })),
    enums: [...enumsByName.entries()].map(([name, values]) => ({ name, values })),
    checks: checks.rows,
  };
}

/** The lines on one side and not the other, enough to say what moved. */
function describeDifference(committed: string, generated: string): string {
  const before = new Set(committed.split('\n'));
  const after = new Set(generated.split('\n'));
  const removed = [...before].filter((line) => !after.has(line)).map((line) => `- ${line}`);
  const added = [...after].filter((line) => !before.has(line)).map((line) => `+ ${line}`);
  return [...removed, ...added].join('\n');
}

async function main(): Promise<void> {
  const check = process.argv.includes('--check');
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

  try {
    const landedOn = (await pool.query<{ name: string }>('SELECT current_database() AS name')).rows[0].name;
    if (!TEST_DB_NAME_PATTERN.test(landedOn)) {
      throw new Error(
        `Refusing to generate from "${landedOn}" at ${host}:${port}: not named like a test database. `
          + 'The types describe the schema db/init builds, not a developer catalogue with branches '
          + 'applied to it — run `npm run db:types`, which stands a fresh database up.',
      );
    }

    const { columns, enums, checks } = await readCatalog(pool);
    if (columns.length === 0) {
      throw new Error(`The database "${landedOn}" has no relations in schema public: was db/init applied?`);
    }
    const generated = renderSchemaTypes(columns, enums, checks);

    if (check) {
      let committed: string;
      try {
        committed = readFileSync(OUTPUT, 'utf8');
      } catch {
        committed = '';
      }
      if (committed !== generated) {
        console.error(`${OUTPUT} does not match the schema. Run \`npm run db:types\` and commit the result.`);
        console.error(describeDifference(committed, generated));
        process.exitCode = 1;
        return;
      }
      console.log(`${OUTPUT} matches the schema (${enums.length} enums, ${new Set(columns.map((c) => c.table)).size} relations).`);
      return;
    }

    writeFileSync(OUTPUT, generated);
    console.log(`Wrote ${OUTPUT} (${enums.length} enums, ${new Set(columns.map((c) => c.table)).size} relations).`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
