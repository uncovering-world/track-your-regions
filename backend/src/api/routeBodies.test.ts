/**
 * A number in a JSON body arrives as a number, so no route's body coerces one.
 *
 * Path and query values arrive as text and are coerced on purpose
 * (`rowIdSchema`); a body's are already typed by JSON, and a `z.coerce.number()`
 * there would take `"7"`, `true` or `""` as a number while the OpenAPI document
 * promises an integer. `bodyRowIdSchema` is the body's id (`types/rowId.ts`).
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';

/** Every coercing number or boolean under a schema, by the path that reaches it. */
function coercedUnder(schema: unknown, path: string, depth = 0): string[] {
  const def = (schema as { _zod?: { def?: Record<string, unknown> } } | undefined)?._zod?.def;
  if (!def || depth > 16) return [];
  const found: string[] = [];
  if ((def.type === 'number' || def.type === 'boolean') && def.coerce) found.push(path);
  if (def.type === 'object') {
    for (const [key, field] of Object.entries(def.shape as Record<string, unknown>)) {
      found.push(...coercedUnder(field, `${path}.${key}`, depth + 1));
    }
  }
  for (const key of ['innerType', 'element', 'in', 'out', 'left', 'right', 'keyType', 'valueType']) {
    if (def[key]) found.push(...coercedUnder(def[key], `${path}/${key}`, depth + 1));
  }
  // A recursive body (`importTreeNodeSchema`) is a z.lazy; the depth cap ends its walk.
  if (def.type === 'lazy') found.push(...coercedUnder((def.getter as () => unknown)(), `${path}/lazy`, depth + 1));
  for (const key of ['options', 'items']) {
    (def[key] as unknown[] | undefined)?.forEach((option, i) => {
      found.push(...coercedUnder(option, `${path}[${i}]`, depth + 1));
    });
  }
  return found;
}

describe('route bodies', () => {
  it('coerce no number and no boolean', async () => {
    const { MOUNTS } = await import('../routes/mounts.js');
    const coerced = MOUNTS.flatMap(({ prefix, routes }) => routes.flatMap((route) => (
      route.body ? coercedUnder(route.body, `${route.method.toUpperCase()} ${prefix}${route.path}`) : []
    )));
    expect(coerced, 'a JSON body field is z.coerce: use z.number() (bodyRowIdSchema for an id)').toEqual([]);
  }, 30000);

  it('are walked through wrappers, arrays, tuples, records, unions and lazy schemas', () => {
    const coercing = z.coerce.number();
    const body = z.union([
      z.object({ ids: z.array(coercing).optional() }),
      z.object({ pair: z.tuple([z.number(), coercing]), byKey: z.record(z.string(), coercing).nullable() }),
      z.lazy(() => z.object({ depth: coercing })),
    ]);
    expect(coercedUnder(body, 'body')).toEqual([
      'body[0].ids/innerType/element',
      'body[1].pair[1]',
      'body[1].byKey/innerType/valueType',
      'body[2]/lazy.depth',
    ]);
  });
});
