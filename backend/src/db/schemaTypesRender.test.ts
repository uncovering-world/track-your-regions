import { describe, it, expect } from 'vitest';
import {
  columnType,
  columnWidth,
  parseValueList,
  pascalCase,
  renderSchemaTypes,
  rowTypeName,
  type CatalogColumn,
} from './schemaTypesRender.js';

/**
 * The generator's rules, on catalog rows captured from a database built by
 * db/init/01-schema.sql on 2026-09-21. `pg_get_constraintdef` is what Postgres
 * makes of `CHECK (col IN (...))`, not what the schema file says, which is why
 * the definitions below are pasted rather than typed.
 */

const column = (over: Partial<CatalogColumn>): CatalogColumn => ({
  table: 'experiences',
  relkind: 'r',
  column: 'name',
  formatted: 'character varying(500)',
  udtName: 'varchar',
  typtype: 'b',
  elementUdtName: null,
  elementTyptype: null,
  notNull: true,
  ...over,
});

const enums = new Map([['user_role', 'UserRole'], ['auth_provider', 'AuthProvider']]);

describe('a column becomes the type pg hands back', () => {
  it.each([
    ['integer', 'int4', 'number'],
    ['bigint', 'int8', 'string'],
    ['numeric', 'numeric', 'string'],
    ['double precision', 'float8', 'number'],
    ['boolean', 'bool', 'boolean'],
    ['text', 'text', 'string'],
    ['character(2)', 'bpchar', 'string'],
    ['timestamp with time zone', 'timestamptz', 'Date'],
    ['jsonb', 'jsonb', 'unknown'],
    ['geometry(Point,4326)', 'geometry', 'string'],
    ['daterange', 'daterange', 'string'],
  ])('%s → %s', (formatted, udtName, expected) => {
    expect(columnType(column({ formatted, udtName, notNull: true }), enums)).toBe(expected);
  });

  it('a nullable column carries | null', () => {
    expect(columnType(column({ udtName: 'text', formatted: 'text', notNull: false }), enums)).toBe('string | null');
  });

  it("a view's column is nullable whatever the catalog says", () => {
    expect(columnType(column({ relkind: 'v', notNull: true }), enums)).toBe('string | null');
  });

  it('an enum column is the enum type the file declares', () => {
    expect(columnType(column({ formatted: 'user_role', udtName: 'user_role', typtype: 'e' }), enums)).toBe('UserRole');
  });

  it('an array column is the element type, listed', () => {
    const codes = column({
      column: 'country_codes',
      formatted: 'character varying(10)[]',
      udtName: '_varchar',
      elementUdtName: 'varchar',
      elementTyptype: 'b',
      notNull: false,
    });
    expect(columnType(codes, enums)).toBe('string[] | null');
    const bbox = column({
      column: 'focus_bbox',
      formatted: 'double precision[]',
      udtName: '_float8',
      elementUdtName: 'float8',
      elementTyptype: 'b',
      notNull: false,
    });
    expect(columnType(bbox, enums)).toBe('number[] | null');
  });

  it('a type nobody mapped fails with the column, never becomes unknown quietly', () => {
    expect(() => columnType(column({ formatted: 'interval', udtName: 'interval' }), enums))
      .toThrow('experiences.name has type interval (interval)');
  });
});

describe('a width is read off VARCHAR and CHAR, per element', () => {
  it.each([
    ['character varying(500)', 500],
    ['character(2)', 2],
    ['character varying(10)[]', 10],
    ['text', undefined],
    ['integer', undefined],
  ])('%s → %s', (formatted, expected) => {
    expect(columnWidth(column({ formatted }))).toBe(expected);
  });
});

