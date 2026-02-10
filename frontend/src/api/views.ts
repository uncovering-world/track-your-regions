/**
 * Views API
 */

import type { AdministrativeDivision, View } from '../types';
import { API_URL, authFetchJson } from './fetchUtils.js';

export async function fetchViews(worldViewId: number = 1): Promise<View[]> {
  return authFetchJson<View[]>(`${API_URL}/api/views?worldViewId=${worldViewId}`);
}

export async function fetchView(viewId: number): Promise<View> {
  return authFetchJson<View>(`${API_URL}/api/views/${viewId}`);
}

export async function createView(data: { name: string; description?: string; worldViewId: number }): Promise<View> {
  return authFetchJson<View>(`${API_URL}/api/views`, {
    method: 'POST',
    body: JSON.stringify({ ...data, worldViewId: data.worldViewId }),
  });
}

export async function updateView(viewId: number, data: { name?: string; description?: string; isActive?: boolean }): Promise<View> {
  return authFetchJson<View>(`${API_URL}/api/views/${viewId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteView(viewId: number): Promise<void> {
  await authFetchJson<void>(`${API_URL}/api/views/${viewId}`, {
    method: 'DELETE',
  });
}

export async function fetchViewDivisions(viewId: number): Promise<AdministrativeDivision[]> {
  return authFetchJson<AdministrativeDivision[]>(`${API_URL}/api/views/${viewId}/regions`);
}

export async function addDivisionsToView(viewId: number, divisionIds: number[]): Promise<void> {
  await authFetchJson<void>(`${API_URL}/api/views/${viewId}/regions`, {
    method: 'POST',
    body: JSON.stringify({ regionIds: divisionIds }),
  });
}

export async function removeDivisionsFromView(viewId: number, divisionIds: number[]): Promise<void> {
  await authFetchJson<void>(`${API_URL}/api/views/${viewId}/regions`, {
    method: 'DELETE',
    body: JSON.stringify({ regionIds: divisionIds }),
  });
}
