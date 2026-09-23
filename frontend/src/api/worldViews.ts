/**
 * World Views API
 */

import type { DeleteImpact, WorldView, WorldViews } from '@tyr/shared/api';
import { API_URL, authFetchJson } from './fetchUtils.js';

// What every call here answers is declared once, as a backend schema (ADR-0066),
// and generated into `@tyr/shared/api`. Passed on from here, so a component
// imports a call's answer from the module of the call.
export type { DeleteImpact, WorldView, WorldViews } from '@tyr/shared/api';

/**
 * Longest description the server keeps: `world_views.description` is
 * VARCHAR(1000) and the request schema bounds itself by that column. Mirrored
 * here so the field stops at the limit while it is being typed, rather than the
 * save coming back as a validation error.
 */
export const WORLD_VIEW_DESCRIPTION_MAX_LENGTH = 1000;

export async function fetchWorldViews(): Promise<WorldViews> {
  return authFetchJson<WorldViews>(`${API_URL}/api/world-views`);
}

export async function createWorldView(data: { name: string; description?: string; source?: string }): Promise<WorldView> {
  return authFetchJson<WorldView>(`${API_URL}/api/world-views`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateWorldView(
  worldViewId: number,
  data: { name?: string; description?: string; source?: string; isPublic?: boolean },
): Promise<WorldView> {
  return authFetchJson<WorldView>(`${API_URL}/api/world-views/${worldViewId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function getDeleteImpact(worldViewId: number): Promise<DeleteImpact> {
  return authFetchJson<DeleteImpact>(`${API_URL}/api/world-views/${worldViewId}/delete-impact`);
}

/** The answer is a 204 with no body. */
export async function deleteWorldView(worldViewId: number): Promise<void> {
  await authFetchJson<void>(`${API_URL}/api/world-views/${worldViewId}`, {
    method: 'DELETE',
  });
}
