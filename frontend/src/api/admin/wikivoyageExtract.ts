/**
 * Admin Wikivoyage Extraction API client
 */

import type {
  ExtractionAnswer, ExtractionCancelled, ExtractionStarted, ExtractionStatus, WikivoyageCacheDeleted,
} from '@tyr/shared/api';
import { authFetchJson } from '../fetchUtils';

// What every call here answers is declared once, as a backend schema (ADR-0066),
// and generated into `@tyr/shared/api`. Passed on from here, so a component
// imports a call's answer from the module of the call.
export type {
  ExtractionAnswer, ExtractionCancelled, ExtractionStarted, ExtractionStatus, ImportedWorldView, InterviewQuestion,
  PendingQuestion, RegionPreview, WikivoyageCache, WikivoyageCacheDeleted,
} from '@tyr/shared/api';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// =============================================================================
// API calls
// =============================================================================

/**
 * Start a Wikivoyage extraction.
 * @param cacheFile - Name of cache file to use, 'none' for clean fetch, or undefined for default
 */
export async function startWikivoyageExtraction(
  name: string,
  cacheFile?: string | null,
): Promise<ExtractionStarted> {
  return authFetchJson<ExtractionStarted>(`${API_URL}/api/admin/wv-extract/start`, {
    method: 'POST',
    body: JSON.stringify({ name, cacheFile }),
  });
}

/** Poll extraction status */
export async function getExtractionStatus(): Promise<ExtractionStatus> {
  return authFetchJson<ExtractionStatus>(`${API_URL}/api/admin/wv-extract/status`);
}

/** Cancel a running extraction */
export async function cancelExtraction(): Promise<ExtractionCancelled> {
  return authFetchJson<ExtractionCancelled>(`${API_URL}/api/admin/wv-extract/cancel`, {
    method: 'POST',
  });
}

/**
 * Respond to a pending AI question.
 * Actions:
 * - 'answer': select an option or provide custom text (processed by interview AI)
 * - 'accept': accept current extraction as-is
 * - 'skip': skip this question
 * - 'delete_rule': delete a problematic rule (requires ruleId), then re-formulates the question
 */
export async function answerExtractionQuestion(
  questionId: number,
  action: 'accept' | 'skip' | 'answer' | 'delete_rule',
  answer?: string,
  ruleId?: number,
): Promise<ExtractionAnswer> {
  return authFetchJson<ExtractionAnswer>(`${API_URL}/api/admin/wv-extract/answer`, {
    method: 'POST',
    body: JSON.stringify({ questionId, action, answer, ruleId }),
  });
}

/** Delete a cache file */
export async function deleteCacheFile(name: string): Promise<WikivoyageCacheDeleted> {
  return authFetchJson<WikivoyageCacheDeleted>(`${API_URL}/api/admin/wv-extract/caches/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  });
}
