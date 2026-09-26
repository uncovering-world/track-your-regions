/**
 * A route, declared once (#793, ADR-0071).
 *
 * A declaration names who may call the route (`access`), how its answer may be
 * cached (`cache`), what it reads (`params`, `query`, `body`) and what it
 * answers (`response`). The middleware follows from those fields, in one order
 * for every route:
 *
 *   limiter → the caller (`access`) → the cache header → params → query → body → scope → handler
 *
 * so a caller the route refuses learns nothing about its inputs, and a handler
 * never runs on input its schema did not pass.
 *
 * `access` and `cache` have no default: a route that does not say who may call
 * it, or how its answer is kept, does not compile. A path's `:name` segments
 * must be named by its `params` schema, so a parameter nothing validates does
 * not compile either.
 *
 * The handler receives the parsed input, typed from the schemas, and returns the
 * body; the registry sends it through `respond()`, which types it from
 * `response` and parses it outside production (ADR-0066). A handler that
 * answers with no body returns `NO_CONTENT`, and only where the declaration
 * says it may. A handler on a `public` route is not told who is calling at all,
 * so one that shapes its answer by the caller cannot be declared `public`.
 *
 * A route that reads a hidden world view's data names it in `scope`, and the
 * registry answers 404 to anyone but an admin before the handler runs.
 */

import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { z } from 'zod/v4';
import { optionalAuth, requireAdmin, requireAuth, requireCurator, type AuthenticatedRequest } from '../middleware/auth.js';
import { notFound } from '../middleware/errorHandler.js';
import { isVisibleToReaders, type VisibleScope } from '../middleware/worldViewVisibility.js';
import { respond, writeEvent } from './respond.js';

/**
 * Who may call a route.
 *
 * - `public`: anyone, and the answer does not depend on who asks; no token is
 *   read.
 * - `optional`: anyone, and a token, if sent, shapes the answer (a curator sees
 *   what a visitor does not).
 * - `signed-in`, `curator`, `admin`: a token is required, and the role with it.
 */
export type Access = 'public' | 'optional' | 'signed-in' | 'curator' | 'admin';

/**
 * How an answer may be kept.
 *
 * - `no-store`: kept nowhere, the browser included. The caller's own data, a
 *   write's answer.
 * - `revalidate`: stored by the caller's browser only, and revalidated on every
 *   use, so the origin re-authorizes each one. A body shaped by the caller, or
 *   public reference data behind a gate (`middleware/cacheHeaders.ts` has why).
 * - `shared-revalidate`: stored by any cache, and revalidated on every use. The
 *   same body for everyone; `public` routes only.
 */
export type CachePolicy = 'no-store' | 'revalidate' | 'shared-revalidate';

const CACHE_HEADER: Record<CachePolicy, string> = {
  'no-store': 'private, no-store',
  revalidate: 'private, no-cache',
  'shared-revalidate': 'public, no-cache',
};

export type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

/** The names of a path's `:name` segments: `'/:id/items/:itemId'` → `'id' | 'itemId'`. */
export type PathParams<P extends string> =
  P extends `${string}:${infer Name}/${infer Rest}` ? Name | PathParams<`/${Rest}`>
    : P extends `${string}:${infer Name}` ? Name
      : never;

/**
 * A streamed answer: server-sent events, each held to `events` the way a body
 * is held to its schema (ADR-0066). The registry opens the stream — its type,
 * keep-alive, the headers flushed — and the handler writes events with
 * `send`; the registry ends the stream when the handler returns.
 */
export interface StreamAnswer<E extends z.ZodType> {
  readonly events: E;
}

/** Declare a route's answer as a stream of `events`. */
export function stream<E extends z.ZodType>(events: E): StreamAnswer<E> {
  return { events };
}

function isStream(response: z.ZodType | StreamAnswer<z.ZodType>): response is StreamAnswer<z.ZodType> {
  return 'events' in response && !('safeParse' in response);
}

/** What a streaming handler writes with. */
export interface StreamExchange<Event> extends RouteExchange {
  readonly send: (event: Event) => void;
}

/**
 * The answer of a route that never has a body: every success is a 204. Declared
 * with `noContent: true`, and its handler returns `NO_CONTENT`.
 */
export const NO_BODY = z.never();

/** Answers with no body: a 204. Returned by a handler whose route declares `noContent`. */
export const NO_CONTENT: unique symbol = Symbol('no content');

