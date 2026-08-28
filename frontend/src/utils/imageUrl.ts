/**
 * Image URL utilities for experience images
 *
 * Handles trusted domain validation, Wikimedia thumbnail URLs, and image proxying.
 * Extracted from useExperienceContext for reuse across components.
 */

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

/**
 * Trusted domains for image URLs stored in the database.
 * Only URLs from these domains will be rendered or proxied.
 */
const TRUSTED_IMAGE_DOMAINS = [
  'commons.wikimedia.org',
  'upload.wikimedia.org',
  'whc.unesco.org',
  'data.unesco.org',
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
 * and equally a scheme nobody has thought of yet. The write path does not
 * already hold this line for `image_url`: `safeUrl` matches its denylist
 * against the value as sent, so `" javascript:…"` is stored today (#693). This
 * is the check that runs where the value meets the DOM (#449).
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
 * Check if a remote URL belongs to a trusted image domain.
 */
function isTrustedImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return TRUSTED_IMAGE_DOMAINS.some(domain => parsed.hostname === domain || parsed.hostname.endsWith('.' + domain));
  } catch {
    return false;
  }
}

/**
 * Convert an image URL to a properly-sized thumbnail URL.
 * - Wikimedia Special:FilePath URLs: uses native ?width= param (CDN-cached)
 * - Other trusted remote URLs (e.g., UNESCO): uses wsrv.nl image proxy for resizing
 * - Untrusted remote URLs: rejected (returns empty string)
 * - Unrenderable URLs (any scheme but http/https, and any path that resolves to
 *   a host other than ours): rejected (returns empty string)
 * - Local paths on our own origin: pass through unchanged
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
  // Only proxy trusted remote URLs through wsrv.nl
  if (isRemoteHttpUrl(url)) {
    return `https://wsrv.nl/?url=${encodeURIComponent(url)}&w=${width}&q=80`;
  }
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
