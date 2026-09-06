import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/**
 * A statement names only columns the schema declares.
 *
 * Migration 044 renamed `experiences.category` to `type`, and the unlocked
 * read that opens `editExperience` kept the old name while its siblings were
 * renamed with it. Every save from the curation dialog answered 500 until
 * #824, and the unit lane could not see it: the pool is a mock, and a mock
 * takes any column name. Migration 046 dropped six more columns from the same
 * table in the same week, and each rename or drop left its readers to be found
 * by grep.
 *
 * This holds every SQL string literal in `backend/src` to the columns
 * `db/init/01-schema.sql` declares, the way `columnBounds.test.ts` holds the
 * request bounds to the same file. The extractor is deliberately narrow, and
 * the boundary is what it can resolve without a parser:
 *
 * - an identifier qualified by an alias the same literal declares
 *   (`FROM experiences e` … `e.category`), anywhere in the literal;
 * - a bare identifier in a select list, a `SET` clause or an `INSERT` column
 *   list, when the literal declares exactly one table and no join, so the
 *   name can belong to nothing else.
 *
 * Anything else — a subquery, a CTE, a temp table, a dynamic `${}` fragment,
 * a function — is skipped, and the number of references actually resolved is
 * held above a floor, so an extractor that quietly stopped seeing statements
 * fails rather than passing on nothing.
 *
 * This is a guard of the kind Epic #788 sets out to retire, not a home for the
 * rule: the home is the executable SQL lane of #522, where a real database
 * refuses the statement itself. Until that lane exists, this is the check that
 * covers the class rather than the one statement that broke.
 */

const SRC = fileURLToPath(new URL('..', import.meta.url));
const SCHEMA_PATH = fileURLToPath(new URL('../../../db/init/01-schema.sql', import.meta.url));

type Schema = Map<string, Set<string>>;

/** Table → the columns its `CREATE TABLE` block and its `ADD COLUMN` clauses declare. */
function declaredColumns(schema: string): Schema {
  const tables: Schema = new Map();
  const constraint = /^(PRIMARY|UNIQUE|CONSTRAINT|FOREIGN|CHECK|EXCLUDE)\b/i;
  for (const [, table, body] of schema.matchAll(/^CREATE TABLE (?:IF NOT EXISTS )?(\w+) \(\n([\s\S]*?)^\);/gm)) {
    const columns = new Set<string>();
    for (const raw of body.split('\n')) {
      const line = raw.trim();
      if (line === '' || line.startsWith('--') || constraint.test(line)) continue;
      const column = /^"?([a-z_]\w*)"?\s/i.exec(line);
      if (column) columns.add(column[1]);
    }
    tables.set(table, columns);
  }
  // `ALTER TABLE t ADD COLUMN IF NOT EXISTS c …` on one line, or the guarded
  // form inside a DO block (`requires_curation`, which cannot be IF NOT EXISTS
  // because of what its backfill would do on a re-application). Comment lines
  // are dropped first: one of them quotes the clause.
  const code = schema.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');
  for (const [, table, body] of code.matchAll(/\bALTER TABLE (\w+)\b([^;]*);/g)) {
    for (const [, column] of body.matchAll(/\bADD COLUMN(?: IF NOT EXISTS)?\s+(\w+)/g)) {
      const columns = tables.get(table);
      if (columns === undefined) throw new Error(`ADD COLUMN on ${table}, which no CREATE TABLE declares`);
      columns.add(column);
    }
  }
  return tables;
}

/** A word that can follow a table name and is not its alias. */
const NOT_AN_ALIAS = new Set([
  'WHERE', 'SET', 'ON', 'USING', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'CROSS', 'FULL', 'NATURAL',
  'VALUES', 'WHEN', 'THEN', 'AND', 'OR', 'NOT', 'GROUP', 'ORDER', 'LIMIT', 'OFFSET', 'RETURNING', 'HAVING',
  'UNION', 'EXCEPT', 'INTERSECT', 'FOR', 'TABLESAMPLE', 'LATERAL', 'WITH', 'SELECT', 'INSERT', 'UPDATE',
  'DELETE', 'DO', 'NOTHING', 'CONFLICT', 'IS', 'IN', 'EXISTS', 'END', 'ELSE', 'CASE', 'DEFAULT', 'ONLY',
  'NOWAIT', 'SKIP', 'LOCKED', 'KEY', 'SHARE', 'NO', 'AS', 'ELSIF', 'IF', 'LOOP', 'BEGIN',
]);
/** A bare word in a select list that names no column. */
const NOT_A_COLUMN = new Set(['NULL', 'TRUE', 'FALSE', 'DISTINCT', 'ALL', 'DEFAULT', 'CURRENT_TIMESTAMP', 'EXCLUDED']);
const IDENTIFIER = /^[a-z_]\w*$/i;

