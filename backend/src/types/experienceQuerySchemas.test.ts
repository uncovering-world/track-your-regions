/**
 * Guards the gap that made a whole feature dead in the running app.
 *
 * A handler receives the object its route's schema parsed, and a Zod object
 * strips what it does not name. A parameter the controller reads but the schema
 * omits therefore never arrives — while every test that calls the controller
 * directly keeps passing, because those hand it a query object no schema
 * touched.
 *
 * So the assertion has to be made here, on the schema, not there.
 */

import { describe, it, expect } from 'vitest';
import {
  experiencesByRegionQuerySchema,
  regionLocationsQuerySchema,
  reviewQueueQuerySchema,
} from './index.js';

const readsIncludeLost = [
  ['a region list', experiencesByRegionQuerySchema],
  ['its location batch', regionLocationsQuerySchema],
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

describe('the review queue filters by every kind it names', () => {
  // A kind word with a hyphen failed the shape, so the chip that names a
  // site's candidate component items (#1272) answered 400 and the page showed
  // nothing at all (#1367).
  it('accepts a hyphenated kind word, alone and in a list', () => {
    expect(reviewQueueQuerySchema.parse({ kind: 'component-items' }).kind).toBe('component-items');
    expect(reviewQueueQuerySchema.parse({ kind: 'refused,pin-question' }).kind).toBe('refused,pin-question');
  });

  it('refuses what is no word list', () => {
    expect(() => reviewQueueQuerySchema.parse({ kind: 'pin--question' })).toThrow();
    expect(() => reviewQueueQuerySchema.parse({ kind: 'refused,' })).toThrow();
  });
});

describe('search text holds no NUL byte', () => {
  // Postgres holds no NUL in text, so a search for one is refused by the
  // schema, and the OpenAPI document never promises to accept it.
  it('refuses one in the queue search, as the schema rather than the database', () => {
    expect(() => reviewQueueQuerySchema.parse({ q: 'Villa\u0000Farnesina' })).toThrow(/NUL byte/);
    expect(reviewQueueQuerySchema.parse({ q: ' Villa Farnesina ' }).q).toBe('Villa Farnesina');
  });
});
