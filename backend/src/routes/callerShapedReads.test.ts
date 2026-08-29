import { describe, it, expect, vi } from 'vitest';
import type { Router } from 'express';

vi.mock('../db/index.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
  db: {},
  rollbackQuietly: vi.fn(),
}));

import experienceRouter from './experienceRoutes.js';
import worldViewRouter from './worldViewRoutes.js';

/**
 * The reads whose answer depends on who asks, and the one middleware that says
 * so in the headers.
 *
 * `optionalAuth` marks every response it shapes `Cache-Control: private,
 * no-cache` + `Vary: Authorization` (`middleware/auth.test.ts` holds that).
 * What this file holds is the other half of #597's claim — that each read
 * whose body varies by caller actually carries the middleware, so the rule
 * reaches it. It walks the routers Express built rather than the source: a
 * route's chain is what runs, and a regex over the file would pass on a
 * commented-out line.
 *
 * Two shapes of caller-shaped read exist:
 *
 * - the reads `docs/security/SECURITY.md` names, whose handlers read
 *   `req.user` themselves — curator rejection visibility, a curator's whole
 *   `regions[]`, a reader's own `is_new`, a gated museum's unread treasures;
 * - every read behind `requireVisibleWorldView`, where an admin gets 200 for
 *   a hidden world view and everyone else 404. The guard needs `req.user`, so
 *   `optionalAuth` must run *before* it — order is asserted, not just presence.
 */

interface Layer {
  handle: { name: string };
  route?: { path: string; methods: Record<string, boolean>; stack: Layer[] };
}

interface RouteChain {
  method: string;
  path: string;
  chain: string[];
}

function routesOf(router: Router): RouteChain[] {
  return (router.stack as unknown as Layer[])
    .filter((layer) => layer.route)
    .map((layer) => ({
      method: Object.keys(layer.route!.methods).join(','),
      path: layer.route!.path,
      chain: layer.route!.stack.map((l) => l.handle.name),
    }));
}

const NAMED_READS: Array<[Router, string, string]> = [
  [experienceRouter, 'get', '/'],
  [experienceRouter, 'get', '/by-region/:regionId'],
  [experienceRouter, 'get', '/by-region/:regionId/locations'],
  [experienceRouter, 'get', '/region-counts'],
  [experienceRouter, 'get', '/:id'],
  [experienceRouter, 'get', '/:id/locations'],
  [experienceRouter, 'get', '/:id/treasures'],
  [worldViewRouter, 'get', '/'],
];

describe('every caller-shaped read carries optionalAuth', () => {
  it.each(NAMED_READS.map(([router, method, path]) => [method, path, router]))(
    '%s %s',
    (method, path, router) => {
      const route = routesOf(router as Router).find((r) => r.method === method && r.path === path);
      expect(route, `${method} ${path} is not a route any more`).toBeDefined();
      expect(route!.chain).toContain('optionalAuth');
    },
  );

  it('runs optionalAuth before every world view visibility guard', () => {
    // `requireVisibleWorldView` returns a function named `visibilityGuard`;
    // the name is what Express keeps of it.
    const guarded = [...routesOf(experienceRouter), ...routesOf(worldViewRouter)]
      .filter((r) => r.chain.includes('visibilityGuard'));
    expect(guarded.length).toBeGreaterThan(0);

    for (const r of guarded) {
      const auth = r.chain.indexOf('optionalAuth');
      const guard = r.chain.indexOf('visibilityGuard');
      expect(auth, `${r.method} ${r.path} has no optionalAuth ahead of its guard: ${r.chain.join(' > ')}`)
        .toBeGreaterThanOrEqual(0);
      expect(auth).toBeLessThan(guard);
    }
  });
});
