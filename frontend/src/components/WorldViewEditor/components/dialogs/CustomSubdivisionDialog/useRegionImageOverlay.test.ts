import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageOverlaySettings } from './ImageOverlayDialog';
import { STORAGE_KEY_PREFIX } from './overlayStorage';

const api = vi.hoisted(() => ({
  fetchRegionImageOverlay: vi.fn(),
  saveRegionImageOverlay: vi.fn(),
  deleteRegionImageOverlay: vi.fn(),
}));
vi.mock('../../../../../api/regions', () => api);

const { useRegionImageOverlay } = await import('./useRegionImageOverlay');

const SETTINGS: ImageOverlaySettings = {
  imageUrl: 'data:image/png;base64,iVBORw0KGgo=', imageName: 'Provinces of Flanders.png',
  coordinates: [[2.5, 51.5], [5.9, 51.5], [5.9, 50.7], [2.5, 50.7]], opacity: 0.7, imageSize: { width: 1200, height: 800 },
};
const key = `${STORAGE_KEY_PREFIX}9311`;

beforeEach(() => {
  api.fetchRegionImageOverlay.mockReset();
  api.saveRegionImageOverlay.mockReset();
  api.deleteRegionImageOverlay.mockReset();
});
afterEach(() => localStorage.clear());

describe('useRegionImageOverlay (#595)', () => {
  it('opens on the map the database holds, and saves one that is applied', async () => {
    api.fetchRegionImageOverlay.mockResolvedValue({
      regionId: 9311, imageDataUrl: SETTINGS.imageUrl, imageName: SETTINGS.imageName, imageWidth: 1200, imageHeight: 800,
      corners: SETTINGS.coordinates, opacity: 0.7, updatedAt: '2026-10-16T12:00:00.000Z',
    });
    api.saveRegionImageOverlay.mockResolvedValue(undefined);
    const { result } = renderHook(() => useRegionImageOverlay(9311, true));
    await waitFor(() => expect(result.current.settings).toEqual(SETTINGS));
    expect(result.current.legacy).toBeNull();

    await act(async () => { await result.current.apply({ ...SETTINGS, opacity: 0.4 }); });
    expect(api.saveRegionImageOverlay).toHaveBeenCalledWith(9311, expect.objectContaining({ opacity: 0.4 }));
  });

  it("forgets the browser's older copy where the database holds a map", async () => {
    localStorage.setItem(key, JSON.stringify({ activeTab: 1, imageOverlaySettings: { ...SETTINGS, imageName: 'Old.png' } }));
    api.fetchRegionImageOverlay.mockResolvedValue({
      regionId: 9311, imageDataUrl: SETTINGS.imageUrl, imageName: SETTINGS.imageName, imageWidth: 1200, imageHeight: 800,
      corners: SETTINGS.coordinates, opacity: 0.7, updatedAt: '2026-10-16T12:00:00.000Z',
    });
    const { result } = renderHook(() => useRegionImageOverlay(9311, true));
    await waitFor(() => expect(result.current.settings).toEqual(SETTINGS));
    expect(result.current.legacy).toBeNull();
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual({ activeTab: 1 });
  });

  it("offers a map only this browser holds, and forgets it there once it is kept", async () => {
    localStorage.setItem(key, JSON.stringify({ activeTab: 1, imageOverlaySettings: SETTINGS }));
    api.fetchRegionImageOverlay.mockResolvedValue(null);
    api.saveRegionImageOverlay.mockResolvedValue(undefined);
    const { result } = renderHook(() => useRegionImageOverlay(9311, true));
    await waitFor(() => expect(result.current.legacy).toEqual(SETTINGS));

    await act(async () => { await result.current.keepLegacy(); });
    expect(api.saveRegionImageOverlay).toHaveBeenCalledTimes(1);
    expect(result.current.settings).toEqual(SETTINGS);
    expect(result.current.legacy).toBeNull();
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual({ activeTab: 1 });
  });

  it('keeps the browser\'s copy when saving it fails, and says so', async () => {
    localStorage.setItem(key, JSON.stringify({ imageOverlaySettings: SETTINGS }));
    api.fetchRegionImageOverlay.mockResolvedValue(null);
    api.saveRegionImageOverlay.mockRejectedValue(new Error('the image is too large'));
    const { result } = renderHook(() => useRegionImageOverlay(9311, true));
    await waitFor(() => expect(result.current.legacy).toEqual(SETTINGS));

    await act(async () => { await result.current.keepLegacy(); });
    expect(result.current.error).toMatch(/not saved: the image is too large/);
    expect(result.current.legacy).toEqual(SETTINGS);
    expect(JSON.parse(localStorage.getItem(key)!).imageOverlaySettings).toEqual(SETTINGS);
  });

  it('takes the map away on request', async () => {
    api.fetchRegionImageOverlay.mockResolvedValue(null);
    api.deleteRegionImageOverlay.mockResolvedValue(undefined);
    const { result } = renderHook(() => useRegionImageOverlay(9311, true));
    await act(async () => { await result.current.apply(SETTINGS); });
    await act(async () => { await result.current.remove(); });
    expect(api.deleteRegionImageOverlay).toHaveBeenCalledWith(9311);
    expect(result.current.settings).toBeNull();
  });
});
