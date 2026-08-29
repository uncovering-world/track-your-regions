import { describe, it, expect, vi } from 'vitest';
import { Router } from 'express';

vi.mock('../db/index.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
  db: {},
  rollbackQuietly: vi.fn(),
}));

import experienceRouter from './experienceRoutes.js';
import worldViewRouter from './worldViewRoutes.js';
import userRouter from './userRoutes.js';

/**
 * The reads whose answer depends on who asks, and the two middlewares that say
 * so in the headers.
 *
 * `optionalAuth` marks every response it shapes `Cache-Control: private,
 * no-cache` + `Vary: Authorization`; `requireAuth` marks every response it
 * fronts `private, no-store` (`middleware/auth.test.ts` holds both). What this
 * file holds is the other half of the claim — that each read the rule is for
 * actually carries the middleware, so the rule reaches it. It walks the
 * routers Express built rather than the source: a route's chain is what runs,
 * and a regex over the file would pass on a commented-out line.
 *
 * Two shapes of caller-shaped read exist (#597):
 *
 * - the reads `docs/security/SECURITY.md` names, whose handlers read
 *   `req.user` themselves — curator rejection visibility, a curator's whole
 *   `regions[]`, a reader's own `is_new`, a gated museum's unread treasures;
 * - every read behind `requireVisibleWorldView`, where an admin gets 200 for
 *   a hidden world view and everyone else 404. The guard needs `req.user`, so
 *   `optionalAuth` must run *before* it — order is asserted, not just presence.
 *
 * And one shape of read of the caller's own data (#710): everything under
 * `/api/users/me` — a traveller's visited regions, experiences, locations and
 * viewed works, and the profile with its email — which V14.2.1 classifies as
 * sensitive, and which `no-store` keeps out of the browser's disk cache after
 * sign-out. The named reads are the ones the issue measured; the blanket
 * assertion is what holds a route added tomorrow.
 */

interface Layer {
  handle: { name: string; stack?: unknown[] };
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

/**
 * The layers a mounted router leaves on its parent's stack. `routesOf` cannot
 * see past them — Express builds no route layer for `router.use(path, sub)` —
 * so a sub-router is the one way a read reaches the user router without the
 * walk below noticing. A router carries a stack of its own; the plain
 * middleware on that stack (the rate limiter) does not, which is what tells
 * the two apart without depending on a function's name.
 */
function mountedRoutersOf(router: Router): Layer[] {
  return (router.stack as unknown as Layer[]).filter(
    (layer) => !layer.route && Array.isArray(layer.handle.stack),
  );
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

const OWN_DATA_READS: Array<[string, string]> = [
  ['get', '/me'],
  ['get', '/me/visited-regions'],
  ['get', '/me/visited-regions/by-world-view/:worldViewId'],
  ['get', '/me/visited-experiences'],
  ['get', '/me/visited-experiences/ids'],
  ['get', '/me/visited-locations/ids'],
  ['get', '/me/experiences/:id/visited-status'],
  ['get', '/me/viewed-treasures/ids'],
];

describe('every read of the caller\'s own data carries requireAuth', () => {
  it.each(OWN_DATA_READS)('%s %s', (method, path) => {
    const route = routesOf(userRouter).find((r) => r.method === method && r.path === path);
    expect(route, `${method} ${path} is not a route any more`).toBeDefined();
    expect(route!.chain).toContain('requireAuth');
  });

  it('and so does every other route on the user router', () => {
    // Nothing under /api/users/me is anyone's but the caller's; a route added
    // there without the middleware would answer with Express's defaults.
    const routes = routesOf(userRouter);
    expect(routes.length).toBeGreaterThanOrEqual(OWN_DATA_READS.length);

    for (const r of routes) {
      expect(r.chain, `${r.method} ${r.path} carries no requireAuth: ${r.chain.join(' > ')}`)
        .toContain('requireAuth');
    }
  });

  it('and nothing reaches the router by a path the walk cannot see', () => {
    // The blanket assertion above is only as wide as `routesOf`, which keeps
    // route layers alone. A sub-router mounted at a path would contribute
    // none, and the loop would pass over its reads in silence rather than
    // hold them to the rule.
    const mounted = mountedRoutersOf(userRouter).length;
    expect(mounted, 'a sub-router is mounted on the user router: recurse into it, or the assertion above is blind to its routes')
      .toBe(0);
  });

  it('and the check that says so can actually see one', () => {
    // Run the negative case, since the assertion above passes either way on
    // a router that has none: plain middleware must stay invisible, a
    // mounted router must not.
    const probe = Router();
    probe.use((_req, _res, next) => next());
    probe.get('/x', (_req, res) => res.end());
    expect(mountedRoutersOf(probe)).toHaveLength(0);

    probe.use('/sub', Router());
    expect(mountedRoutersOf(probe)).toHaveLength(1);
  });
});
