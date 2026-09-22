/**
 * The committed `@tyr/shared/api` is what the response schemas render to
 * (ADR-0066).
 *
 * The web's types are generated from the schemas in `responses/`, so a schema
 * changed without regenerating leaves the frontend typed against an answer the
 * backend no longer sends. This spec is where that fails: it renders exactly as
 * `npm --prefix backend run api:types` does and compares the whole text with
 * the committed file, the way `scripts/gates.test.mjs` holds `docs/tech/gates.md`
 * to the tables it embeds. No Docker is involved, unlike `db:types`, so a spec in
 * the unit lane is the whole of the check.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import { repoFile } from '../testSupport/repoFile.js';
import { renderResponseTypes, responseSchemasOf } from './generateApiTypes.js';

describe("the web's response types", () => {
  it('are what the response schemas render to', async () => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- a fixed repository path, through repoFile()
    const committed = readFileSync(repoFile('packages', 'shared', 'src', 'api.generated.ts'), 'utf8');
    expect(
      committed,
      'packages/shared/src/api.generated.ts is not what the schemas render to: run `npm --prefix backend run api:types` and commit the result',
    ).toBe(await renderResponseTypes());
  });
});

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
