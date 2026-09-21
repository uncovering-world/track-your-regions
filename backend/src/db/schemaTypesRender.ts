/**
 * The pure half of the schema-type generator (ADR-0064, #792): what a Postgres
 * column becomes in TypeScript, which CHECK constraints are a value list, and
 * the text of `schema.generated.ts`. `generateSchemaTypes.ts` reads the
 * catalog and hands the rows here; nothing in this file touches a database, so
 * every rule is a unit test away.
 *
 * What is generated is the *select shape*: the value `pg` hands back for
 * `SELECT column` with no type parser installed — `db/index.ts` installs none —
 * so `int8` and `numeric` are strings, a timestamp is a `Date`, and a
 * geometry column is its hex EWKB. A caller that wants a number out of a
 * bigint says so in SQL (`::int`) or parses it, the way the codebase already
 * does; the type says what arrives, not what one would like.
 */

/** One column of one relation, as `generateSchemaTypes.ts` reads it. */
export interface CatalogColumn {
  table: string;
  /** `r` for a table, `v` for a view: a view's columns are never NOT NULL. */
  relkind: string;
  column: string;
  /** `format_type(atttypid, atttypmod)`: `character varying(500)`, `character varying(10)[]`, `geometry(Point,4326)`. */
  formatted: string;
  /** The type's catalog name: `varchar`, `_varchar` for its array, `user_role` for an enum. */
  udtName: string;
  /** `e` for an enum, `b` for a base type, and so on (`pg_type.typtype`). */
  typtype: string;
  /** For an array type, the element's catalog name; null otherwise. */
  elementUdtName: string | null;
  elementTyptype: string | null;
  notNull: boolean;
}

export interface CatalogEnum {
  name: string;
  values: string[];
}

export interface CatalogCheck {
  table: string;
  name: string;
  /** `pg_get_constraintdef(oid)`. */
  definition: string;
}

/** A CHECK constraint the generator recognised as a value list on one column. */
export interface ValueList {
  table: string;
  column: string;
  values: string[];
}

/**
 * Postgres catalog names → the TypeScript type `pg` delivers.
 *
 * Deliberately a closed list: a column of a type not named here fails the
 * generator with the table and column, rather than becoming `unknown` on the
 * quiet. A new type is mapped on purpose, once, here.
 */
export const SCALAR_TYPES: Record<string, string> = {
  int2: 'number',
  int4: 'number',
  oid: 'number',
  float4: 'number',
  float8: 'number',
  // pg returns 64-bit integers and arbitrary-precision numbers as strings, since
  // a JavaScript number cannot hold every value they can.
  int8: 'string',
  numeric: 'string',
  bool: 'boolean',
  varchar: 'string',
  bpchar: 'string',
  text: 'string',
  name: 'string',
  uuid: 'string',
  daterange: 'string',
  timestamptz: 'Date',
  timestamp: 'Date',
  date: 'Date',
  json: 'unknown',
  jsonb: 'unknown',
  // Hex EWKB; every reader that wants coordinates asks PostGIS for GeoJSON or
  // ST_X/ST_Y in the statement, never parses the column.
  geometry: 'string',
  geography: 'string',
};

const IDENTIFIER = /^[A-Za-z_]\w*$/;

