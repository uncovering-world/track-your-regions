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
 * - Local/relative URLs: pass through unchanged
 */
export function toThumbnailUrl(url: string, width = 120): string {
  if (url.includes('Special:FilePath')) {
    return url.replace('http://', 'https://') + `?width=${width}`;
  }
  // Only proxy trusted remote URLs through wsrv.nl
  if (url.startsWith('http://') || url.startsWith('https://')) {
    if (!isTrustedImageUrl(url)) return '';
    return `https://wsrv.nl/?url=${encodeURIComponent(url)}&w=${width}&q=80`;
  }
  return url;
}

/**
 * Extract image URL from potentially JSON-encoded image_url field.
 * Validates that remote URLs belong to trusted domains.
 * Handles both local paths (served from our backend) and remote URLs.
 */
export function extractImageUrl(imageUrl: string | null): string | null {
  if (!imageUrl) return null;

  // Handle JSON-encoded URLs (legacy format)
  if (imageUrl.startsWith('{')) {
    try {
      const parsed = JSON.parse(imageUrl) as { url?: string };
      const url = parsed.url ?? null;
      if (url && (url.startsWith('http://') || url.startsWith('https://')) && !isTrustedImageUrl(url)) return null;
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
  if ((imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) && !isTrustedImageUrl(imageUrl)) {
    return null;
  }

  return imageUrl;
}