interface Undeclared { reference: string; table: string }
interface Sweep { undeclared: Undeclared[]; checked: number }
type Check = (table: string, column: string, reference: string) => void;

/** `closing` is the slash that ends a block comment: still comment, so it is blanked with the star before it. */
type Lexeme = 'code' | 'quoted' | 'line' | 'block' | 'closing';

/** What a character opens when read as SQL: a string, a `--` comment, a block comment, or nothing. */
function afterCode(c: string, next: string): Lexeme {
  if (c === "'") return 'quoted';
  if (c === '-' && next === '-') return 'line';
  if (c === '/' && next === '*') return 'block';
  return 'code';
}

/** Where the scanner is after reading `c` in `state`, `next` being the character after it. */
function lexemeAfter(state: Lexeme, c: string, next: string): Lexeme {
  if (state === 'code') return afterCode(c, next);
  if (state === 'quoted') return c === "'" ? 'code' : 'quoted';
  if (state === 'line') return c === '\n' ? 'code' : 'line';
  if (state === 'closing') return 'code';
  return c === '*' && next === '/' ? 'closing' : 'block';
}

/**
 * The literal with its quoted strings and its SQL comments blanked out: a
 * string carries JSON keys and labels, a comment carries prose, and neither
 * names a column. The two are read together, because this codebase's SQL
 * prose is full of possessives — an apostrophe in "the curator's" read as a
 * quote would invert the blanking for the rest of the literal.
 */
function statementText(sql: string): string {
  let state: Lexeme = 'code';
  let out = '';
  for (let i = 0; i < sql.length; i++) {
    const before = state;
    state = lexemeAfter(state, sql[i], sql[i + 1] ?? '');
    out += before === 'code' && state === 'code' ? sql[i] : ' ';
  }
  return out;
}

/** The word after `at`, past whitespace, and where it ends. */
function wordAfter(text: string, at: number): { word: string; next: number } | null {
  const m = /^\s+([a-z_]\w*)/i.exec(text.slice(at, at + 64));
  return m ? { word: m[1], next: at + m[0].length } : null;
}

/**
 * The text from `start` to the first of `stops` at paren depth zero — a select
 * list before its FROM, assignments before their WHERE — and where the stop
 * ends. Null when a paren opened inside never closes, or when nothing stops it
 * and running to the end is not allowed.
 */
function untilKeyword(text: string, start: number, stops: RegExp, toEnd: boolean): { body: string; next: number } | null {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    if (depth < 0) return null;
    if (depth !== 0 || /\w/.test(text[i - 1] ?? ' ')) continue;
    const stop = stops.exec(text.slice(i, i + 16));
    if (stop) return { body: text.slice(start, i), next: i + stop[0].length };
  }
  return depth === 0 && toEnd ? { body: text.slice(start), next: text.length } : null;
}

/** Items of a comma-separated list, split at depth zero, or null when the parens do not balance. */
function listItems(text: string): string[] | null {
  const items: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) { items.push(text.slice(start, i)); start = i + 1; }
    if (depth < 0) return null;
  }
  if (depth !== 0) return null;
  items.push(text.slice(start));
  return items.map((s) => s.trim()).filter((s) => s !== '');
}

/** The alias a table is given where it is declared, or its own name, and where the declaration ends. */
function aliasAfter(sql: string, at: number, table: string): { alias: string; next: number } {
  let word = wordAfter(sql, at);
  if (word?.word.toUpperCase() === 'AS') word = wordAfter(sql, word.next);
  if (word === null || NOT_AN_ALIAS.has(word.word.toUpperCase())) return { alias: table, next: at };
  return { alias: word.word, next: word.next };
}

