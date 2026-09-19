/**
 * A picture the server fetches for itself, every hop of it (#706).
 *
 * Two readers fetch a picture rather than draw it — the CV colour-match
 * pipeline's read of a region's map and the admin image proxy — and both are
 * handed the address by an admin: a node of an import tree, a query string.
 * `pictureFetchUrl` (`types/urlSafety.ts`) decides which addresses this server
 * calls. Deciding it for the first request only would leave the rest to
 * whatever `Location` comes back, and the proxy returns the final bytes to its
 * caller, so a redirect is not followed blindly: each hop is put to the same
 * rule and rebuilt by it before it is requested.
 *
 * Commons redirects a picture twice on the way to its bytes (measured
 * 2026-09-19: `Special:FilePath/Algeria_regions_map.png` →
 * `Special:Redirect/file/…` on commons → `upload.wikimedia.org/wikipedia/commons/…`
 * → 200), and one it has to scale — `?width=800` — ends on the thumbnail host
 * instead (`PICTURE_REDIRECT_ORIGINS`, with the measurement). A hop is held to
 * the stored list plus that host (`pictureFetchUrl`'s `asRedirect`); the first
 * address to the stored list alone.
 */

import { pictureFetchUrl } from '../types/urlSafety.js';
import { userAgent } from '../config/userAgent.js';

/** More than Commons' two, fewer than a loop would take. */
const MAX_HOPS = 5;

/**
 * Fetch a picture, following redirects only while each one stays on a host the
 * picture rule admits.
 *
 * Returns the final response, or null when any hop — the first included —
 * names an address the rule refuses, or the chain runs past `MAX_HOPS`. A
 * non-2xx final answer is returned as it came; what it means is the caller's.
 */
export async function fetchPicture(value: string, purpose: string): Promise<Response | null> {
  let next = value;
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    const target = pictureFetchUrl(next, { asRedirect: hop > 0 });
    if (!target) return null;
    const response = await fetch(target, {
      headers: { 'User-Agent': userAgent({ purpose }) },
      redirect: 'manual',
    });
    const location = response.headers.get('location');
    if (response.status < 300 || response.status >= 400 || !location) return response;
    // Resolved against the hop that answered it, since `Location` may be relative.
    next = new URL(location, target).href;
  }
  return null;
}
