/**
 * Image URL utilities for stored pictures: an experience's or a work's
 * `image_url`, and a region's imported map (`region_map_url`, #694).
 *
 * Handles the licence allowlist (ADR-0043) and the sizes Wikimedia's own CDN serves.
 * Extracted from useExperienceContext for reuse across components.
 */

import {
  isPictureHost, isUploadHost, isCommonsPath, isDescriptionPage, namesAPictureFile,
} from '@tyr/shared/pictures';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

/*
 * Which hosts a stored picture may be drawn from, and what names a picture
 * file, are the storing side's rule as much as this side's: declared once in
 * `@tyr/shared/pictures` (ADR-0065), with the licence reasoning (ADR-0043) —
 * `whc.unesco.org` and `data.unesco.org` came off that list with #557, and the
 * 1260 rows that pointed there are answered from Commons instead. A card whose
 * picture is not on Commons shows no picture and keeps the link to the
 * property's own page, which those terms invite. What this module adds is the
 * drawing side's use of the rule: what an `<img src>` may be handed, and how
 * a Commons file is asked for at a size.
 */

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
    const { hostname, pathname } = new URL(url);
    return isPictureHost(hostname)
      && isCommonsPath(hostname, pathname)
      && !isDescriptionPage(pathname)
      && namesAPictureFile(pathname);
  } catch {
    return false;
  }
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
    if (!isUploadHost(parsed.hostname)) return null;
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
 * There is no third-party resizer here, and that is the point of #557: every
 * picture the catalogue stores is a Commons file, and Commons sizes its own
 * files. A free service such as `wsrv.nl` — undocumented, with no agreement
 * behind it, and free to change what it answers or refuse a large original —
 * is nowhere on a reader's path.
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