/** A derived table `(SELECT …) alias`: outside its bounds, the alias is the subquery, not a base table. */
interface Shadow { alias: string; open: number; close: number }

interface Declared {
  /** Alias, or the table's own name, → table; null where one alias named two tables. */
  aliases: Map<string, string | null>;
  tables: Set<string>;
  /** `FROM a, b`: a second source the alias pass cannot see. */
  commaJoin: boolean;
  shadows: Shadow[];
}

/** What a literal declares, from every FROM, JOIN, USING, UPDATE and INTO that names a schema table. */
function declaredIn(sql: string, schema: Schema): Declared {
  const declared: Declared = { aliases: new Map(), tables: new Set(), commaJoin: false, shadows: derivedTables(sql) };
  for (const m of sql.matchAll(/\b(?:FROM|JOIN|USING|UPDATE|INTO)\s+([a-z_]\w*)/gi)) {
    const table = m[1];
    if (!schema.has(table)) continue;
    declared.tables.add(table);
    const { alias, next } = aliasAfter(sql, (m.index ?? 0) + m[0].length, table);
    const seen = declared.aliases.get(alias);
    declared.aliases.set(alias, seen !== undefined && seen !== table ? null : table);
    if (/^\s*,/.test(sql.slice(next, next + 16))) declared.commaJoin = true;
  }
  return declared;
}

/**
 * Each paren group holding a SELECT that a name follows — a derived table —
 * with its bounds. This codebase names the derived table after the alias it
 * wraps (`FROM (SELECT el.… FROM experience_locations el …) el`), so the
 * bounds are what tells the two apart: inside them `el` is the base table
 * and its references are checked; outside, it is the subquery and they are
 * not. Holding rather than opening with a SELECT, so that nesting shadows
 * more rather than less — the safe direction. `DISTINCT ON (e.id) e.id` and
 * `count(*) AS n` hold none and shadow nothing.
 */
function derivedTables(sql: string): Shadow[] {
  const opens: number[] = [];
  const shadows: Shadow[] = [];
  for (let i = 0; i < sql.length; i++) {
    if (sql[i] === '(') opens.push(i);
    if (sql[i] !== ')') continue;
    const open = opens.pop();
    if (open === undefined || !/\bSELECT\b/i.test(sql.slice(open + 1, i))) continue;
    const { alias } = aliasAfter(sql, i + 1, '');
    if (alias !== '') shadows.push({ alias, open, close: i });
  }
  return shadows;
}

/** Every `alias.column` whose alias the literal declares, read where that alias is the base table. */
function qualifiedReferences(sql: string, declared: Declared, check: Check): void {
  for (const m of sql.matchAll(/\b([a-z_]\w*)\.([a-z_]\w*)\b/gi)) {
    const [, alias, column] = m;
    const at = m.index ?? 0;
    const table = declared.aliases.get(alias);
    if (table === undefined || table === null) continue;
    if (declared.shadows.some((s) => s.alias === alias && (at < s.open || at > s.close))) continue;
    check(table, column, `${alias}.${column}`);
  }
}

/** The bare column an item of a select list names, or null when it names something else. */
function bareColumn(item: string): string | null {
  // `DISTINCT name`, `name AS label`, `name`: the words around the name are
  // dropped, and anything with more shape than that names something else.
  const words = item.split(/\s+/);
  if (words[0]?.toUpperCase() === 'DISTINCT') words.shift();
  if (words.length === 3 && words[1].toUpperCase() === 'AS') words.length = 1;
  if (words.length !== 1 || !IDENTIFIER.test(words[0]) || NOT_A_COLUMN.has(words[0].toUpperCase())) return null;
  return words[0];
}

/** The bare names of every select list read from `table`, the literal's one possible owner. */
function projectionColumns(sql: string, table: string, check: Check): void {
  for (const m of sql.matchAll(/\bSELECT\s+/gi)) {
    const list = untilKeyword(sql, (m.index ?? 0) + m[0].length, /^FROM\b/i, false);
    if (list === null || wordAfter(sql, list.next)?.word !== table) continue;
    for (const item of listItems(list.body) ?? []) {
      const column = bareColumn(item);
      if (column !== null) check(table, column, column);
    }
  }
}

