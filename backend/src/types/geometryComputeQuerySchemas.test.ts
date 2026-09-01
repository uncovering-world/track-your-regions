/**
 * Whether a geometry writer can be told not to snap, asked of the schemas
 * rather than of the handlers.
 *
 * `validate()` replaces `req[source]` with the parsed object and a Zod object
 * strips what it does not name, so a parameter the schema omits never reaches
 * the controller — and an endpoint with no query schema at all supplies no
 * default, which is how an absent `skipSnapping` came to mean *snap* on the
 * bulk writer while both UI callers passed "skip" explicitly (#736).
 *
 * The three writers of `regions.geom` disagreed about this. The stream honoured
 * the parameter; the bulk endpoint read it off an unvalidated query; and
 * `POST /geometry/compute` took none at all, so the same region ended up with a
 * different outline depending on which caller asked. They read one parameter
 * with one default now, and the default is the behaviour every one of them
 * already had: absent means snap.
 */

import { describe, it, expect } from 'vitest';
import { computeGeometryQuerySchema, computeSSEQuerySchema } from './index.js';

/**
 * The schema each writer mounts. Two of the three mount the same object — the
 * single-region endpoint and the bulk one — and the stream extends it with the
 * token `EventSource` cannot send as a header. Listed by endpoint rather than
 * by object, because what the rows are about is what reaches each endpoint.
 */
const writersThatSnap = [
  ['the compute endpoint', computeGeometryQuerySchema],
  ['the bulk endpoint', computeGeometryQuerySchema],
  ['the progress stream', computeSSEQuerySchema],
] as const;

describe('skipSnapping survives validation on every writer that snaps', () => {
  for (const [name, schema] of writersThatSnap) {
    it(`reaches ${name}`, () => {
      expect(schema.parse({ skipSnapping: 'true' })).toHaveProperty('skipSnapping', 'true');
    });

    it(`means snap when ${name} is asked without it`, () => {
      // The behaviour all three already had, kept: a caller that says nothing
      // gets the borders cleaned, not a faster run it never asked for.
      expect(schema.parse({})).toHaveProperty('skipSnapping', 'false');
    });

    it(`refuses what is not the ask on ${name}`, () => {
      // A coercion here would read a stray value as "skip" and silently hand
      // back a region whose child borders were never aligned.
      expect(() => schema.parse({ skipSnapping: '1' })).toThrow();
      expect(() => schema.parse({ skipSnapping: 'yes' })).toThrow();
    });
  }

  it('answers the stream and the two endpoints identically, token aside', () => {
    // The claim is one rule, not three that happen to agree today: a default
    // changed on one schema and forgotten on another is the shape #736 was
    // about, and the stream extends the shared object rather than restating it.
    // `token` is optional with no default, so an empty query leaves it off
    // entirely and the two answers are comparable as they stand.
    expect(computeSSEQuerySchema.parse({})).toEqual(computeGeometryQuerySchema.parse({}));
    expect(computeSSEQuerySchema.parse({ skipSnapping: 'true', force: 'true' }))
      .toMatchObject(computeGeometryQuerySchema.parse({ skipSnapping: 'true', force: 'true' }));
  });
});
