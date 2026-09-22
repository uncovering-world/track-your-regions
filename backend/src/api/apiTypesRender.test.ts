import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import { REF_PREFIX, renderApiTypes, type JsonSchema } from './apiTypesRender.js';

/** The declarations alone, without the header every render starts with. */
function body(schemas: Record<string, JsonSchema>): string {
  const text = renderApiTypes(schemas);
  return text.slice(text.indexOf('*/\n') + 3).trim();
}

const strict = (properties: Record<string, JsonSchema>, required = Object.keys(properties)): JsonSchema => ({
  type: 'object', properties, required, additionalProperties: false,
});

describe('renderApiTypes', () => {
  it('renders an object as an interface, with its descriptions as JSDoc', () => {
    expect(body({
      Point: {
        ...strict({
          id: { type: 'integer', minimum: -9007199254740991, maximum: 9007199254740991 },
          name: { description: 'As the source names it.', anyOf: [{ type: 'string' }, { type: 'null' }] },
          note: { type: 'string' },
        }, ['id', 'name']),
        description: 'One point of a place.',
      },
    })).toBe([
      '/** One point of a place. */',
      'export interface Point {',
      '  id: number;',
      '  /** As the source names it. */',
      '  name: string | null;',
      '  note?: string;',
      '}',
    ].join('\n'));
  });

  it('renders vocabularies, literals, arrays, records and nested objects', () => {
    expect(body({
      Kind: { type: 'string', enum: ['locations', 'treasures'] },
      Row: strict({
        kind: { $ref: `${REF_PREFIX}Kind` },
        failed: { type: 'boolean', const: true },
        at: { anyOf: [{ type: 'string', format: 'date-time', pattern: '^x$' }, { type: 'null' }] },
        tags: { type: 'array', items: { type: 'string' } },
        maybe: { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'null' }] } },
        byId: { type: 'object', propertyNames: { type: 'string' }, additionalProperties: { type: 'array', items: { $ref: `${REF_PREFIX}Kind` } } },
        anything: {},
        where: { type: 'array', items: strict({ id: { anyOf: [{ type: 'integer' }, { type: 'null' }] } }) },
      }),
    })).toBe([
      'export type Kind = "locations" | "treasures";',
      '',
      'export interface Row {',
      '  kind: Kind;',
      '  failed: true;',
      '  at: string | null;',
      '  tags: string[];',
      '  maybe: (string | null)[];',
      '  byId: Record<string, Kind[]>;',
      '  anything: unknown;',
      '  where: {',
      '    id: number | null;',
      '  }[];',
      '}',
    ].join('\n'));
  });

  it('sorts the declarations by name, so two runs over the same schemas are identical', () => {
    const schemas = { Zeta: strict({ z: { type: 'string' } }), Alpha: strict({ a: { type: 'string' } }) };
    const text = renderApiTypes(schemas);
    expect(text.indexOf('interface Alpha')).toBeLessThan(text.indexOf('interface Zeta'));
    expect(renderApiTypes(schemas)).toBe(text);
  });

  it('renders an object with no keys as a type, since an interface cannot be Record<string, never>', () => {
    expect(body({ Nothing: strict({}) })).toBe('export type Nothing = Record<string, never>;');
  });

  it('renders text TypeScript parses, whatever mix of constructs it is given', () => {
    const text = renderApiTypes({
      Empty: strict({}),
      Kind: { type: 'string', enum: ['locations', 'treasures'] },
      Row: {
        ...strict({
          kind: { $ref: `${REF_PREFIX}Kind` },
          note: { type: 'string', description: 'A */ inside, and a long enough sentence to wrap. '.repeat(4) },
          nested: strict({ empty: strict({}), id: { anyOf: [{ type: 'integer' }, { type: 'null' }] } }),
          byId: { type: 'object', propertyNames: { type: 'string' }, additionalProperties: { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'null' }] } } },
        }, ['kind']),
        description: 'One row.',
      },
    });
    const { diagnostics } = ts.transpileModule(text, { reportDiagnostics: true, compilerOptions: { module: ts.ModuleKind.ESNext } });
    expect(diagnostics?.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')) ?? []).toEqual([]);
  });

  it('keeps a description from closing its comment early', () => {
    expect(body({ Row: strict({ glob: { type: 'string', description: 'Matches src/*/ and nothing */ else.' } }) }))
      .toContain('/** Matches src/*\\/ and nothing *\\/ else. */');
  });

  it('wraps a long description at word boundaries within the comment width', () => {
    const words = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
    const rendered = body({ Row: strict({ note: { type: 'string', description: words } }) });
    const commentLines = rendered.split('\n').filter((line) => line.trimStart().startsWith('*'));
    expect(commentLines.length).toBeGreaterThan(2);
    for (const line of commentLines) expect(line.length).toBeLessThanOrEqual(100);
    expect(commentLines.map((line) => line.replace(/^\s*\*\/?\s?/, '')).join(' ').trim()).toBe(words);
  });

  it('says it is generated and names the command that regenerates it', () => {
    const text = renderApiTypes({ Row: strict({ id: { type: 'integer' } }) });
    expect(text).toMatch(/^\/\*\*\n \* GENERATED by backend\/src\/api\/generateApiTypes\.ts/);
    expect(text).toContain('npm --prefix backend run api:types');
  });

  describe('refuses what it would otherwise have to guess', () => {
    const refusals: Array<[string, Record<string, JsonSchema>, RegExp]> = [
      ['an object that admits undeclared keys', { Row: { type: 'object', properties: { a: { type: 'string' } } } }, /a response object is a `z\.strictObject`/],
      ['a keyword it does not read', { Row: strict({ a: { allOf: [{ type: 'string' }] } }) }, /uses `allOf`/],
      ['a default, which would make a key optional on the wire', { Row: strict({ a: { type: 'string', default: 'x' } }) }, /uses `default`/],
      ['a named bare primitive', { Stamp: { type: 'string', format: 'date-time' } }, /is a bare string/],
      ['a key that is not an identifier', { Row: strict({ 'not-a-name': { type: 'string' } }) }, /Row\.not-a-name is not an identifier/],
      ['a reference to a schema nobody exported', { Row: strict({ a: { $ref: `${REF_PREFIX}Missing` } }) }, /which no exported schema is/],
      ['an array without an items schema', { Row: strict({ a: { type: 'array' } }) }, /without one `items` schema/],
      ['a record whose keys are restricted', { Row: strict({ a: { type: 'object', propertyNames: { enum: ['x'] }, additionalProperties: { type: 'string' } } }) }, /restricts its keys/],
      ['a literal that is not a scalar', { Row: strict({ a: { const: { x: 1 } } }) }, /not a JSON scalar/],
    ];
    it.each(refusals)('%s', (_label, schemas, message) => {
      expect(() => renderApiTypes(schemas)).toThrow(message);
    });
  });

  describe('on what Zod 4 actually emits', () => {
    function viaZod(entries: Record<string, z.ZodType>): Record<string, JsonSchema> {
      const registry = z.registry<{ id: string }>();
      for (const [id, schema] of Object.entries(entries)) registry.add(schema, { id });
      return z.toJSONSchema(registry, { io: 'input', uri: (id) => `${REF_PREFIX}${id}` }).schemas as Record<string, JsonSchema>;
    }

    it('renders a strict object, a nullable timestamp and a reference', () => {
      const Kind = z.enum(['locations', 'treasures']);
      const Part = z.strictObject({ kind: Kind, at: z.iso.datetime({ offset: true }).nullable(), gone: z.literal(true).optional() });
      expect(body(viaZod({ Kind, Part }))).toBe([
        'export type Kind = "locations" | "treasures";',
        '',
        'export interface Part {',
        '  kind: Kind;',
        '  at: string | null;',
        '  gone?: true;',
        '}',
      ].join('\n'));
    });

    it('refuses a plain z.object, whose parse would strip an undeclared key and pass', () => {
      expect(() => renderApiTypes(viaZod({ Loose: z.object({ a: z.string() }) })))
        .toThrow(/Loose admits keys it does not declare/);
    });
  });
});