/** The columns every SET clause assigns, held to the table its UPDATE names. */
function setColumns(sql: string, schema: Schema, check: Check): void {
  for (const m of sql.matchAll(/\bUPDATE\s+([a-z_]\w*)/gi)) {
    const table = m[1];
    if (!schema.has(table)) continue;
    const set = untilKeyword(sql, (m.index ?? 0) + m[0].length, /^SET\b/i, false);
    const assignments = set === null ? null : untilKeyword(sql, set.next, /^(?:WHERE|FROM|RETURNING)\b|^;/i, true);
    for (const item of listItems(assignments?.body ?? '') ?? []) {
      const column = /^([a-z_]\w*)\s*=/i.exec(item);
      if (column) check(table, column[1], column[1]);
    }
  }
}

/** The column list of every INSERT, held to the table it inserts into. */
function insertColumns(sql: string, schema: Schema, check: Check): void {
  for (const [, table, list] of sql.matchAll(/\bINSERT\s+INTO\s+([a-z_]\w*)\s*\(([^)]*)\)/gi)) {
    if (!schema.has(table) || list.includes('${')) continue;
    for (const item of listItems(list) ?? []) {
      if (IDENTIFIER.test(item)) check(table, item, item);
    }
  }
}

/**
 * Every column a SQL literal names that the schema does not declare, and how
 * many references were actually resolved.
 */
function undeclaredColumns(literal: string, schema: Schema): Sweep {
  const sql = statementText(literal);
  const declared = declaredIn(sql, schema);
  const sweep: Sweep = { undeclared: [], checked: 0 };
  const check: Check = (table, column, reference) => {
    sweep.checked++;
    if (!schema.get(table)?.has(column)) sweep.undeclared.push({ reference, table });
  };
  qualifiedReferences(sql, declared, check);
  // A bare name is resolved only where nothing else could own it: one declared
  // table, no join, no comma-joined second source.
  if (declared.tables.size === 1 && !declared.commaJoin && !/\bJOIN\b/i.test(sql)) {
    projectionColumns(sql, [...declared.tables][0], check);
  }
  setColumns(sql, schema, check);
  insertColumns(sql, schema, check);
  return sweep;
}

function sourceFiles(): string[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the root is built from this module's own URL
  return readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts'));
}

function eachNode(node: ts.Node, visit: (n: ts.Node) => void): void {
  visit(node);
  node.forEachChild((child) => eachNode(child, visit));
}

/** Every string literal of a file that reads like a statement, with the line it starts on. */
function sqlLiterals(name: string): { text: string; line: number }[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- enumerated from a literal root
  const text = readFileSync(join(SRC, name), 'utf8');
  const source = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);
  const out: { text: string; line: number }[] = [];
  eachNode(source, (node) => {
    let literal: string | undefined;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) literal = node.text;
    // An interpolation becomes a `${}` marker: a fragment assembled elsewhere is
    // not this literal's claim, and the marker resolves to nothing above.
    else if (ts.isTemplateExpression(node)) {
      literal = node.head.text + node.templateSpans.map((span) => ` \${} ${span.literal.text}`).join('');
    }
    if (literal === undefined || !/\b(SELECT|UPDATE|INSERT|DELETE)\b/i.test(literal)) return;
    out.push({ text: literal, line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1 });
  });
  return out;
}

// eslint-disable-next-line security/detect-non-literal-fs-filename -- path is a literal resolved against this module's own URL
const schema = readFileSync(SCHEMA_PATH, 'utf8');
const tables = declaredColumns(schema);

