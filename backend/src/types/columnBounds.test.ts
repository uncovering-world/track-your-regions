import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  addDivisionsToRegionBodySchema,
  baseLayerImportBodySchema,
  createRegionBodySchema,
  createWorldViewBodySchema,
  updateRegionBodySchema,
  updateWorldViewBodySchema,
  wvExtractStartSchema,
  wvImportAddChildSchema,
  wvImportApproveCoverageSchema,
  wvImportBodySchema,
  wvImportRenameRegionSchema,
} from './index.js';

/**
 * A request bound wider than the column behind it is invisible until a caller
 * uses the gap: Zod accepts the value, Postgres raises 22001 on the
 * INSERT/UPDATE, and — the driver error carrying no statusCode — the caller
 * gets a 500, masked to "Internal server error" in production. That is how a
 * 1200-character world view description used to fail (#444).
 *
 * The widths below are read out of db/init/01-schema.sql, the same file
 * docker-entrypoint-initdb.d applies, rather than restated here — the number
 * stays one fact rather than two that can disagree. Bound and column are held
 * equal, which names the drift whichever way it happens: a column narrowed
 * under its bound, or a column widened while the bound that was supposed to
 * follow it stayed put.
 */
const SCHEMA_PATH = fileURLToPath(new URL('../../../db/init/01-schema.sql', import.meta.url));
// eslint-disable-next-line security/detect-non-literal-fs-filename -- path is a literal resolved against this module's own URL
const schema = readFileSync(SCHEMA_PATH, 'utf8');

/** Widths of the VARCHAR columns declared in one `CREATE TABLE` block. */
function varcharWidths(table: string): Map<string, number> {
  const header = `CREATE TABLE IF NOT EXISTS ${table} (`;
  const start = schema.indexOf(header);
  if (start === -1) throw new Error(`db/init/01-schema.sql declares no table ${table}`);
  const end = schema.indexOf('\n);', start);
  if (end === -1) throw new Error(`unterminated CREATE TABLE for ${table}`);

  const widths = new Map<string, number>();
  for (const line of schema.slice(start + header.length, end).split('\n')) {
    const column = /^\s*(\w+)\s+VARCHAR\((\d+)\)/i.exec(line);
    if (column) widths.set(column[1], Number(column[2]));
  }
  return widths;
}

const WIDTHS: Record<string, Map<string, number>> = {
  world_views: varcharWidths('world_views'),
  regions: varcharWidths('regions'),
  region_members: varcharWidths('region_members'),
};

function columnWidth(table: string, column: string): number {
  const width = WIDTHS[table]?.get(column);
  if (width === undefined) throw new Error(`${table}.${column} is not a VARCHAR column`);
  return width;
}

interface RequestSchema {
  safeParse: (data: unknown) => { success: boolean };
}

interface BoundCase {
  /** Where the bound lives, for the test name. */
  field: string;
  schema: RequestSchema;
  table: 'world_views' | 'regions' | 'region_members';
  column: string;
  /** A payload valid apart from the field under test. */
  build: (value: string) => unknown;
}

/**
 * Every bounded request field that lands in a VARCHAR column of `world_views`,
 * `regions` or `region_members` — a field writing two of them appears once per
 * column. Fields writing TEXT columns (source_url, source_external_id)
 * have nothing to align with and stay out, and so does a field deliberately
 * bounded tighter than its column — `baseLayerImportBodySchema.providerLabel`
 * is sized for the 51-character prefix it gets embedded in, so equality with
 * `world_views.description` is exactly what it must not have.
 */
