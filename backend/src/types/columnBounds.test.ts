import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  addDivisionsToRegionBodySchema,
  addLearnedRuleBodySchema,
  aiSettingKeyParamSchema,
  baseLayerImportBodySchema,
  createManualExperienceBodySchema,
  createRegionBodySchema,
  createWorldViewBodySchema,
  editExperienceBodySchema,
  updateRegionBodySchema,
  updateWorldViewBodySchema,
  wvExtractStartSchema,
  wvImportAddChildSchema,
  wvImportApproveCoverageSchema,
  wvImportBodySchema,
  wvImportRenameRegionSchema,
} from './index.js';
import { registerSchema } from './auth.js';

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

/**
 * Widths of the VARCHAR columns declared in one `CREATE TABLE` block. An array
 * column (`country_codes VARCHAR(10)[]`) yields the width of one element,
 * which is what a request field is bounded against.
 */
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

const WIDTHS = {
  world_views: varcharWidths('world_views'),
  regions: varcharWidths('regions'),
  region_members: varcharWidths('region_members'),
  experiences: varcharWidths('experiences'),
  experience_locations: varcharWidths('experience_locations'),
  users: varcharWidths('users'),
  ai_settings: varcharWidths('ai_settings'),
  ai_learned_rules: varcharWidths('ai_learned_rules'),
};

type GuardedTable = keyof typeof WIDTHS;

function columnWidth(table: GuardedTable, column: string): number {
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
  table: GuardedTable;
  column: string;
  /** A payload valid apart from the field under test. */
  build: (value: string) => unknown;
  /**
   * A value of the requested length that the field's other rules accept — an
   * address for an email field, say. Plain filler otherwise.
   */
  fill?: (length: number) => string;
  /**
   * Set when the bound is deliberately below the column, with the reason it is.
   * The test then pins that number instead of the width, and still checks it
   * fits. Wider than the column is never deliberate — that is the bug this
   * file exists to catch.
   */
  tighterThanColumn?: { bound: number; reason: string };
}

/** A create-experience payload that is valid apart from the given override. */
function manualExperience(override: Record<string, unknown>): unknown {
  return {
    name: 'Sagrada Família',
    longitude: 2.1744,
    latitude: 41.4036,
    regionId: 1,
    categoryId: 1,
    ...override,
  };
}

/**
 * An https url of exactly the requested length. `imageUrl` is no longer filler
 * with a bound on it: it has to be an absolute http(s) url or a path on our own
 * origin (#693), and since ADR-0043 a picture file on a host whose licence lets
 * us draw it — so a run of `x`, or a run of `a` with no file type on the end,
 * would be refused for its shape and the width this case exists to measure
 * would go unmeasured.
 */
function imageUrlOfLength(length: number): string {
  const prefix = 'https://upload.wikimedia.org/wikipedia/commons/';
  const suffix = '.jpg';
  return prefix + 'a'.repeat(length - prefix.length - suffix.length) + suffix;
}

