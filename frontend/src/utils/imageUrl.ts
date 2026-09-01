/**
 * Image URL utilities for stored pictures: an experience's or a work's
 * `image_url`, and a region's imported map (`region_map_url`, #694).
 *
 * Handles the licence allowlist (ADR-0043) and the sizes Wikimedia's own CDN serves.
 * Extracted from useExperienceContext for reuse across components.
 */

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

/**
 * The hosts a stored picture may be drawn from.
 *
 * A licence question rather than a security one (ADR-0043): a Wikimedia Commons
 * file is published to be reused with its author named, which `ImageCreditLine`
 * does, while the World Heritage Centre's terms say its photographs "may not be
 * copied or retransmitted by any means" and that a site may "only link to, not
 * replicate" them — so `whc.unesco.org` and `data.unesco.org` came off this list
 * with #557, and the 1260 rows that pointed there are answered from Commons
 * instead. A card whose picture is not on Commons shows no picture and keeps the
 * link to the property's own page, which those terms invite.
 *
 * The storing side holds the same list, as `DISPLAYABLE_PICTURE_HOSTS`
 * (`backend/src/types/urlSafety.ts`); no import can cross that boundary (#527),
 * so `urlSafety.test.ts` reads this declaration and pins the two together.
 */
const TRUSTED_IMAGE_DOMAINS = [
  'commons.wikimedia.org',
  'upload.wikimedia.org',
];

/**
 * A base with no other purpose than resolving a value that names no host of its
 * own, so the parser can say whether the value introduces one.
 */
const SAME_ORIGIN_PROBE = 'https://same-origin.invalid';

/**
 * Does this value name a host over http(s), rather than a path on our own origin?
 */
function isRemoteHttpUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://');
}

/**
 * May this value be handed to an `<img src>` at all?
 *
 * An allowlist of what is renderable, not a denylist of what is not: a stored
 * image url is either an absolute http(s) url or a path on our own origin, and
 * everything else is refused — `javascript:`, `data:`, `vbscript:`, `blob:`,
 * and equally a scheme nobody has thought of yet. The write path holds the same
 * line for a curator's `image_url` since #693 — the same allowlist, put to the
 * same parser. This check is load-bearing all the same: a sync writes that
 * column through no request schema at all, and every row already stored was
 * written before the rule. This is the check that runs where the value meets
 * the DOM (#449).
 */
function isRenderableImageUrl(url: string): boolean {
  if (isRemoteHttpUrl(url)) return true;
  // Everything else has to be a path on our own origin, and only a URL parser
  // can say whether it is one. `//host/x` names an authority; so do `/\host/x`
  // and `/<tab>/host/x`, because a browser rewrites `\` to `/` and drops tab,
  // LF and CR before it parses. Resolving against a base of our own and asking
  // whether the origin survived answers all of them at once, including the
  // variant nobody has thought of.
  if (!url.startsWith('/')) return false;
  try {
    return new URL(url, SAME_ORIGIN_PROBE).origin === SAME_ORIGIN_PROBE;
  } catch {
    return false;
  }
}

/**
 * Check if a remote URL belongs to a trusted image domain — and, on the one
 * host that serves every wiki's uploads, that the file is actually Commons'.
 *
 * `upload.wikimedia.org` carries the files of every Wikimedia project, and only
 * those under `/wikipedia/commons/` are Commons files. A language edition's own
 * uploads sit beside them, and the English Wikipedia's include fair-use files
 * that no licence lets this product draw. The storing side asks the same
 * question (`isCommonsPictureUrl`, `backend/src/types/urlSafety.ts`).
 */
function isTrustedImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const trustedHost = TRUSTED_IMAGE_DOMAINS.some(
      domain => parsed.hostname === domain || parsed.hostname.endsWith('.' + domain),
    );
    const uploadHost = parsed.hostname === 'upload.wikimedia.org'
      || parsed.hostname.endsWith('.upload.wikimedia.org');
    const commonsFile = !uploadHost || parsed.pathname.includes('/wikipedia/commons/');
    return trustedHost && commonsFile && !isDescriptionPage(parsed.pathname) && namesAPictureFile(parsed.pathname);
  } catch {
    return false;
  }
}

/**
 * The file types a picture may be, read from the name it is served under — the
 * same list the storing side holds (`PICTURE_EXTENSIONS`, `urlSafety.ts`), and
 * pinned to it by `urlSafety.test.ts`, which reads this declaration as it reads
 * the host list above. A Commons *page* — a category, a file's description —
 * sits on the same host and answers HTML, which an `<img>` draws as nothing;
 * and Commons serves PDFs, videos and scanned books under the same
 * `Special:FilePath` shape.
 */
const PICTURE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg', '.tif', '.tiff', '.avif'];

/**
 * The page *about* a file rather than the file: `/wiki/File:Louvre.jpg` ends
 * like a picture and answers HTML. The file is under `Special:FilePath/`.
 */
