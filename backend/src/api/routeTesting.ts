/**
 * Answer a declared route's request the way the registry does, without Express,
 * for a handler's spec (ADR-0071).
 *
 * The request's parts are parsed by the route's own schemas, so a spec that
 * passes `{ params: { id: '281' } }` exercises the coercion the wire does; the
 * caller is `req.user`, and the body goes through `respond()`. A failure the
 * handler throws with a status answers through the error handler itself. What
 * is not here is the middleware — the limiter, the token, the cache header,
 * `scope` — which `route.test.ts` holds on a real server, and a streamed
 * answer, whose handler a spec drives with a `send` of its own.
 */

import type { Response } from 'express';
import type { z } from 'zod/v4';
import type { Method, Route } from './route.js';
import { NO_CONTENT } from './route.js';
import { respond } from './respond.js';
import { errorHandler } from '../middleware/errorHandler.js';

/** A request as a handler's spec writes one. */
export interface SpecRequest {
  readonly params?: Record<string, unknown>;
  readonly query?: Record<string, unknown>;
  readonly body?: unknown;
  readonly user?: Express.User;
}

/** The declared route at `path`, or a spec that names a path nothing declares fails loudly. */
export function routeAt(routes: readonly Route[], path: string, method: Method = 'get'): Route {
  const route = routes.find(r => r.path === path && r.method === method);
  if (!route) throw new Error(`no declared route ${method.toUpperCase()} ${path}`);
  return route;
}

/** Answer `req` on `route` into `res`, which needs `status` and `json`. */
export async function answer(route: Route, req: SpecRequest, res: unknown): Promise<void> {
  if ('events' in route.response && !('safeParse' in route.response)) {
    throw new Error(`${route.method.toUpperCase()} ${route.path} answers with a stream: drive its handler with a send of the spec's own`);
  }
  if ('redirect' in route.response && !('safeParse' in route.response)) {
    throw new Error(`${route.method.toUpperCase()} ${route.path} answers with a redirect its handler writes: drive the handler directly`);
  }
  const out = res as Response;
  const parts = {
    params: route.params ? route.params.parse(req.params ?? {}) : undefined,
    query: route.query ? route.query.parse(req.query ?? {}) : undefined,
    body: route.body ? route.body.parse(req.body ?? {}) : undefined,
  };
  let body: unknown;
  try {
    body = await route.handler(route.access === 'public' ? parts : { ...parts, caller: req.user }, { req: {} as never, res: out });
  } catch (err) {
    // A failure the handler meant, with its status, answers through the real
    // error handler; anything else is the spec's to see thrown.
    if (typeof (err as { statusCode?: unknown }).statusCode !== 'number') throw err;
    errorHandler(err as Error, {} as never, out, () => {});
    return;
  }
  if (body === NO_CONTENT) {
    out.status(204);
    return;
  }
  respond(route.status ? out.status(route.status) : out, route.response as z.ZodType, body);
}
