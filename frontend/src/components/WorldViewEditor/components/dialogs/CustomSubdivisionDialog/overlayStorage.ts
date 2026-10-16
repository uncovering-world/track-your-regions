/**
 * The reference map as the dialog holds it (`ImageOverlaySettings`) and as the
 * database keeps it (#595, ADR-0113). The table takes PNG, JPEG or WebP only,
 * so any other image — an SVG, a GIF, a map loaded by URL — is drawn onto a
 * canvas and saved as the PNG it shows.
 */

import type { RegionImageOverlay, RegionImageOverlayBody } from '../../../../../api/regions';
import type { ImageOverlaySettings } from './ImageOverlayDialog';

/** The localStorage key the dialog kept its state under, the reference map included until #595. */
export const STORAGE_KEY_PREFIX = 'custom-subdivision-dialog-state-';

const STORED_TYPES = /^data:image\/(png|jpeg|webp);base64,/;

/** The dialog's settings for a reference map the database holds. */
export function settingsOf(overlay: RegionImageOverlay): ImageOverlaySettings {
  return {
    imageUrl: overlay.imageDataUrl,
    imageName: overlay.imageName,
    coordinates: overlay.corners,
    opacity: overlay.opacity,
    imageSize: { width: overlay.imageWidth, height: overlay.imageHeight },
  };
}

/** The image as a PNG data URL, drawn through a canvas. */
function rasterized(url: string): Promise<{ dataUrl: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const width = img.naturalWidth || img.width;
      const height = img.naturalHeight || img.height;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) return reject(new Error('This browser cannot draw the image to save it.'));
      context.drawImage(img, 0, 0);
      try {
        resolve({ dataUrl: canvas.toDataURL('image/png'), width, height });
      } catch {
        // A picture from another site that does not allow it taints the canvas.
        reject(new Error('This image cannot be saved from its address; load it from a file instead.'));
      }
    };
    img.onerror = () => reject(new Error('The image could not be read to save it.'));
    img.src = url;
  });
}

/** What the database keeps for the dialog's settings: the image as one of the raster types it takes. */
export async function overlayBodyOf(settings: ImageOverlaySettings): Promise<RegionImageOverlayBody> {
  const stored = STORED_TYPES.test(settings.imageUrl)
    ? { dataUrl: settings.imageUrl, width: settings.imageSize?.width, height: settings.imageSize?.height }
    : await rasterized(settings.imageUrl);
  return {
    imageDataUrl: stored.dataUrl,
    imageName: settings.imageName || 'Reference map',
    imageWidth: Math.max(1, Math.round(stored.width ?? 800)),
    imageHeight: Math.max(1, Math.round(stored.height ?? 600)),
    corners: settings.coordinates,
    opacity: Math.min(1, Math.max(0, settings.opacity)),
  };
}

/**
 * The reference map an earlier session left in this browser's saved state for
 * the region, if any, and a way to forget it there. Every other part of the
 * saved state stays as it was.
 */
export function legacyOverlay(regionId: number): { settings: ImageOverlaySettings | null; forget: () => void } {
  const key = `${STORAGE_KEY_PREFIX}${regionId}`;
  let state: Record<string, unknown> | null = null;
  try {
    state = JSON.parse(localStorage.getItem(key) ?? 'null') as Record<string, unknown> | null;
  } catch {
    state = null;
  }
  const settings = (state?.imageOverlaySettings as ImageOverlaySettings | null | undefined) ?? null;
  return {
    settings,
    forget: () => {
      if (!state) return;
      const rest = { ...state };
      delete rest.imageOverlaySettings;
      try {
        localStorage.setItem(key, JSON.stringify(rest));
      } catch {
        // Storage refused: the offer comes back next time, which loses nothing.
      }
    },
  };
}
