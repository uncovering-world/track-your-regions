/**
 * Guards the gap that made a whole feature dead in the running app.
 *
 * `validate()` replaces `req[source]` with the parsed object, and a Zod object
 * strips what it does not name. A parameter the controller reads but the schema
 * omits therefore never arrives — while every test that calls the controller
 * directly keeps passing, because those hand it a query object the middleware
 * never touched.
 *
 * So the assertion has to be made here, on the schema, not there.
 */

import { describe, it, expect } from 'vitest';
import {
  experiencesByRegionQuerySchema,
  regionLocationsQuerySchema,
  experienceListQuerySchema,
} from './index.js';

const readsIncludeLost = [
  ['a region list', experiencesByRegionQuerySchema],
  ['its location batch', regionLocationsQuerySchema],
  ['the flat list', experienceListQuerySchema],
] as const;

describe('includeLost survives validation', () => {
  for (const [name, schema] of readsIncludeLost) {
    it(`reaches ${name}`, () => {
      const parsed = schema.parse({ includeLost: 'true' });

      expect(parsed).toHaveProperty('includeLost', 'true');
    });

    it(`defaults to off for ${name}`, () => {
      // The safe direction: a caller that says nothing gets fewer rows, never
      // a demolished building offered as somewhere to go.
      expect(schema.parse({})).toHaveProperty('includeLost', 'false');
    });
  }

  it('refuses anything that is not the ask', () => {
    // A permissive coercion here would put lost objects back on the map for a
    // stray `?includeLost=0`.
    expect(() => experiencesByRegionQuerySchema.parse({ includeLost: 'yes' })).toThrow();
    expect(() => experiencesByRegionQuerySchema.parse({ includeLost: '1' })).toThrow();
  });
});
