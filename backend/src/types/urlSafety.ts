/**
 * What a curator may store in a url field, decided in one place.
 *
 * The rule is written once, here, because two spellings — a denylist in a
 * schema and another in a controller — disagree about whitespace: with only
 * one trimming, `" javascript:alert(1)"` walks past the schema and is stored
 * (#693). Trimming both would not close it. A URL parser drops ASCII tab, LF and CR from anywhere in the input
 * before it decides what the scheme is, so `"java\tscript:alert(1)"` is a
 * `javascript:` url that no denylist over the raw string sees.
 *
 * So the question is put to the parser rather than to the string: what does
 * `new URL()` make of this value, and is that protocol one of ours? That is an
 * allowlist, which is what the rendering path chose for the same values
 * (`isRenderableImageUrl`, frontend/src/utils/imageUrl.ts, #692) — a denylist
 * has to anticipate each evasion, and this one had two.
 *
 * The other stored picture, a region's imported map, is held to the link form
 * of the same rule (#694): it arrives in an admin's import tree as wiki
 * content, and no map is a path on our own origin.
 */

import {
  PICTURE_HOSTS, isPictureHost, namesAPictureFile, isCommonsPath, isDescriptionPage,
} from '@tyr/shared/pictures';

/** The only protocols a stored url may name. */
const STORABLE_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * A base with no other purpose than resolving a value that names no host of its
 * own, so the parser can say whether the value introduces one.
 */
const SAME_ORIGIN_PROBE = 'https://storable-url.invalid';

/**
 * May this value be stored as a link to somewhere off this site?
 *
 * An absolute http(s) url and nothing else. A website or a Wikipedia article is
 * always one, and a path on our own origin could name neither.
 */
export function isStorableHttpUrl(value: string): boolean {
  try {
    return STORABLE_PROTOCOLS.has(new URL(value).protocol);
  } catch {
    return false;
  }
}

/**
 * Which hosts a picture may come from and what names a picture file are the
 * drawing side's rule as much as this side's — a host added here alone stores
 * pictures that never draw, one added there alone draws pictures nothing may
 * store — so they are declared once, in `@tyr/shared/pictures` (ADR-0065),
 * and the licence reasoning (ADR-0043) sits there with them. What this module
 * adds is the storing side's use of them: which *urls* a run and a curator may
 * write, and the addresses a server-side fetch goes to.
 */

/**
 * Is this a picture file on a host whose licence lets us show it?
 *
 * The rule a **run** is held to, and it names no path on our own origin: a
 * source's picture is a Commons file by construction, and the only writer of a
 * `/images/…` path is a person. So a run offering one — or a source that starts
 * answering with something that is not a picture — is refused here, where the
 * shape is checked as well as the host: Commons hosts PDFs, videos and scanned
 * books under the same `Special:FilePath` shape, and the "image file" rule on
 * Wikidata's P18 is a constraint report rather than an enforcement.
 */
export function isCommonsPictureUrl(value: string): boolean {
  if (!isStorableHttpUrl(value)) return false;
  try {
    const url = new URL(value);
    return isPictureHost(url.hostname)
      && isCommonsPath(url.hostname, url.pathname)
      && !isDescriptionPage(url.pathname)
      && namesAPictureFile(url.pathname);
  } catch {
    return false;
  }
}

/**
 * May this value be stored as a picture, and shown?
 *
 * Everything a run may write, plus a path under `/images/` on our own origin —
 * `experiences.image_url` also carries one for a picture we host ourselves,
 * which a curator may set and a run never does. `/images/` and not any path
 * of ours: it is the one shape the drawing side maps onto our API
 * (`extractImageUrl`, `frontend/src/utils/imageUrl.ts`), so any other local
 * path would be stored and never drawn — and reported by Catalogue Checks as
 * a picture the product may not show, for a repair that would not select it.
 * Only a parser can say whether such a path stays on our origin: `//host/x`
 * names an authority, and so do `/\host/x` and `/<tab>/host/x`, because a
 * browser rewrites `\` to `/` and drops tab, LF and CR before it parses.
 * Resolving against a base of our own and asking whether the origin survived
 * answers all of them at once, including the variant nobody has thought of.
 */
