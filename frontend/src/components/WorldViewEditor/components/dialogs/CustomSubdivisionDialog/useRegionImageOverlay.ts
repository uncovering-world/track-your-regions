/**
 * The region's reference map, kept in the database (#595, ADR-0113): read when
 * the dialog opens on a region, saved whenever it is applied, taken away on
 * request. Every admin, on any machine, opens the same calibrated map.
 *
 * A map an earlier session kept only in this browser is offered once, when
 * the database has none: kept, which saves it for everyone, or discarded.
 * Until the admin answers it stays where it was; where the database has a map,
 * the browser's older copy is forgotten.
 */

import { useCallback, useEffect, useState } from 'react';
import { deleteRegionImageOverlay, fetchRegionImageOverlay, saveRegionImageOverlay } from '../../../../../api/regions';
import type { ImageOverlaySettings } from './ImageOverlayDialog';
import { legacyOverlay, overlayBodyOf, settingsOf } from './overlayStorage';

export interface RegionImageOverlayState {
  settings: ImageOverlaySettings | null;
  /** Show the map at once and save it; resolves to whether it was kept. */
  apply: (settings: ImageOverlaySettings) => Promise<boolean>;
  remove: () => Promise<void>;
  /** What went wrong saving or reading, in words; null when nothing did. */
  error: string | null;
  /** A map only this browser holds for the region, offered to be kept. */
  legacy: ImageOverlaySettings | null;
  keepLegacy: () => Promise<void>;
  discardLegacy: () => void;
}

export function useRegionImageOverlay(regionId: number | null, open: boolean): RegionImageOverlayState {
  const [settings, setSettings] = useState<ImageOverlaySettings | null>(null);
  const [legacy, setLegacy] = useState<ImageOverlaySettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || regionId === null) return undefined;
    let current = true;
    setSettings(null);
    setLegacy(null);
    setError(null);
    fetchRegionImageOverlay(regionId)
      .then((overlay) => {
        if (!current) return;
        if (overlay) {
          setSettings(settingsOf(overlay));
          // The database's map is the region's; an older copy in this browser
          // would only fill its storage.
          legacyOverlay(regionId).forget();
        } else {
          setLegacy(legacyOverlay(regionId).settings);
        }
      })
      .catch(() => {
        if (current) setError('The reference map could not be loaded.');
      });
    return () => { current = false; };
  }, [open, regionId]);

  const apply = useCallback(async (next: ImageOverlaySettings) => {
    if (regionId === null) return false;
    setSettings(next);
    setError(null);
    try {
      await saveRegionImageOverlay(regionId, await overlayBodyOf(next));
      return true;
    } catch (e) {
      setError(`The reference map is shown but was not saved: ${e instanceof Error ? e.message : 'the save failed'}`);
      return false;
    }
  }, [regionId]);

  const remove = useCallback(async () => {
    if (regionId === null) return;
    setError(null);
    try {
      await deleteRegionImageOverlay(regionId);
      setSettings(null);
    } catch {
      setError('The reference map could not be removed.');
    }
  }, [regionId]);

  const keepLegacy = useCallback(async () => {
    if (regionId === null || !legacy) return;
    // Forgotten in this browser only once it is kept for everyone.
    if (!(await apply(legacy))) return;
    legacyOverlay(regionId).forget();
    setLegacy(null);
  }, [apply, legacy, regionId]);

  const discardLegacy = useCallback(() => {
    if (regionId !== null) legacyOverlay(regionId).forget();
    setLegacy(null);
  }, [regionId]);

  return { settings, apply, remove, error, legacy, keepLegacy, discardLegacy };
}
