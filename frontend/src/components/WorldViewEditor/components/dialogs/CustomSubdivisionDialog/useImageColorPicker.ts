import { useState, useCallback, useRef, useEffect } from 'react';
import { API_URL, getAccessToken } from '../../../../../api/fetchUtils';
import type { SubdivisionGroup } from './types';
import type { ImageOverlaySettings } from './ImageOverlayDialog';

interface UseImageColorPickerParams {
  imageOverlaySettings: ImageOverlaySettings | null;
  selectedGroupIdx: number | 'unassigned' | null;
  subdivisionGroups: SubdivisionGroup[];
  setSubdivisionGroups: React.Dispatch<React.SetStateAction<SubdivisionGroup[]>>;
}

export function useImageColorPicker({
  imageOverlaySettings,
  selectedGroupIdx,
  subdivisionGroups,
  setSubdivisionGroups,
}: UseImageColorPickerParams) {
  const colorCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sideImageRef = useRef<HTMLImageElement | null>(null);
  const eyedropperAbortRef = useRef<AbortController | null>(null);
  const [eyedropperActive, setEyedropperActive] = useState(false);

  // Draw side-by-side image to hidden canvas for pixel sampling
  // For cross-origin URLs, fetch via backend proxy to avoid canvas taint
  useEffect(() => {
    if (!imageOverlaySettings?.imageUrl) {
      colorCanvasRef.current = null;
      return;
    }
    let cancelled = false;
    let blobUrlToRevoke: string | null = null;
    const drawToCanvas = (src: string) => {
      const img = new Image();
      img.onload = () => {
        if (cancelled) return;
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          colorCanvasRef.current = canvas;
        }
      };
      img.src = src;
    };

    const url = imageOverlaySettings.imageUrl;
    const isLocal = url.startsWith('data:') || url.startsWith('blob:');
    if (isLocal) {
      drawToCanvas(url);
    } else {
      // Fetch through proxy to get a CORS-safe blob URL
      const proxyUrl = `${API_URL}/api/admin/image-proxy?url=${encodeURIComponent(url)}`;
      const token = getAccessToken();
      fetch(proxyUrl, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
        .then(r => { if (!r.ok) throw new Error(`Proxy ${r.status}`); return r.blob(); })
        .then(blob => {
          if (cancelled) return;
          const blobUrl = URL.createObjectURL(blob);
          blobUrlToRevoke = blobUrl;
          drawToCanvas(blobUrl);
        })
        .catch(() => {
          // Last resort: try direct (will taint canvas but at least we tried)
          if (!cancelled) drawToCanvas(url);
        });
    }
    return () => {
      cancelled = true;
      if (blobUrlToRevoke) URL.revokeObjectURL(blobUrlToRevoke);
    };
  }, [imageOverlaySettings?.imageUrl]);

  // Cancel eyedropper on Escape
  useEffect(() => {
    if (!eyedropperActive) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setEyedropperActive(false);
        eyedropperAbortRef.current?.abort();
        eyedropperAbortRef.current = null;
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [eyedropperActive]);

  // Clean up eyedropper on unmount
  useEffect(() => {
    return () => {
      eyedropperAbortRef.current?.abort();
    };
  }, []);

  // Boost saturation of a hex color to make it more vivid
  const saturateColor = useCallback((hex: string): string => {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      else if (max === g) h = ((b - r) / d + 2) / 6;
      else h = ((r - g) / d + 4) / 6;
    }
    // Boost saturation: increase by 40%, cap at 1.0; also clamp lightness to 0.25–0.55
    const newS = Math.min(1, s * 1.4 + 0.1);
    const newL = Math.max(0.25, Math.min(0.55, l));
    // HSL to RGB
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const q2 = newL < 0.5 ? newL * (1 + newS) : newL + newS - newL * newS;
    const p2 = 2 * newL - q2;
    const rr = Math.round(hue2rgb(p2, q2, h + 1/3) * 255);
    const gg = Math.round(hue2rgb(p2, q2, h) * 255);
    const bb = Math.round(hue2rgb(p2, q2, h - 1/3) * 255);
    return `#${rr.toString(16).padStart(2, '0')}${gg.toString(16).padStart(2, '0')}${bb.toString(16).padStart(2, '0')}`;
  }, []);

  // Sample pixel color from side-by-side image
  const handleSideImageClick = useCallback((e: React.MouseEvent<HTMLImageElement>) => {
    if (!eyedropperActive || typeof selectedGroupIdx !== 'number') return;
    const canvas = colorCanvasRef.current;
    const img = e.currentTarget;
    if (!canvas) return;

    // Map click position to image pixel coordinates
    const rect = img.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const pixelX = Math.floor(clickX * scaleX);
    const pixelY = Math.floor(clickY * scaleY);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    try {
      const pixel = ctx.getImageData(pixelX, pixelY, 1, 1).data;
      const hex = `#${pixel[0].toString(16).padStart(2, '0')}${pixel[1].toString(16).padStart(2, '0')}${pixel[2].toString(16).padStart(2, '0')}`;
      const targetIdx = selectedGroupIdx;
      setSubdivisionGroups(prev => prev.map((g, i) =>
        i === targetIdx ? { ...g, color: saturateColor(hex) } : g
      ));
    } catch (err) {
      console.warn('Failed to sample pixel color:', err);
    }
    setEyedropperActive(false);
  }, [eyedropperActive, selectedGroupIdx, setSubdivisionGroups, saturateColor]);

  // Activate the eyedropper (native EyeDropper API or canvas fallback)
  const activateEyedropper = useCallback(() => {
    if (typeof selectedGroupIdx !== 'number') return;
    if (eyedropperActive) {
      setEyedropperActive(false);
      return;
    }
    // If native EyeDropper API is available, use it (nicer UX with magnifier)
    if ('EyeDropper' in window) {
      const targetIdx = selectedGroupIdx;
      eyedropperAbortRef.current?.abort();
      const controller = new AbortController();
      eyedropperAbortRef.current = controller;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dropper = new (window as any).EyeDropper();
      dropper.open({ signal: controller.signal })
        .then((result: { sRGBHex: string }) => {
          setSubdivisionGroups(prev => prev.map((g, i) =>
            i === targetIdx ? { ...g, color: saturateColor(result.sRGBHex) } : g
          ));
        })
        .catch((err: Error) => {
          if (err.name !== 'AbortError') {
            console.warn('Eyedropper cancelled:', err);
          }
        })
        .finally(() => {
          eyedropperAbortRef.current = null;
        });
    } else {
      // Fallback: canvas-based — enter pick mode, click on image to sample
      setEyedropperActive(true);
    }
  }, [selectedGroupIdx, eyedropperActive, setSubdivisionGroups, saturateColor]);

  return {
    sideImageRef,
    eyedropperActive,
    handleSideImageClick,
    activateEyedropper,
    subdivisionGroups,
  };
}
