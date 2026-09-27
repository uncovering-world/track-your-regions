/**
 * Every route under `/api/admin` is the admin's.
 *
 * The mount in `routes/index.ts` puts no guard in front of the router: each
 * declaration establishes its caller itself (ADR-0071). So what keeps a route
 * added here as `signed-in` or `curator` from shipping under the admin prefix
 * is this spec, not the mount.
 */

import { describe, expect, it } from 'vitest';
import { adminDeclaredRoutes } from './adminDeclaredRoutes.js';

describe('the admin routes', () => {
  it('are all declared admin', () => {
    expect(adminDeclaredRoutes.length).toBeGreaterThan(100);
    const others = adminDeclaredRoutes
      .filter(route => route.access !== 'admin')
      .map(route => `${route.method.toUpperCase()} ${route.path}: ${route.access}`);
    expect(others).toEqual([]);
  });
});
