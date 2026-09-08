/**
 * The fame line an admin sets on a source's row.
 *
 * Two numbers rather than one, bounding the same shape the run's own reader
 * enforces (`backend/src/services/sync/sourceLine.ts`): integers 1..1000,
 * `staySitelinks` no higher than `enterSitelinks`. The two are separate
 * validators of one rule, so the bound is worth pinning on both sides.
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
});
