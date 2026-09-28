/**
 * Geometry and Hull API
 */

import type {
  ComputationCancelled, ComputationStartResult, ComputationStatus, ComputeComplete, ComputeProgressEvent,
  DisplayGeometryStatus, HullParams, HullPreview, HullSaved, RegenerateDisplayGeometriesResult, RegionReset,
} from './client.generated';
import { API_URL, ensureFreshToken } from './fetchUtils.js';
import {
  getGetWorldViewsRegionsByRegionIdGeometryComputeStreamUrl, getWorldViewsByWorldViewIdComputeGeometriesStatus,
  getWorldViewsByWorldViewIdDisplayGeometryStatus, getWorldViewsRegionsByRegionIdHullParams,
  postWorldViewsByWorldViewIdComputeGeometries, postWorldViewsByWorldViewIdComputeGeometriesCancel,
  postWorldViewsByWorldViewIdRegenerateDisplayGeometries, postWorldViewsRegionsByRegionIdGeometryReset,
  postWorldViewsRegionsByRegionIdHullPreview, postWorldViewsRegionsByRegionIdHullSave,
} from './client.generated';

// What every call here answers is declared once, as a backend schema (ADR-0066),
// and generated into `client.generated.ts`; the compute stream's events too. Passed
// on from here, so a component imports a call's answer from the module of the
// call.
export type {
  ComputationCancelled, ComputationStartResult, ComputationStatus, ComputeComplete, ComputeFailed, ComputeProgress,
  ComputeProgressEvent, ComputeResult, DisplayGeometryStatus, HullParams, HullPreview, HullSaved,
  RegenerateDisplayGeometriesResult, RegionReset, SavedHullParams,
} from './client.generated';

// The hull a region is drawn with until it is tuned, the same numbers the server
// builds with (ADR-0065).
export { DEFAULT_HULL_PARAMS } from '@tyr/shared/geometry';

// =============================================================================
// Geometry Computation
// =============================================================================

/**
 * Compute region geometry with SSE streaming for progress updates
 * @param regionId Region ID to compute
 * @param force Force recompute all
 * @param onProgress Callback for progress events
 * @param skipSnapping Skip expensive snapping step (fast mode)
 * @returns Promise that resolves when computation is complete
 */
export function computeRegionGeometryWithProgress(
  regionId: number,
  force: boolean,
  onProgress: (event: ComputeProgressEvent) => void,
  skipSnapping?: boolean
): Promise<ComputeComplete> {
  return new Promise((resolve, reject) => {
    // Ensure fresh token before opening EventSource (can't retry 401 on SSE).
    // EventSource sends no headers, so the token goes in the query, and the
    // generated builder gives the path, to which the API's origin is added.
    ensureFreshToken().then(token => {
      const url = API_URL + getGetWorldViewsRegionsByRegionIdGeometryComputeStreamUrl(regionId, {
        force: force ? 'true' : undefined,
        skipSnapping: skipSnapping ? 'true' : undefined,
        token: token ?? undefined,
      });

      const eventSource = new EventSource(url);

      eventSource.onmessage = (event) => {
        try {
          // Each event is held to ComputeProgressEvent on the server (writeEvent).
          const data = JSON.parse(event.data) as ComputeProgressEvent;
          onProgress(data);

          if (data.type === 'error') {
            eventSource.close();
            reject(new Error(data.message || 'Computation failed'));
          } else if (data.type === 'complete') {
            eventSource.close();
            resolve(data);
          }
        } catch (e) {
          console.error('Failed to parse SSE event:', e);
        }
      };

      eventSource.onerror = (e) => {
        console.error('SSE error:', e);
        eventSource.close();
        reject(new Error('Connection to server lost'));
      };
    }).catch(reject);
  });
}

export async function resetRegionToGADM(regionId: number): Promise<RegionReset> {
  return postWorldViewsRegionsByRegionIdGeometryReset(regionId);
}

export async function startWorldViewGeometryComputation(
  worldViewId: number,
  force: boolean = false,
  skipSnapping: boolean = true
): Promise<ComputationStartResult> {
  return postWorldViewsByWorldViewIdComputeGeometries(worldViewId, {
    force: force ? 'true' : undefined,
    skipSnapping: skipSnapping ? 'true' : undefined,
  });
}

export async function fetchWorldViewComputationStatus(worldViewId: number): Promise<ComputationStatus> {
  return getWorldViewsByWorldViewIdComputeGeometriesStatus(worldViewId);
}

export async function cancelWorldViewGeometryComputation(worldViewId: number): Promise<ComputationCancelled> {
  return postWorldViewsByWorldViewIdComputeGeometriesCancel(worldViewId);
}

// =============================================================================
// Display Geometry
// =============================================================================

export async function fetchDisplayGeometryStatus(worldViewId: number): Promise<DisplayGeometryStatus> {
  return getWorldViewsByWorldViewIdDisplayGeometryStatus(worldViewId);
}

export async function regenerateDisplayGeometries(
  worldViewId: number,
  options: { regionId?: number } = {}
): Promise<RegenerateDisplayGeometriesResult> {
  const { regionId } = options;
  return postWorldViewsByWorldViewIdRegenerateDisplayGeometries(worldViewId, regionId ? { regionId } : undefined);
}

// =============================================================================
// Hull Parameters
// =============================================================================

export async function previewHull(
  regionId: number,
  params: HullParams,
  customGeometry?: GeoJSON.Geometry
): Promise<HullPreview> {
  return postWorldViewsRegionsByRegionIdHullPreview(regionId, { ...params, customGeometry });
}

export async function saveHull(regionId: number, params: HullParams): Promise<HullSaved> {
  return postWorldViewsRegionsByRegionIdHullSave(regionId, params);
}

/**
 * The parameters a region's hull was saved with, or null where it was never
 * tuned. A failed read rejects rather than answering null: the hull editor
 * would otherwise take it for "never tuned" and offer the defaults for saving
 * over a tuned hull (#1013).
 */
export async function fetchSavedHullParams(regionId: number): Promise<HullParams | null> {
  const result = await getWorldViewsRegionsByRegionIdHullParams(regionId);
  return result.params;
}
