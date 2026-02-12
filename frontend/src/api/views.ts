/**
 * Views API
 */

import type { AdministrativeDivision, View } from '../types';
import { API_URL, authFetchJson } from './fetchUtils.js';

export async function fetchViews(worldViewId: number = 1): Promise<View[]> {
  return authFetchJson<View[]>(`${API_URL}/api/views?worldViewId=${worldViewId}`);
}

export async function fetchViewDivisions(viewId: number): Promise<AdministrativeDivision[]> {
  return authFetchJson<AdministrativeDivision[]>(`${API_URL}/api/views/${viewId}/regions`);
}
