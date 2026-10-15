/**
 * Cross-origin access for the web.
 *
 * The page and the API are different origins in every stack this repository
 * runs (`localhost:5173` -> `localhost:3001` on the dev stack,
 * `frontend:5173` -> `backend:3001` on the test stack). A request with a body
 * names `Content-Type: application/json` and a signed-in one carries an
 * `Authorization` header (`buildJsonHeaders`, `frontend/src/api/fetchUtils.ts`);
 * neither is CORS-safelisted, so the browser asks the API with an `OPTIONS`
 * preflight before such a request. An anonymous read without a body is a
 * simple request and is not asked about. Without `Access-Control-Max-Age` the
 * browser would ask again before every such request.
 *
 * A same-origin deployment (the API behind the page's own origin, #585) pays
 * no preflight at all; the dev and test stacks keep paying the cached one.
 * The CSRF check in `index.ts` reads the `Origin` of each state-changing
 * request itself and does not depend on the preflight being repeated.
 */
import cors from 'cors';
import type { RequestHandler } from 'express';

/**
 * How long a browser may reuse a preflight's answer for the same URL. Chrome
 * caps the cache at 7 200 s and Firefox at 86 400 s; the lower cap is taken so
 * a change of the policy (a new frontend origin) reaches every browser within
 * the same two hours.
 */
export const PREFLIGHT_MAX_AGE_SECONDS = 7200;

/** The CORS layer the app mounts, for the one origin the web is served from. */
export function apiCors(origin: string): RequestHandler {
  return cors({
    origin,
    credentials: true,
    maxAge: PREFLIGHT_MAX_AGE_SECONDS,
  });
}
