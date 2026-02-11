/**
 * Image Download Service
 *
 * Downloads and caches experience images locally during sync.
 * Images are stored in /data/images/experiences/{source}/{external_id}.jpg
 *
 * Wikimedia Commons images are automatically converted to CDN-cached thumbnails
 * (330px width) to avoid downloading multi-MB originals and to reduce 429 errors.
 * See: https://www.mediawiki.org/wiki/Common_thumbnail_sizes
 */

/* eslint-disable security/detect-non-literal-fs-filename -- All paths are built from sanitized source names and external IDs, not user input */

import { createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, statSync, unlinkSync } from 'fs';
import { dirname, join } from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

// Base directory for storing images (relative to backend root)
const IMAGES_BASE_DIR = join(process.cwd(), 'data', 'images', 'experiences');

// Standard Wikimedia thumbnail width (330px is a CDN-cached standard size, good for cards)
const WIKIMEDIA_THUMB_WIDTH = 330;
const MAX_RETRIES_ON_429 = 2;
const MAX_IMAGE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

// Ensure directory exists
function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Get the local file path for an experience image
 */
export function getImagePath(sourceName: string, externalId: string): string {
  // Sanitize source name and external ID for filesystem (prevent path traversal)
  const safeSourceName = sourceName.toLowerCase().replace(/[^a-z0-9]/g, '-');
  const safeExternalId = String(externalId).replace(/[^a-zA-Z0-9_-]/g, '-');
  return join(IMAGES_BASE_DIR, safeSourceName, `${safeExternalId}.jpg`);
}

/**
 * Get the URL path to serve the image (relative to API)
 */
export function getImageUrl(sourceName: string, externalId: string): string {
  const safeSourceName = sourceName.toLowerCase().replace(/[^a-z0-9]/g, '-');
  const safeExternalId = String(externalId).replace(/[^a-zA-Z0-9_-]/g, '-');
  return `/images/experiences/${safeSourceName}/${safeExternalId}.jpg`;
}

/**
 * Check if image already exists locally
 */
export function imageExists(sourceName: string, externalId: string): boolean {
  const filePath = getImagePath(sourceName, externalId);
  return existsSync(filePath);
}

/**
 * Remove all cached images for a source (used during force re-sync).
 * Deletes the entire source directory so images are re-downloaded with current logic.
 */
export function clearImages(sourceName: string): number {
  const safeSourceName = sourceName.toLowerCase().replace(/[^a-z0-9]/g, '-');
  const sourceDir = join(IMAGES_BASE_DIR, safeSourceName);
  if (!existsSync(sourceDir)) return 0;

  const count = readdirSync(sourceDir).length;

  rmSync(sourceDir, { recursive: true, force: true });
  console.log(`[ImageService] Cleared ${count} cached images for "${sourceName}"`);
  return count;
}

/**
 * Convert a Wikimedia Commons URL to a thumbnail URL.
 *
 * Handles two URL formats returned by Wikimedia:
 *
 * 1. Special:FilePath (from Wikidata SPARQL):
 *    http://commons.wikimedia.org/wiki/Special:FilePath/Louvre.jpg
 *    → adds ?width=330 parameter (server-side resize)
 *
 * 2. Direct upload URLs:
 *    .../commons/a/a7/Louvre.jpg
 *    → .../commons/thumb/a/a7/Louvre.jpg/330px-Louvre.jpg
 *
 * Standard sizes (120, 250, 330, 500, 960, 1280px) are CDN-cached.
 * Non-Wikimedia URLs pass through unchanged.
 */
function toWikimediaThumbnail(url: string, width: number = WIKIMEDIA_THUMB_WIDTH): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url; // Not a valid URL — pass through unchanged
  }

  // Special:FilePath URLs (from Wikidata SPARQL) — append ?width= parameter
  if (parsed.hostname === 'commons.wikimedia.org' && parsed.pathname.includes('Special:FilePath')) {
    const sep = parsed.search ? '&' : '?';
    return `${url}${sep}width=${width}`;
  }

  // Direct upload.wikimedia.org URLs
  if (parsed.hostname === 'upload.wikimedia.org' && !url.includes('/thumb/')) {
    const match = url.match(/^(https?:\/\/upload\.wikimedia\.org\/wikipedia\/[^/]+)\/([\da-f]\/[\da-f]{2}\/(.+))$/i);
    if (match) {
      const [, base, hashPath, filename] = match;
      const suffix = filename.toLowerCase().endsWith('.svg') ? `${filename}.png` : filename;
      return `${base}/thumb/${hashPath}/${width}px-${suffix}`;
    }
  }

  return url;
}