/** `experience_kind_memberships` → `ExperienceKindMemberships`. */
export function pascalCase(name: string): string {
  return name
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

/** The interface name a relation's rows get. */
export function rowTypeName(table: string): string {
  return `${pascalCase(table)}Row`;
}

/** A property key or object key, quoted only when it has to be. */
function key(name: string): string {
  return IDENTIFIER.test(name) ? name : JSON.stringify(name);
}

function scalarType(udtName: string, typtype: string, enums: Map<string, string>): string | undefined {
  if (typtype === 'e') return enums.get(udtName);
  return SCALAR_TYPES[udtName];
}

/**
 * The TypeScript type of one column, `| null` included.
 *
 * `enums` maps a Postgres enum's catalog name to the TypeScript type name the
 * generated file declares for it.
 */
export function columnType(column: CatalogColumn, enums: Map<string, string>): string {
  let base: string | undefined;
  if (column.elementUdtName !== null) {
    const element = scalarType(column.elementUdtName, column.elementTyptype ?? 'b', enums);
    base = element === undefined ? undefined : `${element}[]`;
  } else {
    base = scalarType(column.udtName, column.typtype, enums);
  }
  if (base === undefined) {
    throw new Error(
      `${column.table}.${column.column} has type ${column.formatted} (${column.udtName}), which `
        + 'schemaTypesRender.ts does not map. Add it to SCALAR_TYPES on purpose.',
    );
  }
  // A view's columns carry no NOT NULL in the catalog, whatever the base
  // table says, so every one of them is nullable here.
  const nullable = column.relkind === 'v' || !column.notNull;
  return nullable ? `${base} | null` : base;
}

/**
 * The declared width of a `VARCHAR(n)` / `CHAR(n)` column, or of one element
 * of such an array — `country_codes VARCHAR(10)[]` is bounded at 10 per
 * element, which is what a request field is measured against. Undefined for
 * every other type: TEXT has no width to align a bound with.
 */
export function columnWidth(column: CatalogColumn): number | undefined {
  const match = /^character(?: varying)?\((\d+)\)(?:\[\])*$/.exec(column.formatted);
  return match ? Number(match[1]) : undefined;
}

/**
 * A CHECK constraint that is a value list on one column, or null.
 *
 * Postgres restates `col IN ('a', 'b')` as
 * `(col)::text = ANY ((ARRAY['a'::character varying, 'b'::character varying])::text[])`
 * on a VARCHAR column and as `col = ANY (ARRAY['a'::text, 'b'::text])` on a
 * TEXT one. Recognised: exactly one such list, on its own or behind
 * `col IS NULL OR` for the same column. A range (`rating >= 1 AND rating <= 5`),
 * a presence rule (`not_available OR geom IS NOT NULL`) and a constraint over
 * several columns (`valid_scope`) say nothing a TypeScript union could carry
 * and are passed over — not an error, since every such constraint is a
 * legitimate thing for the schema to hold.
 *
 * Read by cutting the definition at its landmarks rather than by one regular
 * expression, whose optional groups around the column would backtrack on a
 * long definition (sonarjs/slow-regex).
 */
export function parseValueList(check: CatalogCheck): ValueList | null {
  const body = check.definition.replace(/^CHECK \(/, '').replace(/\)$/, '');
  const anyAt = body.indexOf(' = ANY (');
  const arrayAt = body.indexOf('ARRAY[', anyAt);
  const arrayEnd = body.indexOf(']', arrayAt);
  if (anyAt === -1 || arrayAt === -1 || arrayEnd === -1) return null;

  // The column is the word just before `= ANY`, once its casts and
  // parentheses are peeled: `(change_type)::text` or plain `signoff_status`.
  const left = body.slice(0, anyAt).replace(/::text$/, '').replace(/\)$/, '');
  const column = left.slice(Math.max(left.lastIndexOf('('), left.lastIndexOf(' ')) + 1);
  if (!IDENTIFIER.test(column)) return null;

  const values = [...body.slice(arrayAt + 'ARRAY['.length, arrayEnd).matchAll(/'((?:[^']|'')*)'/g)]
    .map((m) => m[1].replace(/''/g, "'"));
  if (values.length === 0) return null;

  // What is left once the list and its operators are removed has to be the
  // column alone, or the column twice around IS NULL OR: anything else is a
  // constraint that says more than a list, or one whose guard is on another
  // column, and neither is a vocabulary.
  const remainder = (body.slice(0, arrayAt) + body.slice(arrayEnd + 1))
    .replace(/::text\[\]/g, '')
    .replace(/::text/g, '')
    .replace(/= ANY/g, '')
    .replace(/[\s()]/g, '');
  if (remainder !== column && remainder !== `${column}ISNULLOR${column}`) return null;
  return { table: check.table, column, values };
}

/** Group rows by a key, keeping first-seen order of the keys and of the rows. */
function groupBy<T>(rows: T[], by: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const k = by(row);
    const group = groups.get(k);
    if (group) group.push(row);
    else groups.set(k, [row]);
  }
  return groups;
}