type OutputOf<S> = S extends z.ZodType ? z.output<S> : undefined;

/** What a handler receives: its input, parsed. */
export interface RouteParts<Params, Query, Body> {
  readonly params: Params;
  readonly query: Query;
  readonly body: Body;
}

/**
 * What a handler receives: its input, and who is calling. A `public` route's
 * handler has no `caller`, so a handler that needs one does not compile there.
 */
export type RouteInput<Params, Query, Body, A extends Access> = RouteParts<Params, Query, Body>
  & (A extends 'public' ? unknown
    : { readonly caller: A extends 'optional' ? Express.User | undefined : Express.User });

/** The request and response, for a handler that needs a header or a cookie. */
export interface RouteExchange {
  readonly req: Request;
  readonly res: Response;
}

type ParamsField<P extends string, PS> = [PathParams<P>] extends [never]
  ? { readonly params?: never }
  : { readonly params: PS & z.ZodType<{ [K in PathParams<P>]: unknown }> };

export type RouteDeclaration<
  P extends string,
  A extends Access,
  PS extends z.ZodType | undefined,
  QS extends z.ZodType | undefined,
  BS extends z.ZodType | undefined,
  RS extends z.ZodType | StreamAnswer<z.ZodType>,
  NC extends boolean,
> = {
  readonly method: Method;
  readonly path: P;
  readonly access: A;
  readonly cache: A extends 'public' ? CachePolicy : Exclude<CachePolicy, 'shared-revalidate'>;
  readonly limiter?: RequestHandler;
  readonly query?: QS;
  readonly body?: BS;
  readonly response: RS;
  /** A success status other than 200, for a create. */
  readonly status?: 201;
  /** Whether the handler may answer 204 by returning `NO_CONTENT`. */
  readonly noContent?: NC;
  /**
   * The world view the answer belongs to, read from the parsed input; a
   * hidden one answers 404 to anyone but an admin. `undefined` where the
   * input names none, for an optional filter.
   */
  readonly scope?: (input: RouteParts<OutputOf<PS>, OutputOf<QS>, OutputOf<BS>>) => VisibleScope | undefined;
  readonly handler: RS extends StreamAnswer<infer E>
    ? (input: RouteInput<OutputOf<PS>, OutputOf<QS>, OutputOf<BS>, A>, exchange: StreamExchange<z.output<E>>) => Promise<void>
    : (
      input: RouteInput<OutputOf<PS>, OutputOf<QS>, OutputOf<BS>, A>,
      exchange: RouteExchange,
    ) => Promise<z.output<RS & z.ZodType> | (NC extends true ? typeof NO_CONTENT : never)>;
} & ParamsField<P, PS>;

/** A declared route, its types erased: what the registry builds and a spec reads. */
export interface Route {
  readonly method: Method;
  readonly path: string;
  readonly access: Access;
  readonly cache: CachePolicy;
  readonly limiter?: RequestHandler;
  readonly params?: z.ZodType;
  readonly query?: z.ZodType;
  readonly body?: z.ZodType;
  readonly response: z.ZodType | StreamAnswer<z.ZodType>;
  readonly status?: number;
  readonly noContent?: boolean;
  readonly scope?: (input: RouteParts<unknown, unknown, unknown>) => VisibleScope | undefined;
  readonly handler: (
    input: RouteParts<unknown, unknown, unknown> & { readonly caller?: Express.User },
    exchange: RouteExchange & { readonly send?: (event: unknown) => void },
  ) => Promise<unknown>;
}

/** Declare a route. The declaration is checked by the compiler; `routerOf` builds it. */
export function defineRoute<
  const P extends string,
  A extends Access,
  RS extends z.ZodType | StreamAnswer<z.ZodType>,
  PS extends z.ZodType | undefined = undefined,
  QS extends z.ZodType | undefined = undefined,
  BS extends z.ZodType | undefined = undefined,
  NC extends boolean = false,
>(declaration: RouteDeclaration<P, A, PS, QS, BS, RS, NC>): Route {
  return declaration as unknown as Route;
}

/** The middleware that establishes the caller, in the order they run. */
const CALLER: Record<Access, readonly RequestHandler[]> = {
  public: [],
  optional: [optionalAuth as RequestHandler],
  'signed-in': [requireAuth as RequestHandler],
  curator: [requireAuth as RequestHandler, requireCurator as RequestHandler],
  admin: [requireAuth as RequestHandler, requireAdmin as RequestHandler],
};