describe('the schema as read', () => {
  it('yields every CREATE TABLE block, with the columns its ADD COLUMN clauses add', () => {
    const headers = schema.match(/^CREATE TABLE\b/gm) ?? [];
    expect(tables.size).toBe(headers.length);
    expect(tables.get('experiences')).toContain('type');
    expect(tables.get('experiences')).not.toContain('category');
    // `ALTER TABLE world_views ADD COLUMN IF NOT EXISTS is_public …`
    expect(tables.get('world_views')).toContain('is_public');
    // The guarded form: `ALTER TABLE experience_categories` on one line and
    // `ADD COLUMN requires_curation …` on the next, inside a DO block.
    expect(tables.get('experience_categories')).toContain('requires_curation');
    // A constraint line is not a column.
    expect(tables.get('experiences')).not.toContain('CONSTRAINT');
  });

  it('takes a CREATE TABLE with or without its IF NOT EXISTS guard', () => {
    const both = declaredColumns([
      'CREATE TABLE plain (\n    id SERIAL PRIMARY KEY,\n    name TEXT\n);',
      'CREATE TABLE IF NOT EXISTS guarded (\n    id SERIAL PRIMARY KEY\n);',
      'ALTER TABLE plain ADD COLUMN IF NOT EXISTS added INTEGER;',
    ].join('\n'));
    expect([...both.keys()]).toEqual(['plain', 'guarded']);
    expect([...both.get('plain')!]).toEqual(['id', 'name', 'added']);
  });
});