const CASES: BoundCase[] = [
  {
    field: 'createWorldViewBodySchema.name',
    schema: createWorldViewBodySchema,
    table: 'world_views',
    column: 'name',
    build: (value) => ({ name: value }),
  },
  {
    field: 'createWorldViewBodySchema.description',
    schema: createWorldViewBodySchema,
    table: 'world_views',
    column: 'description',
    build: (value) => ({ name: 'Cultural Regions', description: value }),
  },
  {
    field: 'createWorldViewBodySchema.source',
    schema: createWorldViewBodySchema,
    table: 'world_views',
    column: 'source',
    build: (value) => ({ name: 'Cultural Regions', source: value }),
  },
  {
    field: 'updateWorldViewBodySchema.name',
    schema: updateWorldViewBodySchema,
    table: 'world_views',
    column: 'name',
    build: (value) => ({ name: value }),
  },
  {
    field: 'updateWorldViewBodySchema.description',
    schema: updateWorldViewBodySchema,
    table: 'world_views',
    column: 'description',
    build: (value) => ({ description: value }),
  },
  {
    field: 'updateWorldViewBodySchema.source',
    schema: updateWorldViewBodySchema,
    table: 'world_views',
    column: 'source',
    build: (value) => ({ source: value }),
  },
  {
    field: 'createRegionBodySchema.name',
    schema: createRegionBodySchema,
    table: 'regions',
    column: 'name',
    build: (value) => ({ name: value }),
  },
  {
    field: 'createRegionBodySchema.description',
    schema: createRegionBodySchema,
    table: 'regions',
    column: 'description',
    build: (value) => ({ name: 'Nordic Countries', description: value }),
  },
  {
    field: 'createRegionBodySchema.color',
    schema: createRegionBodySchema,
    table: 'regions',
    column: 'color',
    build: (value) => ({ name: 'Nordic Countries', color: value }),
  },
  {
    field: 'updateRegionBodySchema.name',
    schema: updateRegionBodySchema,
    table: 'regions',
    column: 'name',
    build: (value) => ({ name: value }),
  },
  {
    field: 'updateRegionBodySchema.description',
    schema: updateRegionBodySchema,
    table: 'regions',
    column: 'description',
    build: (value) => ({ description: value }),
  },
  {
    field: 'updateRegionBodySchema.color',
    schema: updateRegionBodySchema,
    table: 'regions',
    column: 'color',
    build: (value) => ({ color: value }),
  },
  {
    // Names the subregion that addDivisionsToRegion creates…
    field: 'addDivisionsToRegionBodySchema.customName',
    schema: addDivisionsToRegionBodySchema,
    table: 'regions',
    column: 'name',
    build: (value) => ({ divisionIds: [1], customName: value }),
  },
  {
    // …and is stored beside the member it names. One field, two columns: both
    // are asserted, so the bound has to fit whichever is narrower rather than
    // being taken on the word of a comment.
    field: 'addDivisionsToRegionBodySchema.customName',
    schema: addDivisionsToRegionBodySchema,
    table: 'region_members',
    column: 'custom_name',
    build: (value) => ({ divisionIds: [1], customName: value }),
  },
  {
    field: 'wvImportBodySchema.name',
    schema: wvImportBodySchema,
    table: 'world_views',
    column: 'name',
    build: (value) => ({ name: value, tree: { name: 'Europe' } }),
  },
  {
    // The other two ways a request names a world view: the base layer mirror
    // and a Wikivoyage extraction both create one under the name they are
    // given. Sized right already — here so a later widening cannot pass.
    field: 'baseLayerImportBodySchema.name',
    schema: baseLayerImportBodySchema,
    table: 'world_views',
    column: 'name',
    build: (value) => ({ name: value, providerLabel: 'GADM 4.1', maxDepth: 2 }),
  },
  {
    field: 'wvExtractStartSchema.name',
    schema: wvExtractStartSchema,
    table: 'world_views',
    column: 'name',
    build: (value) => ({ name: value }),
  },
  {
    // Every node of the imported tree becomes a region.
    field: 'wvImportBodySchema.tree.name',
    schema: wvImportBodySchema,
    table: 'regions',
    column: 'name',
    build: (value) => ({ name: 'Wikivoyage', tree: { name: value } }),
  },
  {
    field: 'wvImportRenameRegionSchema.name',
    schema: wvImportRenameRegionSchema,
    table: 'regions',
    column: 'name',
    build: (value) => ({ regionId: 1, name: value }),
  },
  {
    field: 'wvImportAddChildSchema.name',
    schema: wvImportAddChildSchema,
    table: 'regions',
    column: 'name',
    build: (value) => ({ parentRegionId: 1, name: value }),
  },
  {
    // Already sized correctly when this guard was written; here so it stays
    // that way — the review that found the add-child bound found it by hand.
    field: 'wvImportApproveCoverageSchema.gapName',
    schema: wvImportApproveCoverageSchema,
    table: 'regions',
    column: 'name',
    build: (value) => ({ divisionId: 1, regionId: 1, action: 'create_region', gapName: value }),
  },
];

describe('request bounds against their columns', () => {
  it('resolves every column it guards', () => {
    // Guards the guard: a mistyped table or column, or one that has since
    // become TEXT, would otherwise throw inside a single case rather than say
    // plainly which entry stopped guarding anything.
    const unresolved = CASES
      .filter(({ table, column }) => WIDTHS[table]?.get(column) === undefined)
      .map(({ table, column }) => `${table}.${column}`);

    expect(unresolved).toEqual([]);
  });

  for (const { field, schema: requestSchema, table, column, build } of CASES) {
    it(`${field} stops at the width of ${table}.${column}`, () => {
      const width = columnWidth(table, column);

      expect(
        requestSchema.safeParse(build('x'.repeat(width))).success,
        `${field} must accept a value that fits ${table}.${column}`,
      ).toBe(true);

      expect(
        requestSchema.safeParse(build('x'.repeat(width + 1))).success,
        `${field} must reject what ${table}.${column} cannot store — Postgres would raise 22001`,
      ).toBe(false);
    });
  }
});