/**
 * Every bounded request field that lands in a VARCHAR column of the tables
 * above — a field writing two of them appears once per column. Fields writing
 * TEXT or JSONB (source_url, an experience's description, the website and
 * wikipedia URLs kept in `metadata`) have no width to align with and stay out.
 * A field bounded tighter than its column on purpose stays in, carrying the
 * reason with it.
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
  {
    field: 'baseLayerImportBodySchema.providerLabel',
    schema: baseLayerImportBodySchema,
    table: 'world_views',
    column: 'description',
    build: (value) => ({ name: 'Administrative', providerLabel: value, maxDepth: 2 }),
    tighterThanColumn: {
      bound: 949,
      reason: 'embedded in `Mirror of the administrative base layer (<label>), depth <n>`, 51 fixed characters',
    },
  },

  // --- Experiences -----------------------------------------------------------
  {
    field: 'editExperienceBodySchema.name',
    schema: editExperienceBodySchema,
    table: 'experiences',
    column: 'name',
    build: (value) => ({ name: value }),
  },
  {
    field: 'editExperienceBodySchema.category',
    schema: editExperienceBodySchema,
    table: 'experiences',
    column: 'category',
    build: (value) => ({ category: value }),
  },
  {
    field: 'editExperienceBodySchema.imageUrl',
    schema: editExperienceBodySchema,
    table: 'experiences',
    column: 'image_url',
    build: (value) => ({ imageUrl: value }),
    fill: imageUrlOfLength,
  },
  {
    field: 'createManualExperienceBodySchema.name',
    schema: createManualExperienceBodySchema,
    table: 'experiences',
    column: 'name',
    build: (value) => manualExperience({ name: value }),
  },
  {
    // The same name is also written as the experience's first location.
    field: 'createManualExperienceBodySchema.name',
    schema: createManualExperienceBodySchema,
    table: 'experience_locations',
    column: 'name',
    build: (value) => manualExperience({ name: value }),
  },
  {
    field: 'createManualExperienceBodySchema.category',
    schema: createManualExperienceBodySchema,
    table: 'experiences',
    column: 'category',
    build: (value) => manualExperience({ category: value }),
  },
  {
    field: 'createManualExperienceBodySchema.imageUrl',
    schema: createManualExperienceBodySchema,
    table: 'experiences',
    column: 'image_url',
    build: (value) => manualExperience({ imageUrl: value }),
    fill: imageUrlOfLength,
  },
  {
    // Stored as one element of a VARCHAR(10)[] / VARCHAR(255)[].
    field: 'createManualExperienceBodySchema.countryCode',
    schema: createManualExperienceBodySchema,
    table: 'experiences',
    column: 'country_codes',
    build: (value) => manualExperience({ countryCode: value }),
  },
  {
    field: 'createManualExperienceBodySchema.countryName',
    schema: createManualExperienceBodySchema,
    table: 'experiences',
    column: 'country_names',
    build: (value) => manualExperience({ countryName: value }),
  },

  // --- Accounts --------------------------------------------------------------
  {
    field: 'registerSchema.email',
    schema: registerSchema,
    table: 'users',
    column: 'email',
    build: (value) => ({ email: value, password: 'correct horse battery', displayName: 'Ada' }),
    fill: (length) => `${'a'.repeat(length - '@example.com'.length)}@example.com`,
    tighterThanColumn: {
      bound: 254,
      reason: 'RFC 5321 § 4.5.3.1.3 — the longest address SMTP will carry',
    },
  },
  {
    field: 'registerSchema.displayName',
    schema: registerSchema,
    table: 'users',
    column: 'display_name',
    build: (value) => ({ email: 'ada@example.com', password: 'correct horse battery', displayName: value }),
  },

  // --- Admin AI ---------------------------------------------------------------
  {
    field: 'aiSettingKeyParamSchema.key',
    schema: aiSettingKeyParamSchema,
    table: 'ai_settings',
    column: 'key',
    build: (value) => ({ key: value }),
  },
  {
    field: 'addLearnedRuleBodySchema.feature',
    schema: addLearnedRuleBodySchema,
    table: 'ai_learned_rules',
    column: 'feature',
    build: (value) => ({ feature: value, ruleText: 'Prefer the shorter name.' }),
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

  for (const { field, schema: requestSchema, table, column, build, fill, tighterThanColumn } of CASES) {
    const filler = fill ?? ((length: number) => 'x'.repeat(length));
    const stopsAt = tighterThanColumn
      ? `${tighterThanColumn.bound}, within ${table}.${column}`
      : `the width of ${table}.${column}`;

    it(`${field} stops at ${stopsAt}`, () => {
      const width = columnWidth(table, column);
      const bound = tighterThanColumn?.bound ?? width;

      expect(
        bound,
        `${field} is bounded at ${bound} (${tighterThanColumn?.reason}), which no longer fits ${table}.${column}`,
      ).toBeLessThanOrEqual(width);

      expect(
        requestSchema.safeParse(build(filler(bound))).success,
        `${field} must accept a value of its full ${bound} characters`,
      ).toBe(true);

      expect(
        requestSchema.safeParse(build(filler(bound + 1))).success,
        `${field} must reject what ${table}.${column} cannot store — Postgres would raise 22001`,
      ).toBe(false);
    });
  }
});
