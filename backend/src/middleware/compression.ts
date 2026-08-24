/**
 * Response compression.
 *
 * The reads the map depends on are JSON of the most compressible shape there
 * is - the same keys repeated over thousands of rows - and until this
 * middleware existed they went out raw: opening Europe cost 1.6 MB on the
 * wire where brotli sends 290 kB (docs/tech/performance.md, § Baseline).
 * A reverse proxy in front of the backend could do this instead (#585), but
 * the dev and test stacks talk to the backend directly and are where the
 * performance lane measures, so the compression has to live where every
 * stack has it.
 *
 * Two kinds of response are kept out of it deliberately; see `shouldCompress`.
 */
import compression from 'compression';
import parseurl from 'parseurl';
import type { Request, RequestHandler, Response } from 'express';

/**
 * Below a kilobyte the encoding's own framing and the CPU it costs are worth
 * more than the bytes they save, so `compression`'s default threshold is kept
 * and made explicit here: `/health` (77 B) and the region counts (985 B on
 * the dev catalogue) go out as they are, and the counts start being
 * compressed on the database where they grow past this.
 */
export const COMPRESSION_THRESHOLD_BYTES = 1024;

const AUTH_PREFIX = '/api/auth';

/**
 * Which responses are compressed.
 *
 * - **Server-sent events are never compressed.** `compression` buffers writes
 *   until it has enough to emit a block, which is the opposite of what a
 *   progress stream is for: the three SSE endpoints (region geometry, the
 *   import match pipeline, import coverage) would deliver their events in one
 *   lump at the end. The library restores the untouched `write`/`end` when the
 *   filter refuses, so a refused response streams exactly as it did before.
 * - **`/api/auth/*` is never compressed.** Those responses carry the access
 *   token in their body, and compressing a body that mixes a secret with
 *   attacker-supplied input is the BREACH class of attack. No route there is
 *   large enough to gain anything, so excluding the prefix removes the class
 *   instead of arguing about each response. Every token-issuing route in this
 *   backend lives under that prefix (`routes/authRoutes.ts`).
 *
 * Everything else defers to `compression.filter`, which compresses only the
 * content types that gain from it - so images and vector tiles are untouched.
 */
export function shouldCompress(req: Request, res: Response): boolean {
  if (mediaTypeOf(res) === 'text/event-stream') return false;
  if (isAuthPath(pathOf(req))) return false;
  return compression.filter(req, res);
}

export function responseCompression(): RequestHandler {
  return compression({
    threshold: COMPRESSION_THRESHOLD_BYTES,
    filter: shouldCompress,
  });
}

/**
 * The path this filter tests has to be the same path Express routed on, or
 * the exclusion below is a guess. Two things make that non-obvious:
 *
 * - `req.url` is not the endpoint's path here. The filter runs when the
 *   headers are written, not when the request comes in, and Express's router
 *   rewrites `req.url` as it descends into a mounted router - a request to
 *   `/api/auth/login` is handled with `req.url` set to `/login`.
 *   `originalUrl` is the one Express leaves alone.
 * - `originalUrl` is a request *target*, not always a path. In absolute form
 *   - `POST http://host/api/auth/login HTTP/1.1`, which Node's parser accepts
 *   - it is the whole URI, and Express still routes it to the auth handler.
 *   Splitting the string on `?` would leave `http://host/api/auth/login`,
 *   which fails a `/api/auth` prefix test, and the response would have been
 *   compressed. Not browser-reachable today (browsers send absolute form only
 *   to proxies) but #585 puts a proxy in front of this.
 *
 * So the pathname is derived by `parseurl`, which is the module Express's own
 * router matches on: taking the answer from the same place is what makes the
 * two unable to disagree, rather than a second derivation that has to be kept
 * in step. It also leaves a leading `//` alone, where `new URL` would read it
 * as protocol-relative and rewrite the path.
 *
 * Lowercased because Express routes case-insensitively by default, so
 * `/API/Auth/login` reaches the same handler and must be excluded with it.
 */
function pathOf(req: Request): string {
  return (parseurl.original(req)?.pathname ?? '').toLowerCase();
}

/** The prefix and what is under it - never `/api/authors`. */
function isAuthPath(path: string): boolean {
  return path === AUTH_PREFIX || path.startsWith(`${AUTH_PREFIX}/`);
}

function mediaTypeOf(res: Response): string {
  const header = res.getHeader('Content-Type');
  const value = Array.isArray(header) ? header[0] : header;
  return typeof value === 'string' ? value.split(';')[0].trim().toLowerCase() : '';
}
