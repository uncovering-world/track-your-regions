/**
 * Geometry and Hull API
 */

import type {
  ComputationCancelled, ComputationStartResult, ComputationStatus, ComputeComplete, ComputeProgressEvent,
  DisplayGeometryStatus, HullParams, HullPreview, HullSaved, RegenerateDisplayGeometriesResult, RegionReset,
  SavedHullParams,
} from '@tyr/shared/api';
import { API_URL, authFetchJson, ensureFreshToken } from './fetchUtils.js';

// What every call here answers is declared once, as a backend schema (ADR-0066),
// and generated into `@tyr/shared/api`; the compute stream's events too. Passed
// on from here, so a component imports a call's answer from the module of the
// call.
export type {
  ComputationCancelled, ComputationStartResult, ComputationStatus, ComputeComplete, ComputeFailed, ComputeProgress,
  ComputeProgressEvent, ComputeResult, DisplayGeometryStatus, HullParams, HullPreview, HullSaved,
  RegenerateDisplayGeometriesResult, RegionReset, SavedHullParams,
} from '@tyr/shared/api';

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
    const params = new URLSearchParams();
    if (force) params.append('force', 'true');
    if (skipSnapping) params.append('skipSnapping', 'true');

    // Ensure fresh token before opening EventSource (can't retry 401 on SSE)
    ensureFreshToken().then(token => {
      if (token) params.append('token', token);
      const finalQuery = params.toString();
      const url = `${API_URL}/api/world-views/regions/${regionId}/geometry/compute-stream${finalQuery ? '?' + finalQuery : ''}`;

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
  return authFetchJson<RegionReset>(`${API_URL}/api/world-views/regions/${regionId}/geometry/reset`, { method: 'POST' });
}

export async function startWorldViewGeometryComputation(
  worldViewId: number,
  force: boolean = false,
  skipSnapping: boolean = true
): Promise<ComputationStartResult> {
  const params = new URLSearchParams();
  if (force) params.append('force', 'true');
  if (skipSnapping) params.append('skipSnapping', 'true');
  const queryString = params.toString();
  const url = `${API_URL}/api/world-views/${worldViewId}/compute-geometries${queryString ? '?' + queryString : ''}`;
  return authFetchJson<ComputationStartResult>(url, { method: 'POST' });
}

export async function fetchWorldViewComputationStatus(worldViewId: number): Promise<ComputationStatus> {
  return authFetchJson<ComputationStatus>(`${API_URL}/api/world-views/${worldViewId}/compute-geometries/status`);
}

export async function cancelWorldViewGeometryComputation(worldViewId: number): Promise<ComputationCancelled> {
  return authFetchJson<ComputationCancelled>(`${API_URL}/api/world-views/${worldViewId}/compute-geometries/cancel`, {
    method: 'POST',
  });
}

// =============================================================================
// Display Geometry
// =============================================================================

export async function fetchDisplayGeometryStatus(worldViewId: number): Promise<DisplayGeometryStatus> {
  return authFetchJson<DisplayGeometryStatus>(`${API_URL}/api/world-views/${worldViewId}/display-geometry-status`);
}

export async function regenerateDisplayGeometries(
  worldViewId: number,
  options: { regionId?: number } = {}
): Promise<RegenerateDisplayGeometriesResult> {
  const { regionId } = options;
  const params = new URLSearchParams();
  if (regionId) params.append('regionId', String(regionId));
  const queryString = params.toString();
  const querySuffix = queryString ? `?${queryString}` : '';
  const url = `${API_URL}/api/world-views/${worldViewId}/regenerate-display-geometries${querySuffix}`;
  return authFetchJson<RegenerateDisplayGeometriesResult>(url, { method: 'POST' });
}

// =============================================================================
// Hull Parameters
// =============================================================================

export async function previewHull(
  regionId: number,
  params: HullParams,
  customGeometry?: GeoJSON.Geometry
): Promise<HullPreview> {
  return authFetchJson<HullPreview>(`${API_URL}/api/world-views/regions/${regionId}/hull/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...params, customGeometry }),
  });
}

export async function saveHull(regionId: number, params: HullParams): Promise<HullSaved> {
  return authFetchJson<HullSaved>(`${API_URL}/api/world-views/regions/${regionId}/hull/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
}

/** The parameters a region's hull was saved with, or null where it was never tuned or the read failed. */
export async function fetchSavedHullParams(regionId: number): Promise<HullParams | null> {
  try {
    const result = await authFetchJson<SavedHullParams>(`${API_URL}/api/world-views/regions/${regionId}/hull/params`);
    return result.params;
  } catch {
    return null;
  }
}
