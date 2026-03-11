/**
 * Admin Wikivoyage Extraction API client
 */

import { authFetchJson } from './fetchUtils';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// =============================================================================
// Types
// =============================================================================

export interface CacheEntry {
  name: string;
  sizeBytes: number;
  modifiedAt: string;
}

export interface RegionPreview {
  name: string;
  isLink: boolean;
  children: string[];
  pageExists?: boolean;
  /** Page existence for children (name → exists) */
  childPageExists?: Record<string, boolean>;
}

/** Structured interview question with clickable options */
export interface InterviewQuestion {
  text: string;
  options: Array<{ label: string; value: string }>;
  /** Index of the recommended option (AI's best guess) */
  recommended: number | null;
  /** Existing rules relevant to this question (admin can manage them) */
  relatedRules?: Array<{ id: number; text: string }>;
}

export interface PendingQuestion {
  id: number;
  pageTitle: string;
  sourceUrl: string;
  /** Structured interview question (null while being formulated) */
  currentQuestion: InterviewQuestion | null;
  extractedRegions: RegionPreview[];
}

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
  startedAt?: number;
  aiApiCalls?: number;
  aiPromptTokens?: number;
  aiCompletionTokens?: number;
  aiTotalCost?: number;
  pendingQuestions?: PendingQuestion[];
  importedWorldViews?: Array<{ id: number; name: string; sourceType: string; reviewComplete: boolean }>;
  caches?: CacheEntry[];
}

export interface AnswerResult {
  resolved?: boolean;
  pageTitle: string;
  extractedRegions?: RegionPreview[];
  currentQuestion?: InterviewQuestion | null;
  /** Generic rule that was saved from this answer */
  ruleSaved?: string | null;
  /** Rule was deleted (delete_rule action) */
  ruleDeleted?: boolean;
  ruleId?: number;
}

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
): Promise<{ started: boolean; operationId: string }> {
  return authFetchJson(`${API_URL}/api/admin/wv-extract/start`, {
    method: 'POST',
    body: JSON.stringify({ name, cacheFile }),
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
): Promise<AnswerResult> {
  return authFetchJson(`${API_URL}/api/admin/wv-extract/answer`, {
    method: 'POST',
    body: JSON.stringify({ questionId, action, answer, ruleId }),
  });
}

/** Delete a cache file */
export async function deleteCacheFile(name: string): Promise<{ deleted: boolean }> {
  return authFetchJson(`${API_URL}/api/admin/wv-extract/caches/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  });
}
