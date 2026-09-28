/**
 * An export's name is a component's name in the OpenAPI document, and so a
 * type's name on every generated client: a clash or a stray export is refused
 * rather than resolved quietly.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import { responseSchemasOf } from './responseModules.js';

describe('which exports become types', () => {
  const Point = z.strictObject({ id: z.number() });

  it('takes every exported schema under its export name, module by module', () => {
    const Place = z.strictObject({ points: z.array(Point) });
    expect(responseSchemasOf([['a.ts', { Point }], ['b.ts', { Place }]]).map(([name]) => name))
      .toEqual(['Point', 'Place']);
  });

  it('refuses an export that is not a schema', () => {
    expect(() => responseSchemasOf([['a.ts', { Point, LIMIT: 5 }]]))
      .toThrow('responses/a.ts exports LIMIT, which is not a Zod schema');
  });

  it('refuses one name exported by two modules', () => {
    expect(() => responseSchemasOf([['a.ts', { Point }], ['b.ts', { Point: z.strictObject({}) }]]))
      .toThrow('Point is exported by both responses/a.ts and responses/b.ts');
  });

  it('refuses one schema exported under two names, which would leave one of them untyped', () => {
    expect(() => responseSchemasOf([['a.ts', { Point, Spot: Point }]]))
      .toThrow('responses/a.ts exports one schema as both Point and Spot');
  });
});
