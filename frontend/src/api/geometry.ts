/**
 * Geometry and Hull API
 */

import { API_URL, authFetchJson, ensureFreshToken } from './fetchUtils.js';
import type {
  HullParams,
  ComputationStatus,
  ComputationStartResult,
  DisplayGeometryStatus,
  RegenerateDisplayGeometriesResult,
} from './types.js';

// =============================================================================
// Types for SSE streaming
// =============================================================================

export interface ComputeProgressEvent {
  type: 'progress' | 'complete' | 'error';
  step?: string;
  stepNumber?: number;
  totalSteps?: number;
  elapsed?: number;
  message?: string;
  data?: Record<string, unknown>;
}

// =============================================================================
// Geometry Computation
// =============================================================================

export async function computeRegionGeometry(regionId: number, force?: boolean): Promise<{
  computed: boolean;
  points?: number;
  message?: string;
  childrenComputed?: number;
  usesHull?: boolean;
  crossesDateline?: boolean;
}> {
  const url = force
    ? `${API_URL}/api/world-views/regions/${regionId}/geometry/compute?force=true`
    : `${API_URL}/api/world-views/regions/${regionId}/geometry/compute`;
  return authFetchJson<{
    computed: boolean;
    points?: number;
    message?: string;
    childrenComputed?: number;
    usesHull?: boolean;
    crossesDateline?: boolean;
  }>(url, { method: 'POST' });
}

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
): Promise<ComputeProgressEvent> {
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
          const data = JSON.parse(event.data) as ComputeProgressEvent;
          onProgress(data);

          if (data.type === 'complete' || data.type === 'error') {
            eventSource.close();
            if (data.type === 'error') {
              reject(new Error(data.message || 'Computation failed'));
            } else {
              resolve(data);
            }
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

export async function resetRegionToGADM(regionId: number): Promise<{
  reset: boolean;
  points: number;
  message: string;
}> {
  return authFetchJson<{
    reset: boolean;
    points: number;
    message: string;
  }>(`${API_URL}/api/world-views/regions/${regionId}/geometry/reset`, { method: 'POST' });
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

export async function cancelWorldViewGeometryComputation(worldViewId: number): Promise<void> {
  await authFetchJson<void>(`${API_URL}/api/world-views/${worldViewId}/compute-geometries/cancel`, {
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
  options: { applyClipping?: boolean; regionId?: number } = {}
): Promise<RegenerateDisplayGeometriesResult> {
  const { applyClipping = true, regionId } = options;
  const params = new URLSearchParams();
  if (!applyClipping) params.append('clip', 'false');
  if (regionId) params.append('regionId', String(regionId));
  const queryString = params.toString();
  const url = `${API_URL}/api/world-views/${worldViewId}/regenerate-display-geometries${queryString ? `?${queryString}` : ''}`;
  return authFetchJson<RegenerateDisplayGeometriesResult>(url, { method: 'POST' });
}

// =============================================================================
// Hull Parameters
// =============================================================================

export async function previewHull(
  regionId: number,
  params: HullParams,
  customGeometry?: GeoJSON.Geometry
): Promise<{
  geometry: GeoJSON.Geometry | null;
  pointCount: number;
  crossesDateline: boolean;
  params: HullParams;
}> {
  return authFetchJson(`${API_URL}/api/world-views/regions/${regionId}/hull/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...params, customGeometry }),
  });
}

export async function saveHull(regionId: number, params: HullParams): Promise<{
  saved: boolean;
  pointCount: number;
  crossesDateline: boolean;
  params: HullParams;
}> {
  return authFetchJson(`${API_URL}/api/world-views/regions/${regionId}/hull/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
}

export async function fetchSavedHullParams(regionId: number): Promise<HullParams | null> {
  try {
    const result = await authFetchJson<{ params: HullParams | null }>(`${API_URL}/api/world-views/regions/${regionId}/hull/params`);
    return result.params;
  } catch {
    return null;
  }
}