export function isDisplayablePictureUrl(value: string): boolean {
  if (isStorableHttpUrl(value)) return isCommonsPictureUrl(value);
  if (!value.startsWith('/images/')) return false;
  try {
    return new URL(value, SAME_ORIGIN_PROBE).origin === SAME_ORIGIN_PROBE;
  } catch {
    return false;
  }
}

/**
 * The origin a server-side fetch of a picture goes to, per host the picture
 * rule admits. Spelled as literals rather than derived from the list so that
 * the address `pictureFetchUrl` builds opens on a constant; the type holds it
 * to the shared host list, and `urlSafety.test.ts` walks that list to hold
 * each entry to its origin.
 */
const PICTURE_FETCH_ORIGINS: Record<(typeof PICTURE_HOSTS)[number], string> = {
  'commons.wikimedia.org': 'https://commons.wikimedia.org',
  'upload.wikimedia.org': 'https://upload.wikimedia.org',
};

/**
 * Where Commons itself sends a picture on, beyond the two hosts a stored one
 * may name.
 *
 * A picture Commons has to *scale* — `Special:FilePath/…?width=800`, the shape
 * the drawing side builds — comes from Wikimedia's thumbnail host, so a fetch
 * holding every hop to the stored list alone refuses every scaled picture. It
 * is a place a redirect may land and never an address a value may start from:
 * no stored picture names it, and the drawing side has no reason to.
 *
 * Measured 2026-09-19 and re-runnable, since no test can reach the network.
 * The `Location` headers below are the literal ones, unelided, on a file this
 * catalogue actually holds (`region_import_state.region_map_url`):
 *
 *     curl -sI 'https://commons.wikimedia.org/wiki/Special:FilePath/Algeria_regions_map.png?width=800'
 *     HTTP/2 302
 *     location: https://commons.wikimedia.org/w/index.php?title=Special:Redirect/file/Algeria_regions_map.png&width=800
 *
 *     HTTP/2 301
 *     location: https://thumb.wikimedia.org/wikipedia/commons/thumb/e/e7/Algeria_regions_map.png/960px-Algeria_regions_map.png?utm_source=commons.wikimedia.org&utm_campaign=index&utm_content=thumbnail
 *
 *     HTTP/2 200   content-type: image/png   content-length: 411022
 *
 * Three things in that transcript are easy to mis-transcribe, and each looks
 * like evidence the host is imaginary:
 *
 * - **960px for a `?width=800`.** Commons serves the next standard size up,
 *   not the width asked for.
 * - **`/wikipedia/commons/thumb/…` on it.** That is `upload.wikimedia.org`'s
 *   own thumbnail layout, kept unchanged on this host, so the path alone does
 *   not say which host answered.
 * - **A small file never reaches it.** Ask for a width a file already exceeds
 *   and Commons answers from `upload` with `utm_content=thumbnail_unscaled`;
 *   Commons' own `Example.jpg` is 172px wide, so the obvious test file shows
 *   `upload` however wide a picture is asked for. The same is true of any
 *   file asked for without a width — the Algeria map above answers 200 from
 *   `upload.wikimedia.org` (image/png, 755384) then.
 */
const PICTURE_REDIRECT_ORIGINS: Record<string, string> = {
  'thumb.wikimedia.org': 'https://thumb.wikimedia.org',
};

/** The origin for a host, looked up as an own key — a hostname may be `constructor`. */
function originFor(hostname: string, asRedirect: boolean): string | undefined {
  if (Object.hasOwn(PICTURE_FETCH_ORIGINS, hostname)) {
    return PICTURE_FETCH_ORIGINS[hostname as keyof typeof PICTURE_FETCH_ORIGINS];
  }
  return asRedirect && Object.hasOwn(PICTURE_REDIRECT_ORIGINS, hostname)
    ? PICTURE_REDIRECT_ORIGINS[hostname]
    : undefined;
}