describe('the extractor', () => {
  it('names the column the type rename removed, in the statement that broke (#824)', () => {
    const sweep = undeclaredColumns(
      'SELECT id, category_id, name, short_description, description, category, image_url, tags, metadata, curated_fields\n     FROM experiences WHERE id = $1',
      tables,
    );
    expect(sweep.undeclared).toEqual([{ reference: 'category', table: 'experiences' }]);
    expect(sweep.checked).toBe(10);
  });

  it('resolves an alias the literal declares, across a join', () => {
    const sweep = undeclaredColumns(
      'SELECT e.id, e.category, el.curation_state FROM experiences e JOIN experience_locations el ON el.experience_id = e.id',
      tables,
    );
    expect(sweep.undeclared).toEqual([{ reference: 'e.category', table: 'experiences' }]);
  });

  it('leaves a bare name alone where a second table could own it', () => {
    const joined = undeclaredColumns(
      'SELECT id, category FROM experiences e JOIN experience_locations el ON el.experience_id = e.id',
      tables,
    );
    // `category` is not reported: the bare names are skipped. The two
    // qualified references of the ON clause are still resolved.
    expect(joined.undeclared).toEqual([]);
    expect(joined.checked).toBe(2);
    // The same for a comma-joined second source, which no JOIN keyword announces.
    expect(undeclaredColumns('SELECT id, category FROM experiences, experience_locations WHERE 1 = 1', tables).checked).toBe(0);
  });

  it('reads a select list past a subquery, and skips a fragment assembled elsewhere', () => {
    const sweep = undeclaredColumns(
      'SELECT id, category, (SELECT count(*) FROM experiences WHERE id = $1) AS n FROM experiences WHERE id = $1',
      tables,
    );
    // The outer list is cut at its own FROM, not the subquery's, so `category`
    // is still found beside it; the subquery's `count(*)` is nobody's column.
    expect(sweep.undeclared).toEqual([{ reference: 'category', table: 'experiences' }]);
    expect(sweep.checked).toBe(2);
    expect(undeclaredColumns('SELECT ${} FROM experiences WHERE id = $1', tables).checked).toBe(0);
  });

  it('holds a SET clause and an INSERT column list to their table', () => {
    expect(undeclaredColumns('UPDATE experiences SET category = $1, name = $2 WHERE id = $3', tables).undeclared)
      .toEqual([{ reference: 'category', table: 'experiences' }]);
    expect(undeclaredColumns('INSERT INTO experiences (category_id, category) VALUES ($1, $2)', tables).undeclared)
      .toEqual([{ reference: 'category', table: 'experiences' }]);
  });

  it('does not resolve an alias a derived table shadows', () => {
    // The inner `e` is experiences; the outer `e` is the subquery, whose
    // `derived` is nobody's column. Outside the group the alias resolves to
    // nothing, and the one reference resolved is the inner select list's
    // bare `id`.
    const sweep = undeclaredColumns(
      'SELECT e.derived FROM (SELECT id AS derived FROM experiences e) e',
      tables,
    );
    expect(sweep.undeclared).toEqual([]);
    expect(sweep.checked).toBe(1);
  });

  it('still reads the references inside the group the shadow wraps', () => {
    // The idiom of reviewQueueContents.ts: the derived table carries the
    // name of the base table's alias inside it. Inside, `el` is
    // experience_locations and is held to it; outside, it is the subquery.
    const sweep = undeclaredColumns(
      'SELECT el.id, el.name FROM (SELECT el.id, el.curation_state, el.category FROM experience_locations el) el',
      tables,
    );
    expect(sweep.undeclared).toEqual([{ reference: 'el.category', table: 'experience_locations' }]);
    expect(sweep.checked).toBe(3);
  });

  it('keeps an alias a paren that is not a subquery\'s is followed by', () => {
    // `DISTINCT ON (e.id) e.id` puts `e` right after a `)`; it is the alias
    // being used, not a derived table being named, and `e.*` stays checked.
    const sweep = undeclaredColumns(
      'SELECT DISTINCT ON (e.id) e.id, e.category, count(*) AS n FROM experiences e GROUP BY e.id',
      tables,
    );
    expect(sweep.undeclared).toEqual([{ reference: 'e.category', table: 'experiences' }]);
    expect(sweep.checked).toBe(4);
  });

  it('holds a DELETE to the table it names, through the alias its USING clause declares', () => {
    const sweep = undeclaredColumns(
      'DELETE FROM experience_regions er USING experiences e WHERE e.id = er.experience_id AND e.category = $1',
      tables,
    );
    expect(sweep.undeclared).toEqual([{ reference: 'e.category', table: 'experiences' }]);
  });

  it('ignores a table the schema does not declare: a CTE, a temp table, a function', () => {
    const sweep = undeclaredColumns(
      'WITH rows AS (SELECT id FROM experiences) SELECT id, category FROM rows JOIN unnest($1::int[]) u(id) ON u.id = rows.id',
      tables,
    );
    expect(sweep.undeclared).toEqual([]);
  });

  it('does not read a quoted label or a decimal as a qualified column', () => {
    const sweep = undeclaredColumns(
      "SELECT e.metadata->>'e.category' AS credit, 0.5 AS half FROM experiences e",
      tables,
    );
    expect(sweep.undeclared).toEqual([]);
    expect(sweep.checked).toBe(1);
  });

  it('reads past a SQL comment, apostrophe and all, and never inside one', () => {
    // The prose names a column that does not exist and carries a possessive;
    // read as SQL, the first would be reported and the second would invert the
    // quoting for everything after it. The statement itself is read whole.
    const commented = undeclaredColumns(
      [
        'SELECT e.id, -- the curator\'s claim, not e.category',
        '  e.curated_fields, /* e.category, again */ e.metadata',
        "FROM experiences e WHERE e.metadata->>'imageCredit' IS NOT NULL",
      ].join('\n'),
      tables,
    );
    expect(commented.undeclared).toEqual([]);
    expect(commented.checked).toBe(4);
    // A comma in the prose of a select list does not split it into a word
    // that is then reported as a column.
    const split = undeclaredColumns('SELECT id, -- matched, and\n  name FROM experiences WHERE id = $1', tables);
    expect(split.undeclared).toEqual([]);
    expect(split.checked).toBe(2);
    // A block comment leaves nothing behind: the `/` of its `*/` goes with it,
    // or the item beside it would read `id /` and be skipped.
    const block = undeclaredColumns('SELECT id /* the pin */, name FROM experiences WHERE id = $1', tables);
    expect(block.checked).toBe(2);
  });
});

describe('every statement in backend/src', () => {
  const sweeps = sourceFiles().flatMap((name) => sqlLiterals(name).map((literal) => ({
    where: `${name}:${literal.line}`,
    ...undeclaredColumns(literal.text, tables),
  })));

  it('names only columns the schema declares', () => {
    const failures = sweeps.flatMap((s) => s.undeclared.map((u) => `${s.where} — ${u.reference} is not a column of ${u.table}`));
    expect(failures).toEqual([]);
  });

  it('still resolves the references it did when written', () => {
    // 4204 on 2026-09-06. A fall below the floor is the extractor going
    // blind — a literal shape it no longer reads — not the tree losing a
    // quarter of its SQL.
    const checked = sweeps.reduce((n, s) => n + s.checked, 0);
    expect(checked, `the sweep resolved ${checked} references`).toBeGreaterThanOrEqual(3000);
  });
});