/** Parse one part of the request, or pass the Zod error to the error handler as a 400. */
function parsed(schema: z.ZodType | undefined, value: unknown): unknown {
  if (!schema) return undefined;
  const result = schema.safeParse(value);
  if (!result.success) throw result.error;
  return result.data;
}

/**
 * Answer as a stream: its headers go out before the handler runs, so a failure
 * after them cannot become a status. It is logged and the stream ended; a
 * handler that means to tell the reader writes its own error event first.
 */
async function openStream(
  events: z.ZodType, input: unknown, route: Route, req: Request, res: Response,
): Promise<void> {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  const send = (event: unknown): void => writeEvent(res, events, event);
  try {
    await route.handler(input as Parameters<Route['handler']>[0], { req, res, send });
  } catch (err) {
    console.error('Stream %s %s failed:', route.method.toUpperCase(), route.path, err);
  } finally {
    if (!res.writableEnded) res.end();
  }
}

/** The chain one declaration builds, in the order the module comment gives; `scope` is checked after the body. */
function chainOf(route: Route): RequestHandler[] {
  const cacheHeader: RequestHandler = (_req, res, next) => {
    // eslint-disable-next-line no-restricted-syntax -- CACHE_HEADER's one public value is refused off a public route by routerOf and by the declaration's type
    res.setHeader('Cache-Control', CACHE_HEADER[route.cache]);
    next();
  };
  // Every failure goes to `next`, and from there to the error handler: a
  // validation error as the 400, a thrown `createError` as its status. Not left
  // to `express-async-errors`, which only a server that imports it has.
  const handle = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parts = {
        params: parsed(route.params, req.params),
        query: parsed(route.query, req.query),
        body: parsed(route.body, req.body),
      };
      const caller = route.access === 'public' ? undefined : (req as AuthenticatedRequest).user;
      const scope = route.scope?.(parts);
      // A missing row and a hidden world view answer the same 404, which
      // says nothing about which world views exist.
      if (scope && caller?.role !== 'admin' && !(await isVisibleToReaders(scope))) {
        throw notFound('Not found');
      }
      const input = route.access === 'public' ? parts : { ...parts, caller };
      if (isStream(route.response)) {
        await openStream(route.response.events, input, route, req, res);
        return;
      }
      const body = await route.handler(input, { req, res });
      if (body === NO_CONTENT) {
        res.status(204).send();
        return;
      }
      respond(route.status ? res.status(route.status) : res, route.response as z.ZodType, body);
    } catch (err) {
      next(err);
    }
  };
  return [
    ...(route.limiter ? [route.limiter] : []),
    ...CALLER[route.access],
    cacheHeader,
    handle as RequestHandler,
  ];
}

/** A path as segments, each a literal or a parameter. */
function segmentsOf(path: string): readonly string[] {
  return path.split('/').filter(segment => segment.length > 0);
}

/**
 * The earlier route that answers every request `later` would, if one does.
 *
 * Express tries routes in the order they are added, so `/:id` above `/search`
 * takes the word `search` as an id and the search is never reached. A route is
 * shadowed when an earlier one of its method has as many segments and, at every
 * one, a parameter or the same literal.
 */
export function shadowOf(earlier: readonly Route[], later: Route): Route | undefined {
  const own = segmentsOf(later.path);
  return earlier.find(route => {
    if (route.method !== later.method) return false;
    const theirs = segmentsOf(route.path);
    if (theirs.length !== own.length) return false;
    return theirs.every((segment, i) => segment.startsWith(':') || segment === own[i]);
  });
}

/**
 * Build an Express router from declarations, in the order given.
 *
 * Throws at startup on a route an earlier one shadows, and on a `public`
 * cache policy the access does not allow (the compiler refuses the literal
 * case; this holds a declaration built any other way).
 */
export function routerOf(routes: readonly Route[]): Router {
  const router = Router();
  routes.forEach((route, i) => {
    const shadow = shadowOf(routes.slice(0, i), route);
    if (shadow) {
      throw new Error(`${route.method.toUpperCase()} ${route.path} is never reached: ${shadow.path} above it answers first`);
    }
    if (route.cache === 'shared-revalidate' && route.access !== 'public') {
      throw new Error(`${route.method.toUpperCase()} ${route.path} is ${route.access}, and its answer may not be kept by a shared cache`);
    }
    router[route.method](route.path, ...chainOf(route));
  });
  return router;
}
