/**
 * World Views API
 */

import type { WorldView } from '../types';
import { API_URL, authFetchJson } from './fetchUtils.js';

export async function fetchWorldViews(): Promise<WorldView[]> {
  return authFetchJson<WorldView[]>(`${API_URL}/api/world-views`);
}

export async function createWorldView(data: { name: string; description?: string; source?: string }): Promise<WorldView> {
  return authFetchJson<WorldView>(`${API_URL}/api/world-views`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateWorldView(worldViewId: number, data: { name?: string; description?: string; source?: string }): Promise<WorldView> {
  return authFetchJson<WorldView>(`${API_URL}/api/world-views/${worldViewId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export interface DeleteImpact {
  regionCount: number;
  experienceAssignmentCount: number;
  userVisitCount: number;
  isDefault: boolean;
}

export async function getDeleteImpact(worldViewId: number): Promise<DeleteImpact> {
  return authFetchJson<DeleteImpact>(`${API_URL}/api/world-views/${worldViewId}/delete-impact`);
}

export async function deleteWorldView(worldViewId: number): Promise<void> {
  await authFetchJson<void>(`${API_URL}/api/world-views/${worldViewId}`, {
    method: 'DELETE',
  });
}
