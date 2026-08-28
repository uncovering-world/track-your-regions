/**
 * What a curator may store in a url field, decided in one place.
 *
 * The rule used to be written twice — a denylist in `safeUrl` (types/index.ts)
 * and a second spelling in `isUnsafeUrl` (curationController.ts) — and the two
 * disagreed about whitespace: only one trimmed, so `" javascript:alert(1)"`
 * walked past the schema and was stored (#693). Trimming both would not have
 * closed it. A URL parser drops ASCII tab, LF and CR from anywhere in the input
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
 * May this value be stored as a picture?
 *
 * Everything a link may be, plus a path that stays on our own origin:
 * `experiences.image_url` also carries `/images/…` for a picture we host
 * ourselves. Only a parser can say whether such a path stays — `//host/x` names
 * an authority, and so do `/\host/x` and `/<tab>/host/x`, because a browser
 * rewrites `\` to `/` and drops tab, LF and CR before it parses. Resolving
 * against a base of our own and asking whether the origin survived answers all
 * of them at once, including the variant nobody has thought of.
 */
export function isStorableImageUrl(value: string): boolean {
  if (isStorableHttpUrl(value)) return true;
  if (!value.startsWith('/')) return false;
  try {
    return new URL(value, SAME_ORIGIN_PROBE).origin === SAME_ORIGIN_PROBE;
  } catch {
    return false;
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
export const STORABLE_IMAGE_URL_MESSAGE =
  'Image URL must be an absolute http(s) URL or a path on this site';
