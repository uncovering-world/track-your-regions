/**
 * Image Path Service
 *
 * Provides path/URL utilities for locally-cached experience images.
 * Images are stored in /data/images/experiences/{source}/{external_id}.jpg
 */

/* eslint-disable security/detect-non-literal-fs-filename -- All paths are built from sanitized source names and external IDs, not user input */

import { existsSync } from 'fs';
import { join } from 'path';

// Base directory for storing images (relative to backend root)
const IMAGES_BASE_DIR = join(process.cwd(), 'data', 'images', 'experiences');

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
