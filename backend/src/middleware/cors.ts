/**
 * Cross-origin access for the web.
 *
 * The page and the API are different origins in every stack this repository
 * runs (`localhost:5173` -> `localhost:3001` on the dev stack,
 * `frontend:5173` -> `backend:3001` on the test stack). Every request the web
 * sends carries `Content-Type: application/json` - a bodiless GET included
 * (`buildJsonHeaders`, `frontend/src/api/fetchUtils.ts`) - and a signed-in
 * one an `Authorization` header too; neither is CORS-safelisted, so the
 * browser asks the API with an `OPTIONS` preflight before each one, an
 * anonymous reader's included. Without `Access-Control-Max-Age` it asks again
 * before every request.
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
