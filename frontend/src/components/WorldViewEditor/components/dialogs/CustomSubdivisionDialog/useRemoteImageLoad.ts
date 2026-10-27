import { useState, useCallback } from 'react';
import { fetchImageViaProxy } from '../../../../../api/admin';

/** An image loaded from an address, as the overlay dialog holds it. */
export interface RemoteImage {
  /** A data URL where the image could be read, the address itself as a last resort. */
  imageUrl: string;
  imageName: string;
  /** The address it was loaded from, whose credit it carries (#2087). */
  sourceUrl: string;
  imageSize: { width: number; height: number };
}

// Convert an image element to a data URL via canvas
function imageToDataUrl(img: HTMLImageElement): string | null {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(img, 0, 0);
      return canvas.toDataURL('image/png');
    }
  } catch { /* tainted canvas */ }
  return null;
}

function sizeOf(img: HTMLImageElement) {
  return { width: img.naturalWidth || img.width, height: img.naturalHeight || img.height };
}

/**
 * Load an image from a remote URL (e.g., region map).
 * Tries direct CORS load first, then falls back to backend proxy for Wikimedia URLs.
 */
export function useRemoteImageLoad(onLoaded: (image: RemoteImage) => void) {
  const [loading, setLoading] = useState(false);

  // Fetch image through backend proxy to bypass CORS (for Wikimedia URLs)
  const loadViaProxy = useCallback(async (url: string, name: string) => {
    try {
      const blob = await fetchImageViaProxy(url);
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const img = new Image();
        img.onload = () => {
          onLoaded({ imageUrl: dataUrl, imageName: name, sourceUrl: url, imageSize: sizeOf(img) });
          setLoading(false);
        };
        img.onerror = () => {
          console.warn('Failed to load proxied image');
          setLoading(false);
        };
        img.src = dataUrl;
      };
      reader.readAsDataURL(blob);
    } catch (err) {
      console.warn('Image proxy failed, using URL directly:', err);
      // Last resort: use URL directly (works for <img> but not MapLibre overlay)
      onLoaded({ imageUrl: url, imageName: name, sourceUrl: url, imageSize: { width: 800, height: 600 } });
      setLoading(false);
    }
  }, [onLoaded]);

  const loadFromUrl = useCallback((url: string, name: string) => {
    setLoading(true);

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const dataUrl = imageToDataUrl(img);
      if (!dataUrl) {
        // Canvas tainted — shouldn't happen if crossOrigin worked, but fallback via proxy
        loadViaProxy(url, name);
        return;
      }
      onLoaded({ imageUrl: dataUrl, imageName: name, sourceUrl: url, imageSize: sizeOf(img) });
      setLoading(false);
    };
    img.onerror = () => {
      // CORS blocked — try backend proxy for Wikimedia URLs
      loadViaProxy(url, name);
    };
    img.src = url;
  }, [loadViaProxy, onLoaded]);

  return { loadFromUrl, loading };
}