/**
 * Progress context for batch image downloads.
 * Pass this to get (X/Y), file size, and ETA in log output.
 */
export interface ImageDownloadProgress {
  index: number;      // 0-based current item index
  total: number;      // total items in batch
  startedAt: number;  // Date.now() when the batch started
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function formatEta(ms: number): string {
  if (ms < 1000) return '<1s';
  const totalSec = Math.ceil(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return sec > 0 ? `${min}m ${sec}s` : `${min}m`;
}

/**
 * Download an image from URL and save locally.
 * Wikimedia Commons URLs are automatically converted to thumbnails.
 * Returns the local URL path if successful, null if failed.
 */
export async function downloadImage(
  remoteUrl: string,
  sourceName: string,
  externalId: string,
  options: { force?: boolean; timeout?: number; progress?: ImageDownloadProgress } = {}
): Promise<string | null> {
  const { force = false, timeout = 30000, progress } = options;
  const filePath = getImagePath(sourceName, externalId);
  const localUrl = getImageUrl(sourceName, externalId);

  // Skip if already exists (unless force)
  if (!force && existsSync(filePath)) {
    return localUrl;
  }

  const fetchUrl = toWikimediaThumbnail(remoteUrl);

  try {
    // Ensure directory exists
    ensureDir(dirname(filePath));

    let response: Response | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES_ON_429; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      response = await fetch(fetchUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'TrackYourRegions/1.0 (https://github.com/trackyourregions; contact@trackyourregions.com)',
          'Accept-Encoding': 'gzip',
        },
      });

      clearTimeout(timeoutId);

      if (response.status !== 429) break;

      // Honor Retry-After header, fall back to exponential backoff
      const retryAfter = response.headers.get('retry-after');
      const delaySec = retryAfter ? parseInt(retryAfter) || 5 : (attempt + 1) * 5;
      console.warn(`[ImageService] 429 for ${externalId}, retrying in ${delaySec}s (attempt ${attempt + 1}/${MAX_RETRIES_ON_429})`);
      await new Promise((r) => setTimeout(r, delaySec * 1000));
    }

    if (!response || !response.ok) {
      console.warn(`[ImageService] Failed to fetch ${fetchUrl}: ${response?.status}`);
      return null;
    }

    // Check content type
    const contentType = response.headers.get('content-type');
    if (!contentType?.startsWith('image/')) {
      console.warn(`[ImageService] Not an image: ${fetchUrl} (${contentType})`);
      return null;
    }

    // Check Content-Length if provided (reject oversized downloads upfront)
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > MAX_IMAGE_SIZE_BYTES) {
      console.warn(`[ImageService] Image too large (${formatBytes(parseInt(contentLength))}): ${fetchUrl}`);
      return null;
    }

    // Stream to file with size limit enforcement
    if (!response.body) {
      console.warn(`[ImageService] No response body: ${fetchUrl}`);
      return null;
    }

    const nodeStream = Readable.fromWeb(response.body as import('stream/web').ReadableStream);
    let bytesWritten = 0;
    const sizeCheckStream = new (await import('stream')).Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytesWritten += chunk.length;
        if (bytesWritten > MAX_IMAGE_SIZE_BYTES) {
          callback(new Error(`Image exceeds ${formatBytes(MAX_IMAGE_SIZE_BYTES)} size limit`));
        } else {
          callback(null, chunk);
        }
      },
    });
    const fileStream = createWriteStream(filePath);

    await pipeline(nodeStream, sizeCheckStream, fileStream);

    // Log with progress info, file size, and ETA
    const fileSize = statSync(filePath).size;
    if (progress) {
      const done = progress.index + 1;
      const elapsed = Date.now() - progress.startedAt;
      const avgMs = elapsed / done;
      const remaining = avgMs * (progress.total - done);
      console.log(`[ImageService] (${done}/${progress.total}) ${externalId} ${formatBytes(fileSize)} — ETA: ${formatEta(remaining)}`);
    } else {
      console.log(`[ImageService] Downloaded: ${externalId} ${formatBytes(fileSize)}`);
    }

    return localUrl;
  } catch (err) {
    // Clean up partial file on error
    if (existsSync(filePath)) {
      try {
        unlinkSync(filePath);
      } catch {
        // Ignore cleanup errors
      }
    }

    if (err instanceof Error && err.name === 'AbortError') {
      console.warn(`[ImageService] Timeout downloading ${fetchUrl}`);
    } else {
      console.warn(`[ImageService] Error downloading ${fetchUrl}:`, err);
    }
    return null;
  }
}

