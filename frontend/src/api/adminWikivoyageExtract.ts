/**
 * Admin Wikivoyage Extraction API client
 */

import { authFetchJson } from './fetchUtils';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// =============================================================================
// Types
// =============================================================================

export interface ExtractionStatus {
  running: boolean;
  operationId?: string;
  status?:
    | 'extracting'
    | 'enriching'
    | 'importing'
    | 'matching'
    | 'complete'
    | 'failed'
    | 'cancelled';
  statusMessage?: string;
  regionsFetched?: number;
  estimatedTotal?: number;
  currentPage?: string;
  apiRequests?: number;
  cacheHits?: number;
  createdRegions?: number;
  totalRegions?: number;
  countriesMatched?: number;
  totalCountries?: number;
  subdivisionsDrilled?: number;
  noCandidates?: number;
  worldViewId?: number | null;
  importedWorldViews?: Array<{ id: number; name: string; sourceType: string; reviewComplete: boolean }>;
  cache?: { exists: boolean; sizeBytes?: number; modifiedAt?: string };
}

// =============================================================================
// API calls
// =============================================================================

/** Start a Wikivoyage extraction */
export async function startWikivoyageExtraction(
  name: string,
  useCache = true,
): Promise<{ started: boolean; operationId: string }> {
  return authFetchJson(`${API_URL}/api/admin/wv-extract/start`, {
    method: 'POST',
    body: JSON.stringify({ name, useCache }),
  });
}

/** Poll extraction status */
export async function getExtractionStatus(): Promise<ExtractionStatus> {
  return authFetchJson(`${API_URL}/api/admin/wv-extract/status`);
}

/** Cancel a running extraction */
export async function cancelExtraction(): Promise<{ cancelled: boolean }> {
  return authFetchJson(`${API_URL}/api/admin/wv-extract/cancel`, {
    method: 'POST',
  });
}
