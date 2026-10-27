import { afterEach, describe, expect, it } from 'vitest';
import { legacyOverlay, overlayBodyOf, settingsOf, STORAGE_KEY_PREFIX } from './overlayStorage';
import type { ImageOverlaySettings } from './ImageOverlayDialog';

const PNG_URL = 'data:image/png;base64,iVBORw0KGgo=';
const CORNERS: ImageOverlaySettings['coordinates'] = [[2.5, 51.5], [5.9, 51.5], [5.9, 50.7], [2.5, 50.7]];
const SETTINGS: ImageOverlaySettings = {
  imageUrl: PNG_URL, imageName: 'Provinces of Flanders.png', coordinates: CORNERS, opacity: 0.7, imageSize: { width: 1200, height: 800 },
};

afterEach(() => localStorage.clear());

describe('the reference map, between the dialog and the database (#595)', () => {
  it('sends a raster data URL as it is, with its size, corners and opacity', async () => {
    expect(await overlayBodyOf(SETTINGS)).toEqual({
      imageDataUrl: PNG_URL, imageName: 'Provinces of Flanders.png', imageWidth: 1200, imageHeight: 800, corners: CORNERS, opacity: 0.7,
      sourceUrl: null,
    });
  });

  it('keeps the region map it was loaded from, whose credit it carries (#2087)', async () => {
    const BELGIUM_MAP = 'https://commons.wikimedia.org/wiki/Special:FilePath/be-map.png';
    expect(await overlayBodyOf({ ...SETTINGS, sourceUrl: BELGIUM_MAP })).toMatchObject({ sourceUrl: BELGIUM_MAP });
  });

  it('reads back what it saved as the settings the dialog draws', () => {
    expect(settingsOf({
      regionId: 9311, imageDataUrl: PNG_URL, imageName: 'Provinces of Flanders.png', imageWidth: 1200, imageHeight: 800,
      corners: CORNERS, opacity: 0.7, updatedAt: '2026-10-16T12:00:00.000Z', sourceUrl: null,
    })).toEqual({ ...SETTINGS, sourceUrl: null });
  });
});

describe('a reference map an earlier session kept in this browser (#595)', () => {
  const key = `${STORAGE_KEY_PREFIX}9311`;

  it('is found in the saved state, and forgotten there alone', () => {
    localStorage.setItem(key, JSON.stringify({ activeTab: 1, imageOverlaySettings: SETTINGS }));
    const legacy = legacyOverlay(9311);
    expect(legacy.settings).toEqual(SETTINGS);

    legacy.forget();
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual({ activeTab: 1 });
    expect(legacyOverlay(9311).settings).toBeNull();
  });

  it('is none where the browser kept nothing, or nothing readable', () => {
    expect(legacyOverlay(9311).settings).toBeNull();
    localStorage.setItem(key, '{not json');
    expect(legacyOverlay(9311).settings).toBeNull();
  });
});