/**
 * Legal/attribution info for a Wikimedia Commons image.
 */
export interface ImageLegalInfo {
  artist: string | null;
  license: string | null;
  licenseUrl: string | null;
  credit: string | null;
  description: string | null;
}

/**
 * Extract the Commons filename from a Wikimedia URL.
 * Handles Special:FilePath/Foo.jpg and upload.wikimedia.org/.../Foo.jpg
 */
function extractCommonsFilename(url: string): string | null {
  // Special:FilePath/Foo%20Bar.jpg
  const fpMatch = url.match(/Special:FilePath\/([^?]+)/i);
  if (fpMatch) return decodeURIComponent(fpMatch[1]);

  // upload.wikimedia.org/wikipedia/commons/a/a7/Foo.jpg
  const uploadMatch = url.match(/upload\.wikimedia\.org\/wikipedia\/[^/]+\/[\da-f]\/[\da-f]{2}\/(.+?)(?:\/|$)/i);
  if (uploadMatch) return decodeURIComponent(uploadMatch[1]);

  return null;
}

/**
 * Strip HTML tags from Wikimedia extmetadata values.
 */
function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '').trim();
}

/**
 * Fetch legal/attribution info for a Wikimedia Commons image.
 * Uses the MediaWiki API (action=query, prop=imageinfo, iiprop=extmetadata).
 */
export async function fetchImageLegalInfo(remoteUrl: string): Promise<ImageLegalInfo | null> {
  const filename = extractCommonsFilename(remoteUrl);
  if (!filename) return null;

  try {
    const apiUrl = `https://commons.wikimedia.org/w/api.php?` +
      `action=query&titles=File:${encodeURIComponent(filename)}&prop=imageinfo` +
      `&iiprop=extmetadata&iiextmetadatafilter=Artist|LicenseShortName|LicenseUrl|Credit|ImageDescription` +
      `&format=json`;

    const response = await fetch(apiUrl, {
      headers: {
        'User-Agent': 'TrackYourRegions/1.0 (https://github.com/trackyourregions; contact@trackyourregions.com)',
      },
    });

    if (!response.ok) return null;

    const data = await response.json() as {
      query?: { pages?: Record<string, { imageinfo?: { extmetadata?: Record<string, { value: string }> }[] }> };
    };

    const pages = data.query?.pages;
    if (!pages) return null;

    const page = Object.values(pages)[0];
    const meta = page?.imageinfo?.[0]?.extmetadata;
    if (!meta) return null;

    return {
      artist: meta.Artist ? stripHtml(meta.Artist.value) : null,
      license: meta.LicenseShortName ? stripHtml(meta.LicenseShortName.value) : null,
      licenseUrl: meta.LicenseUrl?.value || null,
      credit: meta.Credit ? stripHtml(meta.Credit.value) : null,
      description: meta.ImageDescription ? stripHtml(meta.ImageDescription.value) : null,
    };
  } catch (err) {
    console.warn(`[ImageService] Failed to fetch legal info for ${filename}:`, err);
    return null;
  }
}

/**
 * Download multiple images concurrently with rate limiting
 */
export async function downloadImages(
  items: { remoteUrl: string; sourceName: string; externalId: string }[],
  options: { concurrency?: number; onProgress?: (completed: number, total: number) => void } = {}
): Promise<Map<string, string | null>> {
  const { concurrency = 5, onProgress } = options;
  const results = new Map<string, string | null>();
  let completed = 0;

  // Process in batches
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (item) => {
        const localUrl = await downloadImage(item.remoteUrl, item.sourceName, item.externalId);
        return { externalId: item.externalId, localUrl };
      })
    );

    for (const { externalId, localUrl } of batchResults) {
      results.set(externalId, localUrl);
      completed++;
    }

    onProgress?.(completed, items.length);
  }

  return results;
}
