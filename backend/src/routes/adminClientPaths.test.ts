/**
 * Every call the admin client makes reaches a route the admin router registers.
 *
 * The client builds its paths by hand in `frontend/src/api/admin/`, and nothing
 * else ties them to the routes: a drifted path answers a 404 only when
 * somebody presses its button (#945). So this reads every `/api/admin/…`
 * path the client modules spell, with the method its call uses, and asks
 * whether that method and path would match a declared route (ADR-0071).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { repoFile } from '../testSupport/repoFile.js';
import { adminDeclaredRoutes } from './adminDeclaredRoutes.js';

interface ClientCall {
  module: string;
  fn: string;
  method: string;
  path: string;
}

/** A route's `:param` segment takes any one segment of the call; every other must be the same. */
function routeTakes(route: { segments: string[] }, path: string): boolean {
  const segments = path.split('/');
  return segments.length === route.segments.length
    && route.segments.every((segment, i) => segment.startsWith(':') || segment === segments[i]);
}

/**
 * The calls a client module makes: each exported function's `/api/admin/…`
 * paths, with a `${…}` that is a whole segment read as one path parameter and
 * one glued to a segment (a query string) dropped with what follows, and the method its
 * options name, GET where they name none.
 */
function callsOf(module: string, source: string): ClientCall[] {
  const calls: ClientCall[] = [];
  const functions = source.split(/\nexport (?:async )?function /).slice(1);
  for (const body of functions) {
    const fn = body.slice(0, body.indexOf('('));
    const method = /method:\s*'(\w+)'/.exec(body)?.[1] ?? 'GET';
    for (const match of body.matchAll(/`\$\{API_URL\}\/api\/admin(\/[^`?]*)/g)) {
      const path = match[1]
        .replace(/([^/])\$\{.*$/, '$1')
        .replace(/\$\{[^}]*\}/g, ':param');
      calls.push({ module, fn, method: method.toUpperCase(), path });
    }
  }
  return calls;
}

const clientDir = repoFile('frontend', 'src', 'api', 'admin');
const calls = readdirSync(clientDir)
  .filter(file => file.endsWith('.ts') && !file.endsWith('.test.ts'))
  .flatMap(file => callsOf(file, readFileSync(`${clientDir}/${file}`, 'utf8')));
const routes = adminDeclaredRoutes.map(route => ({ method: route.method.toUpperCase(), segments: route.path.split('/') }));

describe('the admin client and the admin routes', () => {
  it('reads the client\'s calls and the routes at all', () => {
    // A reader that found nothing would pass the check below vacuously. The
    // calls read here are the world-view import's, still built by hand until
    // #1107; every other admin module calls the generated client, whose paths
    // the compiler holds to the document.
    expect(calls.length).toBeGreaterThan(60);
    expect(routes.length).toBeGreaterThan(100);
    expect(calls).toContainEqual({
      module: 'wvImportCoverage.ts', fn: 'splitDivisionsDeeper', method: 'POST',
      path: '/wv-import/matches/:param/split-deeper',
    });
  });

  it('reaches a registered route with every call', () => {
    const unrouted = calls.filter(call => !routes.some(route =>
      route.method === call.method && routeTakes(route, call.path.replace(/:param/g, '1'))));
    expect(unrouted.map(call => `${call.module} ${call.fn}: ${call.method} ${call.path}`)).toEqual([]);
  });
});
