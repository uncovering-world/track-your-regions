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
 * The hosts a picture on a card may come from.
 *
 * A licence question before it is a technical one ([ADR-0043](../../../docs/decisions/0043-a-picture-we-show-is-one-we-may-show.md)).
 * Wikimedia Commons files are published to be reused with the author named,
 * which is what `ImageCreditLine` does; a photograph on somebody else's server
 * carries whatever terms that server carries, and the World Heritage Centre's
 * are explicit that its pictures "may not be copied or retransmitted by any
 * means" and that a site may "only link to, not replicate" them. So the rule
 * cannot be "any http(s) url": the product has to be able to say, of every
 * picture it draws, why it is allowed to draw it.
 *
 * Mirrored by `TRUSTED_IMAGE_DOMAINS` in `frontend/src/utils/imageUrl.ts`, which
 * is the same list on the rendering side. No import can cross that boundary
 * (#527), so the two are kept in step by `urlSafety.test.ts`, which reads that
 * declaration out of the other side's source — a host added here alone stores
 * pictures that never draw, and one added there alone draws pictures nothing
 * may store.
 */
export const DISPLAYABLE_PICTURE_HOSTS = [
  'commons.wikimedia.org',
  'upload.wikimedia.org',
] as const;

/**
 * The file types a picture may be, read from the name the host serves it under.
 *
 * The evidence that a stored url is a picture at all, and it is what this
 * repository can check without asking somebody else's server on every write.
 * Mirrored on the drawing side like the host list is, and pinned to it by the
 * same test (`urlSafety.test.ts`): a type added here alone stores files that
 * never draw, one added there alone draws files nothing may store.
 * Commons hosts PDFs, videos and scanned books under the same `Special:FilePath`
 * shape, and a run that stored one of those would put an empty frame on a card
 * exactly the way `whc.unesco.org/document/<id>` did (#557).
 */
export const PICTURE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg', '.tif', '.tiff', '.avif'] as const;

function isPictureHost(hostname: string): boolean {
  return DISPLAYABLE_PICTURE_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
}

function namesAPictureFile(pathname: string): boolean {
  const name = decodeURIComponent(pathname).toLowerCase();
  return PICTURE_EXTENSIONS.some((ext) => name.endsWith(ext));
}

/**
 * Is this file actually one of Commons', on the host that serves every wiki's
 * uploads?
 *
 * `upload.wikimedia.org` serves the files of every Wikimedia project from one
 * host, and only the ones under `/wikipedia/commons/` are Commons files. The
 * others are a language edition's own uploads, and the English Wikipedia's
 * include fair-use files — a poster, an album cover — that no licence lets this
 * product show. The host alone does not say which; the path does.
 */
function isCommonsPath(hostname: string, pathname: string): boolean {
  const uploadHost = hostname === 'upload.wikimedia.org' || hostname.endsWith('.upload.wikimedia.org');
  return !uploadHost || pathname.includes('/wikipedia/commons/');
}

/**
 * Is this the page *about* a file rather than the file?
 *
 * `commons.wikimedia.org/wiki/File:Louvre.jpg` ends the way a picture ends and
 * answers HTML — the description page, with the licence and the uploader on it.
 * The file itself is served under `Special:FilePath/` (or from `upload.`), and
 * only those are pictures to store.
 */
function isDescriptionPage(pathname: string): boolean {
  try {
    return /^\/wiki\/File:/i.test(decodeURIComponent(pathname));
  } catch {
    return true;
  }
}

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
