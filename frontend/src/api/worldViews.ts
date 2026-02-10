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

export async function deleteWorldView(worldViewId: number): Promise<void> {
  await authFetchJson<void>(`${API_URL}/api/world-views/${worldViewId}`, {
    method: 'DELETE',
  });
}