/**
 * One path segment spelled again for the picture's host.
 *
 * `URL` has already percent-encoded what a path may not carry raw, so the
 * segment is decoded before it is encoded, or `%C3%A9` would come back as
 * `%25C3%25A9` and name a file that does not exist. `encodeURIComponent` also
 * encodes the `:` of `Special:FilePath`, which MediaWiki reads either way
 * (checked against Commons: `Special%3AFilePath/Algeria%2C_…svg` answers the
 * same 302 as the raw spelling) — put back for whoever reads the address in a
 * log, not for the server. A segment that does not decode names nothing this
 * server should ask for; the caller answers null for it.
 */
function respellSegment(segment: string): string {
  return encodeURIComponent(decodeURIComponent(segment)).replace(/%3A/gi, ':');
}

/**
 * The address a server-side fetch of a picture goes to, or null when the
 * value names a host this server does not call.
 *
 * Two readers fetch a picture from the server rather than draw it: the CV
 * colour-match pipeline reads a region's imported map (`runSourceMapPipeline`),
 * and the admin panel's image proxy answers a `?url=` for an overlay the
 * browser cannot load across origins. Either is a request this server makes on
 * an admin's word, and the value it is handed — a node of an import tree, a
 * query string — may name any address at all, `http://127.0.0.1:3001/…`
 * included (#706). So the rule is the picture rule's own host list, matched
 * host for host rather than by suffix: what this product fetches for itself is
 * a Commons file, and every Commons file has an address on those two hosts.
 * `asRedirect` is for a hop Commons sent (`fetchPicture`), which may also land
 * on the thumbnail host above; a value an admin hands in never may.
 *
 * The address is rebuilt rather than passed through. The origin is one of the
 * literals above; the value contributes the path, one segment at a time and
 * each spelled again for the host, and the query after a `?` of our own. That
 * is what drops a port or a `user@` the value may carry, and it is also the
 * shape a static analyser can read: CodeQL's request-forgery query counts a
 * value merely *compared* against a list as still the caller's, and a segment
 * that went through `encodeURIComponent`, or a suffix that follows a literal
 * `?`, as not — so a schema that merely compares the value against the hosts
 * is a request-forgery alert on every line shift, and this shape is not.
 */
export function pictureFetchUrl(value: string, { asRedirect = false } = {}): string | null {
  if (!isStorableHttpUrl(value)) return null;
  const url = new URL(value);
  const origin = originFor(url.hostname, asRedirect);
  if (!origin) return null;
  try {
    const path = url.pathname.split('/').map(respellSegment).join('/');
    const query = url.search ? `?${url.searchParams}` : '';
    return `${origin}${path}${query}`;
  } catch {
    return null;
  }
}

/**
 * The one spelling of a storable url that every later reader agrees about.
 *
 * Judging a value by what the parser makes of it and then storing the string as
 * typed leaves the two able to disagree: `HTTPS://…` is an https url to the
 * parser and not to a `startsWith('https://')` test, and `https://x/a<tab>b` is
 * one url here and another once a browser has dropped the tab. The reader that
 * matters is `isRenderableImageUrl` (frontend/src/utils/imageUrl.ts), which
 * makes exactly that lowercase comparison — so a picture accepted in that
 * spelling would be stored and then quietly draw nothing.
 *
 * A path on our own origin is left as it is: it is resolved against whatever
 * origin is serving it, not against the probe used to check it.
 */
export function normalizeStorableUrl(value: string): string {
  return isStorableHttpUrl(value) ? new URL(value).href : value;
}

/** What a field says when it refuses, said once so both layers say the same thing. */
export const STORABLE_HTTP_URL_MESSAGE = 'URL must be an absolute http(s) URL';
export const DISPLAYABLE_PICTURE_URL_MESSAGE =
  'Image URL must be a Wikimedia Commons picture file or an /images/ path on this site';
export const PICTURE_FETCH_URL_MESSAGE = 'Only Wikimedia Commons URLs are allowed';
