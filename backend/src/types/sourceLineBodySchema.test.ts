/**
 * The fame line an admin sets on a source's row.
 *
 * Two numbers rather than one, bounding the same shape the run's own reader
 * enforces (`backend/src/services/sync/sourceLine.ts`): integers 1..1000,
 * `staySitelinks` no higher than `enterSitelinks`. The two are separate
 * validators of one rule, so the bound is worth pinning on both sides.
 *
 * A source whose finds are thinner than its places may state a second pair
 * under the `find…` keys (ADR-0058 decision 5), bounded the same way and taken
 * whole or not at all — the same reading `parseSourceLine` gives the stored row.
 */

import { describe, it, expect } from 'vitest';
import { sourceLineBodySchema } from './index.js';

const parse = (body: unknown) => sourceLineBodySchema.safeParse(body);

describe('sourceLineBodySchema', () => {
  it('takes an enter/stay pair with the stay line at or below the enter line', () => {
    expect(parse({ enterSitelinks: 22, staySitelinks: 18 }).success).toBe(true);
    expect(parse({ enterSitelinks: 22, staySitelinks: 22 }).success).toBe(true);
  });

  it('refuses a stay line above the enter line', () => {
    expect(parse({ enterSitelinks: 18, staySitelinks: 22 }).success).toBe(false);
  });

  it('refuses a non-integer count', () => {
    expect(parse({ enterSitelinks: 22.5, staySitelinks: 18 }).success).toBe(false);
  });

  it('refuses a count outside 1..1000', () => {
    expect(parse({ enterSitelinks: 0, staySitelinks: 0 }).success).toBe(false);
    expect(parse({ enterSitelinks: 1001, staySitelinks: 18 }).success).toBe(false);
  });

  it('refuses a request missing either number', () => {
    expect(parse({ enterSitelinks: 22 }).success).toBe(false);
    expect(parse({ staySitelinks: 18 }).success).toBe(false);
    expect(parse({}).success).toBe(false);
  });

  it('takes the finds pair a second-door source may state', () => {
    expect(parse({
      enterSitelinks: 22, staySitelinks: 18, findEnterSitelinks: 18, findStaySitelinks: 15,
    }).success).toBe(true);
  });

  it('refuses half a finds pair, and a finds stay line above its enter line', () => {
    expect(parse({ enterSitelinks: 22, staySitelinks: 18, findEnterSitelinks: 18 }).success).toBe(false);
    expect(parse({ enterSitelinks: 22, staySitelinks: 18, findStaySitelinks: 15 }).success).toBe(false);
    expect(parse({
      enterSitelinks: 22, staySitelinks: 18, findEnterSitelinks: 15, findStaySitelinks: 18,
    }).success).toBe(false);
  });

  it('bounds the finds counts the way it bounds the places', () => {
    expect(parse({
      enterSitelinks: 22, staySitelinks: 18, findEnterSitelinks: 0, findStaySitelinks: 0,
    }).success).toBe(false);
    expect(parse({
      enterSitelinks: 22, staySitelinks: 18, findEnterSitelinks: 1001, findStaySitelinks: 15,
    }).success).toBe(false);
    expect(parse({
      enterSitelinks: 22, staySitelinks: 18, findEnterSitelinks: 18, findStaySitelinks: 15.5,
    }).success).toBe(false);
  });
});
