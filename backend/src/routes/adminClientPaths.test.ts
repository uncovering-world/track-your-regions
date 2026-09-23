/**
 * Every call the admin client makes reaches a route the admin router registers.
 *
 * The client builds its paths by hand in `frontend/src/api/admin/`, and nothing
 * else ties them to `adminRoutes.ts`: a drifted path answers a 404 only when
 * somebody presses its button (#945). So this reads every `/api/admin/…`
 * path the client modules spell, with the method its call uses, and asks
 * whether that method and path would match a route `adminRoutes.ts` registers.
 *
 * A guard that reads source, until the route declarations of #793 give the
 * paths one owner both sides import; that owner retires it.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { backendSrc, repoFile } from '../testSupport/repoFile.js';

interface ClientCall {
  module: string;
  fn: string;
  method: string;
  path: string;
}

/**
 * Each route `adminRoutes.ts` registers, as a method and its path's segments.
 * Read from the file rather than from an imported router: importing it
 * transforms the whole import pipeline, OpenCV included, which takes this lane
 * minutes. The file registers every route directly on its router, with a
 * literal path, which is what makes the text the table.
 */
function routesOf(source: string): Array<{ method: string; segments: string[] }> {
  return [...source.matchAll(/router\.(get|post|put|delete|patch)\(\s*'([^']+)'/g)].map(match => ({
    method: match[1].toUpperCase(),
    segments: match[2].split('/'),
  }));
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
const routes = routesOf(readFileSync(`${backendSrc}/routes/adminRoutes.ts`, 'utf8'));

describe('the admin client and the admin routes', () => {
  it('reads the client\'s calls and the routes at all', () => {
    // A reader that found nothing would pass the check below vacuously.
    expect(calls.length).toBeGreaterThan(100);
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
