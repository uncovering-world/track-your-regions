# ADR-0071: A route is declared once, and its middleware follows from the declaration

**Date:** 2026-09-26
**Status:** Accepted
**Issue:** [#793](https://github.com/uncovering-world/track-your-regions/issues/793)

---

## Context

The backend's 237 routes each list their middleware by hand in `backend/src/routes/`. Measured on `main` @ ff296828b:

- **No common order.** There are 35 distinct orderings of limiter, auth, role, validation and visibility guard. A malformed id is answered 400 before 401 on some routes and after it on others.
- **Unvalidated path parameters.** Seven routes read a `:name` segment that no schema validates. All five `/api/divisions/:divisionId…` routes did `parseInt` on raw text, so `abc` reached the database as `NaN`.
- **Cache policy lives in four places.** `requireAuth` and `optionalAuth` write it. So do three helpers in `middleware/cacheHeaders.ts` and three inline writes in `adminRoutes.ts`. Two lint rules and `cacheOverrides.test.ts` hold those places to each other, and `callerShapedReads.test.ts` walks the built router to prove each caller-shaped read carries `optionalAuth`.
- **The validated input never reaches the handler's types.** `validate()` replaces `req.query` with the parsed value, but the handler reads it untyped. It re-parses (`parseInt(String(req.params.x))` 155 times, `req.body as` 47 times) and re-decides defaults the schema already set. `getSubdivisions` read a `limit` of 1000 by default, where the schema's default of 100 was what arrived.
- **Two Zod versions.** Request schemas were on Zod 3, while the response schemas of ADR-0066 are on `zod/v4`.

## Decision

**A route is declared once, with `defineRoute()` in `backend/src/api/route.ts`, and the router is built from the declarations by `routerOf()`.**

1. **A declaration names every policy.**
   - It carries `method`, `path`, `access`, `cache`, an optional `limiter`, the `params`, `query` and `body` schemas, the `response` schema and the `handler`.
   - **`access`** is one of `public`, `optional`, `signed-in`, `curator`, `admin`.
   - **`cache`** is one of three policies:
     - `no-store` → `private, no-store`
     - `revalidate` → `private, no-cache`
     - `shared-revalidate` → `public, no-cache`, allowed only on a `public` route.
   - `access` and `cache` have no default. A declaration without them does not compile.
   - A path's `:name` segments must be named by its `params` schema, or the declaration does not compile.
2. **One order, for every route.** The chain is: limiter → the caller (`access`) → the cache header → params → query → body → handler.
   - A caller the route refuses learns nothing about its inputs, because the 401 and the 403 come before any 400.
   - A handler never runs on input its schemas did not pass.
3. **The handler receives its input typed and returns its body.**
   - The input is `{ params, query, body, caller }`, each typed from the declaration. The caller is `undefined` on a `public` route and possibly `undefined` on an `optional` one.
   - The registry sends the returned body through `respond()`, which types it from `response` and parses it outside production (ADR-0066).
   - A 204 is `NO_CONTENT`, returned only where the declaration says `noContent`. A create declares `status: 201`.
   - A failure is thrown, and every failure reaches the error handler through `next`:
     - `notFound`, `badRequest` and `createError`, as before;
     - `failure(message, status, code?)`, for a sentence the product wrote. It stays readable in production at a 5xx, as a `ReaderFacingError` does (#1021), and carries a code the client may branch on (`quota_exceeded`).
4. **What cannot be typed is checked when the router is built.** `routerOf` throws at startup on:
   - a route that an earlier one shadows (`/:id` above `/search`);
   - a shared cache on a route that reads a token.
5. **Request schemas are on `zod/v4`, with the response schemas.** `validate()`, which the undeclared routes still use, takes the same schemas. The error handler reads v4's `ZodError`.
6. **The migration is staged, file by file, and each slice deletes what its routes no longer need.** That means the hand re-validation in their controllers, their mount guards, their entries in `cacheOverrides.test.ts` and their share of `callerShapedReads.test.ts`. The two Cache-Control lint rules, `callerShapedReads.test.ts`, `adminClientPaths.test.ts` and `validate()` go with the last route file. The OpenAPI 3.1 document is emitted from the declarations after that. Both are owned by #793.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Adopt NestJS or Fastify | Assessed on #793 and declined: the registry is a few hundred lines, while a migration of 237 routes and three streams onto another framework is not |
| Keep the middleware lists and add a lint rule or a router-walking test for each policy | That is what exists. Each new concern (#597 → #710 → #712 for no-store, #660 → #664 for tile scope) added one more guard, one route at a time, and none of them types the handler's input |
| Let each declaration choose its own middleware order | The order is behaviour: 400 against 401, and the limiter before the token check. With 35 orderings there is no rule, only history |
| Move request schemas to `zod/v4` route by route | The shared field schemas (`worldViewIdSchema`, `limitSchema`, …) are used by routes in every file. Moving them per route means holding both versions of each one until the last file moves. The switch is six import lines and two `z.record` calls |
| Sort routes so that literal segments come before parameters, instead of refusing a shadowed one | Sorting hides a mistake in the declared order that a reader of the file would still make. Refusing it at startup keeps the file's order the order Express uses |

## Consequences

**Positive:**
- Who may call a route, how its answer is cached and what it reads are one declaration, readable in one place. A route that omits one does not compile.
- A handler cannot read an input its schema did not declare. Its defaults are the schema's.
- The declarations are data: the OpenAPI document, a client-path check and the caller-shaped read check can be computed from them, instead of from the router's internals or the source text.

**Negative / Trade-offs:**
- Until the last route file moves, two ways of writing a route coexist, along with the guards that hold the old way. #793 owns their removal. Each slice names what it deleted, and what still waits and why.
- An extra key in an object an inline handler returns is caught by `respond()`'s parse in the test lanes, not by the compiler. A handler with a declared return type, which is every controller moved so far, is checked by the compiler as well.
- The fixed order changes the answer on the routes that validated before authenticating. An unauthenticated request with a malformed id now gets 401 where it used to get 400.

## References

- Related ADRs: ADR-0066 (response schemas and `respond()`), ADR-0065 (rules both sides share), ADR-0062 (gates)
- Related docs: `docs/tech/development-guide.md` § API Layer and § A migration deletes what its owner replaced
- Issue: #793