const HEADER = `/**
 * GENERATED by backend/src/db/generateSchemaTypes.ts from the database that
 * db/init/01-schema.sql builds. Do not edit: run \`npm run db:types\` after a
 * schema change, and \`npm run db:types:check\` (a check-tier gate, ADR-0064)
 * fails when this file and the schema disagree.
 *
 * Every interface is a relation's *select shape*: what \`pg\` returns for
 * \`SELECT column\` with no type parser installed. \`int8\` and \`numeric\` arrive
 * as strings, timestamps as \`Date\`, a geometry as hex EWKB, JSON as \`unknown\`.
 * A view's columns are all nullable, since the catalog records no NOT NULL for
 * them.
 */
`;

/**
 * The whole of `schema.generated.ts`, from the catalog rows.
 *
 * Deterministic: relations, enums and constraints are sorted here rather than
 * trusted to arrive sorted, so two runs against the same schema are
 * byte-identical and the check gate's diff is about the schema alone.
 */
export function renderSchemaTypes(
  columns: CatalogColumn[],
  enums: CatalogEnum[],
  checks: CatalogCheck[],
): string {
  const enumTypeNames = new Map(enums.map((e) => [e.name, pascalCase(e.name)]));
  const out: string[] = [HEADER];

  for (const e of [...enums].sort((a, b) => a.name.localeCompare(b.name))) {
    out.push(`/** Postgres enum \`${e.name}\`. */`);
    out.push(`export type ${pascalCase(e.name)} = ${e.values.map((v) => JSON.stringify(v)).join(' | ')};`);
    out.push('');
  }

  const relations = [...groupBy(columns, (c) => c.table).entries()]
    .sort(([a], [b]) => a.localeCompare(b));

  for (const [table, cols] of relations) {
    const kind = cols[0].relkind === 'v' ? 'view' : 'table';
    out.push(`/** The ${kind} \`${table}\`. */`);
    out.push(`export interface ${rowTypeName(table)} {`);
    for (const col of cols) out.push(`  ${key(col.column)}: ${columnType(col, enumTypeNames)};`);
    out.push('}');
    out.push('');
  }

  out.push('/**');
  out.push(' * The declared width of every VARCHAR and CHAR column, per element for an');
  out.push(' * array. A request field that lands in one of these is bounded by this');
  out.push(' * number and nothing else, so the bound and the column cannot disagree.');
  out.push(' */');
  out.push('export const COLUMN_WIDTHS = {');
  for (const [table, cols] of relations) {
    const widths = cols.flatMap((col) => {
      const width = columnWidth(col);
      return width === undefined ? [] : [`    ${key(col.column)}: ${width},`];
    });
    if (widths.length === 0) continue;
    out.push(`  ${key(table)}: {`);
    out.push(...widths);
    out.push('  },');
  }
  out.push('} as const;');
  out.push('');

  const lists = [...checks]
    .sort((a, b) => a.table.localeCompare(b.table) || a.name.localeCompare(b.name))
    .map(parseValueList)
    .filter((list): list is ValueList => list !== null);
  out.push('/**');
  out.push(' * Every CHECK constraint that is a value list on one column, in the order');
  out.push(' * the schema declares the values. A TypeScript home of the same vocabulary');
  out.push(' * reads it from here (`CheckValue`) rather than restating it.');
  out.push(' */');
  out.push('export const CHECK_VALUES = {');
  for (const [table, tableLists] of groupBy(lists, (l) => l.table)) {
    out.push(`  ${key(table)}: {`);
    for (const list of tableLists) {
      out.push(`    ${key(list.column)}: [${list.values.map((v) => JSON.stringify(v)).join(', ')}],`);
    }
    out.push('  },');
  }
  out.push('} as const;');
  out.push('');
  out.push('/** The union a CHECK value list allows: `CheckValue<\'experience_sync_changes\', \'change_type\'>`. */');
  out.push('export type CheckValue<');
  out.push('  T extends keyof typeof CHECK_VALUES,');
  out.push('  C extends keyof (typeof CHECK_VALUES)[T],');
  out.push('> = (typeof CHECK_VALUES)[T][C] extends readonly (infer V)[] ? V : never;');
  out.push('');

  return out.join('\n');
}
