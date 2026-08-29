import { Response } from 'express';

/**
 * Say that this response is public reference data behind an auth gate.
 *
 * `requireAuth` marks everything it lets through `private, no-store`, which is
 * right for what it mostly fronts — one reader's own data, small (#710). A few
 * reads behind it are the other thing: the same bytes for every caller, gated
 * because only the editor asks for them, and large enough that the browser's
 * revalidation round-trip is worth keeping. GADM's boundaries at full
 * resolution (`controllers/division/divisionGeometry.ts`) and Wikimedia's
 * geoshape for a Wikidata id (`controllers/admin/wvImportLifecycleController.ts`)
 * are both that shape: `no-store` there would trade a `304` for the whole body
 * on every dialog open and protect nothing, since there is nothing of the
 * caller's in it.
 *
 * `no-cache`, not a `max-age`: the browser stores the body and revalidates
 * every use, so the origin re-authorizes each one — which is what keeps an
 * auth-gated body out of the hands of a caller who has since lost the gate.
 * `private` stays, as it does on every override but one — the admin image
 * proxy, which answers `public` because it returns a Commons picture unchanged
 * and says so in a suppression on its own line. What changes here is only the
 * freshness half. That much is enforced by `no-restricted-syntax` in
 * `backend/eslint.config.mjs`; that this helper is still *called* is held by
 * `middleware/cacheOverrides.test.ts`, since a linter cannot fire on a call
 * that stopped existing.
 *
 * The `Vary: Authorization` the middleware appended is left alone, and that
 * costs something worth naming: the stored entry is selectable only under the
 * token it was stored with, and the access token rotates every 15 minutes, so
 * an open costs a `304` within one token's lifetime and the full body on the
 * first open after each refresh. Keying a private cache on the token buys
 * nothing for a body identical to every caller, and dropping it would buy
 * those transfers back — but a handler subtracting from a header another
 * module set is a mechanism to introduce deliberately rather than in passing,
 * so it is not done here.
 *
 * Call it inside the handler, not on the route: `setHeader` replaces, so this
 * only wins where it runs after the middleware.
 */
export function markPublicReferenceBody(res: Response): void {
  res.setHeader('Cache-Control', 'private, no-cache');
}

/**
 * Say that this response hands the caller an access token, so no cache keeps it.
 *
 * Four of the five that do run ahead of `requireAuth` — a token is what a
 * caller gets before holding one — so the rule that middleware carries (#710)
 * does not reach them, and Express's defaults are all they would send. The
 * fifth, `/change-password`, is behind it and already carries the value; it is
 * marked anyway, so a reader of these five does not have to work out which.
 *
 * In practice a browser stores no `POST` response, which is what all five are.
 * The headers are here because RFC 6749 § 5.1 asks a token response for them
 * outright, and "the method protects it" is a guarantee about caches rather
 * than about this endpoint. `Pragma` is the same RFC's second half: RFC 9111
 * § 5.4 deprecates it in a response and no cache here reads it, so it states
 * the intent for an auditor rather than changing behaviour.
 */
export function markTokenResponse(res: Response): void {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Pragma', 'no-cache');
}

/**
 * Say that this response is a stream the caller opened with `EventSource`.
 *
 * `no-cache` is what an SSE response has always carried here, and `private`
 * beside it is what #710 added: `EventSource` cannot send headers, so the
 * token rides in the query string and the request carries no `Authorization`
 * at all. RFC 9111 § 3.5, which keeps a shared cache off an authorized
 * response, excludes nothing for these, and the `Vary: Authorization`
 * `requireAuth` appends selects nothing either — `private` is the whole of the
 * guarantee. Replacing the middleware's value, which a stream must do, is what
 * would otherwise drop it along with the `no-store`.
 */
export function markStreamBody(res: Response): void {
  res.setHeader('Cache-Control', 'private, no-cache');
}