function isDescriptionPage(pathname: string): boolean {
  try {
    return /^\/wiki\/File:/i.test(decodeURIComponent(pathname));
  } catch {
    return true;
  }
}

function namesAPictureFile(pathname: string): boolean {
  let name: string;
  try {
    name = decodeURIComponent(pathname).toLowerCase();
  } catch {
    return false;
  }
  return PICTURE_EXTENSIONS.some(ext => name.endsWith(ext));
}

/**
 * The same Commons file, named the way `Special:FilePath` names it.
 *
 * `upload.wikimedia.org` serves the bytes and offers no sizing of its own, so a
 * picture stored in that form would reach a reader at whatever the photographer
 * uploaded — the multi-megabyte download #557 is about. Commons resizes any file
 * it holds, and the file name is the last segment of both shapes, including the
 * `/thumb/…/330px-Name.jpg` one, whose own last segment is a rendering rather
 * than the file. Only `/wikipedia/commons/` is rewritten: a picture uploaded to
 * one language's own wiki is not on Commons, and asking Commons for it answers
 * nothing.
 */
function commonsFilePathUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    // The same host test the trust gate applies: a subdomain of the upload host
    // is the upload host, and a file there is sized through Commons like any other.
    const uploadHost = parsed.hostname === 'upload.wikimedia.org'
      || parsed.hostname.endsWith('.upload.wikimedia.org');
    if (!uploadHost) return null;
    if (!parsed.pathname.includes('/wikipedia/commons/')) return null;
    const segments = parsed.pathname.split('/').filter(Boolean);
    const name = segments[segments.length - (parsed.pathname.includes('/thumb/') ? 2 : 1)];
    return name ? `https://commons.wikimedia.org/wiki/Special:FilePath/${name}` : null;
  } catch {
    return null;
  }
}

/**
 * Convert an image URL to a properly-sized thumbnail URL.
 * - Wikimedia `Special:FilePath` URLs: uses the native `?width=` parameter, which
 *   Wikimedia's own CDN answers at the documented sizes
 * - `upload.wikimedia.org` files: asked for through `Special:FilePath`, which is
 *   the same file with a size attached
 * - Untrusted remote URLs: rejected (returns empty string)
 * - Unrenderable URLs (any scheme but http/https, and any path that resolves to
 *   a host other than ours): rejected (returns empty string)
 * - Local paths on our own origin: pass through unchanged
 *
 * There is no third-party resizer here any more, and that is the point of #557:
 * every picture the catalogue stores is now a Commons file, and Commons sizes
 * its own files. What used to sit here was `wsrv.nl` — a free service on the
 * path of four reader-facing pictures in five, undocumented, with no agreement
 * behind it, which answered the same URL three different ways in three weeks and
 * still refuses a 71-megapixel original outright.
 *
 * Callers pass raw stored values here as well as ones already through
 * `extractImageUrl`, so this function checks for itself rather than assuming.
 */
export function toThumbnailUrl(url: string, width = 120): string {
  if (!isRenderableImageUrl(url)) return '';
  // Both tests below come first for the same reason: `Special:FilePath` is a
  // substring match, and a url can carry those words while its host is one we
  // do not trust.
  if (isRemoteHttpUrl(url) && !isTrustedImageUrl(url)) return '';
  if (url.includes('Special:FilePath')) {
    return url.replace('http://', 'https://') + `?width=${width}`;
  }
  const throughCommons = isRemoteHttpUrl(url) ? commonsFilePathUrl(url) : null;
  if (throughCommons) return `${throughCommons}?width=${width}`;
  return url;
}

/**
 * Extract image URL from potentially JSON-encoded image_url field.
 * Validates that remote URLs belong to trusted domains, and that the value is
 * renderable at all — anything else answers null rather than reaching an `<img>`.
 * Handles both local paths (served from our backend) and remote URLs.
 */
export function extractImageUrl(imageUrl: string | null): string | null {
  if (!imageUrl) return null;

  // Handle JSON-encoded URLs (legacy format)
  if (imageUrl.startsWith('{')) {
    try {
      const parsed = JSON.parse(imageUrl) as { url?: string };
      const url = parsed.url ?? null;
      if (!url || !isRenderableImageUrl(url)) return null;
      if (isRemoteHttpUrl(url) && !isTrustedImageUrl(url)) return null;
      return url;
    } catch {
      return null;
    }
  }

  // Handle local paths (from our backend) - prepend API URL
  if (imageUrl.startsWith('/images/')) {
    return `${API_URL}${imageUrl}`;
  }

  // Remote URL - validate against trusted domains
  if (!isRenderableImageUrl(imageUrl)) return null;
  if (isRemoteHttpUrl(imageUrl) && !isTrustedImageUrl(imageUrl)) return null;

  return imageUrl;
}