describe('a CHECK constraint is a value list when it is one list on one column', () => {
  const check = (table: string, definition: string) => ({ table, name: `${table}_check`, definition });

  it('reads the list Postgres makes of IN (...) on a VARCHAR column, in declared order', () => {
    expect(parseValueList(check(
      'experience_sync_changes',
      "CHECK (((change_type)::text = ANY ((ARRAY['created'::character varying, 'updated'::character varying, "
        + "'conflict'::character varying, 'held'::character varying, 'contents'::character varying, "
        + "'missing'::character varying, 'returned'::character varying, 'failed'::character varying, "
        + "'filtered'::character varying])::text[])))",
    ))).toEqual({
      table: 'experience_sync_changes',
      column: 'change_type',
      values: ['created', 'updated', 'conflict', 'held', 'contents', 'missing', 'returned', 'failed', 'filtered'],
    });
  });

  it('reads the list on a TEXT column, which Postgres casts differently', () => {
    expect(parseValueList(check(
      'region_import_state',
      "CHECK ((signoff_status = ANY (ARRAY['not_started'::text, 'in_progress'::text, 'signed_off'::text])))",
    ))).toEqual({
      table: 'region_import_state',
      column: 'signoff_status',
      values: ['not_started', 'in_progress', 'signed_off'],
    });
  });

  it('reads a list behind IS NULL OR, the shape a nullable vocabulary takes', () => {
    expect(parseValueList(check(
      'experience_held_decisions',
      "CHECK (((part_kind IS NULL) OR ((part_kind)::text = ANY ((ARRAY['locations'::character varying, "
        + "'treasures'::character varying])::text[]))))",
    ))).toEqual({ table: 'experience_held_decisions', column: 'part_kind', values: ['locations', 'treasures'] });
  });

  it.each([
    ['a range', 'CHECK (((rating >= 1) AND (rating <= 5)))'],
    ['a presence rule', 'CHECK ((not_available OR (geom IS NOT NULL)))'],
    ['a rule over several columns', "CHECK (((((scope_type)::text = 'global'::text) AND (region_id IS NULL)) OR "
      + "(((scope_type)::text = 'region'::text) AND (region_id IS NOT NULL))))"],
    ['a list guarded by another column', "CHECK (((kind IS NULL) OR ((part_kind)::text = ANY ((ARRAY['a'::character varying])::text[]))))"],
  ])('passes over %s', (_what, definition) => {
    expect(parseValueList(check('t', definition))).toBeNull();
  });
});

describe('the generated file', () => {
  const columns: CatalogColumn[] = [
    column({ table: 'users', column: 'id', formatted: 'integer', udtName: 'int4' }),
    column({ table: 'users', column: 'role', formatted: 'user_role', udtName: 'user_role', typtype: 'e' }),
    column({ table: 'users', column: 'email', formatted: 'character varying(255)', udtName: 'varchar', notNull: false }),
    column({ table: 'experience_sync_changes', column: 'change_type', formatted: 'character varying(20)', udtName: 'varchar' }),
    column({ table: 'region_render_geom', relkind: 'v', column: 'geom', formatted: 'geometry', udtName: 'geometry' }),
  ];
  const enumRows = [{ name: 'user_role', values: ['user', 'curator', 'admin'] }];
  const checks = [
    { table: 'experience_sync_changes', name: 'experience_sync_changes_change_type_check',
      definition: "CHECK (((change_type)::text = ANY ((ARRAY['created'::character varying, 'updated'::character varying])::text[])))" },
    { table: 'users', name: 'users_rating_check', definition: 'CHECK ((rating >= 1))' },
  ];
  const rendered = renderSchemaTypes(columns, enumRows, checks);

  it('names things the way a reader expects', () => {
    expect(pascalCase('experience_kind_memberships')).toBe('ExperienceKindMemberships');
    expect(rowTypeName('users')).toBe('UsersRow');
  });

  it('declares the enum and every relation as an interface, relations sorted by name', () => {
    expect(rendered).toContain("export type UserRole = \"user\" | \"curator\" | \"admin\";");
    expect(rendered).toContain('export interface UsersRow {\n  id: number;\n  role: UserRole;\n  email: string | null;\n}');
    expect(rendered).toContain('export interface RegionRenderGeomRow {\n  geom: string | null;\n}');
    const order = ['ExperienceSyncChangesRow', 'RegionRenderGeomRow', 'UsersRow'].map((name) => rendered.indexOf(`interface ${name}`));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('carries the widths and the value lists as constants', () => {
    expect(rendered).toContain('export const COLUMN_WIDTHS = {\n  experience_sync_changes: {\n    change_type: 20,\n  },\n  users: {\n    email: 255,\n  },\n} as const;');
    expect(rendered).toContain('export const CHECK_VALUES = {\n  experience_sync_changes: {\n    change_type: ["created", "updated"],\n  },\n} as const;');
  });

  it('is deterministic: the same catalog in another order renders the same text', () => {
    const shuffled = renderSchemaTypes([...columns].reverse().sort((a, b) => a.column.localeCompare(b.column)), enumRows, [...checks].reverse());
    // Column order within a relation is the catalog's (attnum), so only the
    // relations' and constraints' order is free to differ.
    expect(renderSchemaTypes(columns, enumRows, [...checks].reverse())).toBe(rendered);
    expect(shuffled.split('export const COLUMN_WIDTHS')[1]).toBe(rendered.split('export const COLUMN_WIDTHS')[1]);
  });
});
