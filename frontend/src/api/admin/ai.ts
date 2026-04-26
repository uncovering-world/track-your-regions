/**
 * Admin AI Settings API client
 *
 * Endpoints for reading and updating AI settings (model selections,
 * pipeline implementation toggles).
 */

import { authFetchJson } from '../fetchUtils';

const API_URL = import.meta.env.VITE_API_URL || '';

export interface AIModelOption {
  id: string;
  inputPer1M: number;
  outputPer1M: number;
}

export interface AISettingsResponse {
  settings: Record<string, string>;
  models: AIModelOption[];
}

export async function getAISettings(): Promise<AISettingsResponse> {
  return authFetchJson(`${API_URL}/api/admin/ai/settings`);
}

export async function updateAISetting(key: string, value: string): Promise<void> {
  await authFetchJson(`${API_URL}/api/admin/ai/settings/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify({ value }),
  });
}
