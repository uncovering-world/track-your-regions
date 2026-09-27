/**
 * Admin Wikivoyage Extraction Controller
 *
 * Handles starting, monitoring, and cancelling Wikivoyage extractions.
 */

import type { z } from 'zod/v4';
import { pool } from '../../db/index.js';
import { badRequest, notFound, Refusal } from '../../middleware/errorHandler.js';
import type {
  ExtractionAnswer,
  ExtractionCancelled,
  ExtractionStarted,
  ExtractionStatus,
  WikivoyageCacheDeleted,
  InterviewQuestion,
  RegionPreview,
} from '../../api/responses/wikivoyageExtract.js';
import type { wvCacheNameParamSchema, wvExtractAnswerSchema, wvExtractStartSchema } from '../../types/index.js';
import type { WorldViewsRow } from '../../db/schema.generated.js';
import {
  startExtraction,
  getLatestExtractionStatus,
  cancelExtraction,
  findPendingQuestion,
  listCaches,
  deleteCache,
} from '../../services/wikivoyageExtract/index.js';
import { addRule, deleteRule } from '../../services/ai/learnedRulesService.js';
import { WIKIVOYAGE_ELIGIBLE_SOURCE_TYPES_ALL } from '../../services/worldViewImport/sourceTypes.js';

// The interview's question and the regions read off a page come from a model,
// by way of the extraction's own objects; each is read here key by key, so a
// key a model or the service added stays on the server.

function interviewQuestionOf(question: InterviewQuestion | null): InterviewQuestion | null {
  if (question === null) return null;
  return {
    text: question.text,
    options: question.options.map(option => ({ label: option.label, value: option.value })),
    recommended: question.recommended,
    ...(question.relatedRules
      ? { relatedRules: question.relatedRules.map(rule => ({ id: rule.id, text: rule.text })) }
      : {}),
  };
}

function regionPreviewOf(region: RegionPreview): RegionPreview {
  return {
    name: region.name,
    isLink: region.isLink,
    children: [...region.children],
    ...(region.pageExists !== undefined ? { pageExists: region.pageExists } : {}),
    ...(region.childPageExists ? { childPageExists: { ...region.childPageExists } } : {}),
  };
}

/**
 * Start a Wikivoyage extraction.
 * POST /api/admin/wv-extract/start
 */
export async function startWikivoyageExtraction(
  { body: { name, cacheFile } }: { body: z.output<typeof wvExtractStartSchema> },
): Promise<ExtractionStarted> {
  // Check nothing is currently running
  const existing = getLatestExtractionStatus();
  if (existing && !isTerminal(existing.progress.status)) {
    throw new Refusal(409, { error: 'An extraction is already running', operationId: existing.opId });
  }

  const opId = startExtraction({ name, cacheFile: cacheFile ?? undefined });
  return { started: true, operationId: opId };
}

/**
 * Get extraction status (also returns existing imported world views and cache list).
 * GET /api/admin/wv-extract/status
 */
export async function getWikivoyageExtractionStatus(): Promise<ExtractionStatus> {
  const latest = getLatestExtractionStatus();

  // Query existing imported world views from DB
  const wvResult = await pool.query<Pick<WorldViewsRow, 'id' | 'name' | 'source_type'>>(`
    SELECT wv.id, wv.name, wv.source_type
    FROM world_views wv
    WHERE wv.source_type = ANY($1)
    ORDER BY wv.id DESC
  `, [WIKIVOYAGE_ELIGIBLE_SOURCE_TYPES_ALL]);

  const importedWorldViews = wvResult.rows.map((row) => ({
    id: row.id,
    name: row.name,
    sourceType: row.source_type ?? '',
    reviewComplete: (row.source_type ?? '').endsWith('_done'),
  }));

  const caches = listCaches();

  if (!latest) return { running: false, importedWorldViews, caches };

  const { progress } = latest;
  const running = !isTerminal(progress.status);

  // Serialize pending questions (exclude internal callbacks)
  const pendingQuestions = progress.pendingQuestions
    .filter(q => !q.resolved)
    .map(q => ({
      id: q.id,
      pageTitle: q.pageTitle,
      sourceUrl: q.sourceUrl,
      currentQuestion: interviewQuestionOf(q.currentQuestion),
      extractedRegions: q.extractedRegions.map(regionPreviewOf),
    }));

  return {
    running,
    operationId: latest.opId,
    status: progress.status,
    statusMessage: progress.statusMessage,
    regionsFetched: progress.regionsFetched,
    estimatedTotal: progress.estimatedTotal,
    currentPage: progress.currentPage,
    apiRequests: progress.apiRequests,
    cacheHits: progress.cacheHits,
    createdRegions: progress.createdRegions,
    totalRegions: progress.totalRegions,
    countriesMatched: progress.countriesMatched,
    totalCountries: progress.totalCountries,
    subdivisionsDrilled: progress.subdivisionsDrilled,
    noCandidates: progress.noCandidates,
    worldViewId: progress.worldViewId,
    startedAt: progress.startedAt,
    aiApiCalls: progress.aiApiCalls,
    aiPromptTokens: progress.aiPromptTokens,
    aiCompletionTokens: progress.aiCompletionTokens,
    aiTotalCost: progress.aiTotalCost,
    pendingQuestions,
    importedWorldViews,
    caches,
  };
}

/**
 * Cancel a running extraction.
 * POST /api/admin/wv-extract/cancel
 */
export async function cancelWikivoyageExtraction(): Promise<ExtractionCancelled> {
  return { cancelled: cancelExtraction() };
}

/**
 * Delete a cache file.
 * DELETE /api/admin/wv-extract/caches/:name
 */
export async function deleteCacheFile(
  { params: { name } }: { params: z.output<typeof wvCacheNameParamSchema> },
): Promise<WikivoyageCacheDeleted> {
  if (!deleteCache(name)) throw notFound('Cache file not found');
  return { deleted: true };
}

type PendingQuestionLike = NonNullable<ReturnType<typeof findPendingQuestion>>;

/**
 * Advance a pending question to its next state by formulating the next interview question.
 * If the interview AI signals auto-resolution, mark the question resolved.
 */
async function advanceToNextQuestion(question: PendingQuestionLike): Promise<void> {
  const nextQ = await question.formulateNextQuestion();
  if (nextQ === 'auto_resolved') {
    question.resolved = true;
    question.currentQuestion = null;
  } else {
    question.currentQuestion = nextQ;
  }
}

/**
 * Delete a learned rule and re-formulate the current question so the admin can re-answer.
 */
async function handleDeleteRuleAction(questionId: number, ruleId: number): Promise<ExtractionAnswer> {
  const deleted = await deleteRule(ruleId);
  if (!deleted) throw notFound('Rule not found');
  console.log('[WV Extract] Deleted rule #%d from question #%d', ruleId, questionId);

  // Re-formulate the question now that the rule is gone. Don't fail the
  // request if the AI is unavailable — the rule deletion already succeeded
  // and the admin can retry the question independently.
  const question = findPendingQuestion(questionId);
  if (question && !question.resolved && question.currentQuestion) {
    try {
      await advanceToNextQuestion(question);
    } catch (err) {
      // Pass user-supplied questionId as a separate argument, not in the
      // format string, to avoid CodeQL js/tainted-format-string.
      console.warn('[WV Extract] Failed to re-formulate question after rule delete', {
        questionId,
        error: err instanceof Error ? err.message : err,
      });
    }
  }

  return {
    ruleDeleted: true,
    ruleId,
    ...(question ? {
      pageTitle: question.pageTitle,
      resolved: question.resolved,
      currentQuestion: interviewQuestionOf(question.currentQuestion),
      extractedRegions: question.extractedRegions.map(regionPreviewOf),
    } : {}),
  };
}

/**
 * Apply the outcome of the interview AI result.
 *
 * The admin's answer is final for this page: re-extract once with the
 * provided guidance so the regions reflect the decision, then mark the
 * question resolved regardless of any new uncertainties the extraction
 * model surfaces. Generic rules produced by processAnswer cover similar
 * pages going forward.
 */
async function applyAnswerResult(
  question: PendingQuestionLike,
  result: Awaited<ReturnType<PendingQuestionLike['processAnswer']>>,
): Promise<void> {
  // Re-extraction is best-effort. The page must always be marked resolved so
  // the admin isn't trapped on the same question if a transient AI failure
  // breaks re-extraction.
  try {
    if (result.reExtractGuidance) {
      const reResult = await question.reExtract(result.reExtractGuidance);
      question.extractedRegions = reResult.regions;
      question.rawQuestions = reResult.questions;
    }
  } catch (err) {
    console.warn('[WV Extract] Re-extraction failed after admin answer', {
      pageTitle: question.pageTitle,
      error: err instanceof Error ? err.message : err,
    });
  } finally {
    question.resolved = true;
    question.currentQuestion = null;
  }
}

/**
 * Handle the 'answer' action: process the admin's answer through the interview AI,
 * save a generic rule if produced, then apply the result.
 */
async function handleAnswerAction(
  question: PendingQuestionLike,
  answer: string | undefined,
): Promise<ExtractionAnswer> {
  if (!answer?.trim()) throw badRequest('Answer is required');
  if (!question.currentQuestion) throw badRequest('No active question to answer');

  // Process the answer through interview AI
  const result = await question.processAnswer(question.currentQuestion, answer.trim());

  // Save generic rule if the answer produced one. Best-effort — we still want
  // the answer applied even if rule persistence fails.
  let ruleSaved: string | null = null;
  if (result.rule) {
    const context = `Interview about "${question.pageTitle}": Q: "${question.currentQuestion.text}" A: "${answer.trim()}"`;
    try {
      await addRule('extraction', result.rule, context);
      ruleSaved = result.rule;
      console.log('[WV Extract] Saved generic rule from interview: "%s"', result.rule);
    } catch (err) {
      console.warn('[WV Extract] Failed to save generic rule from interview', {
        pageTitle: question.pageTitle,
        error: err instanceof Error ? err.message : err,
      });
    }
  }

  await applyAnswerResult(question, result);

  return {
    pageTitle: question.pageTitle,
    resolved: question.resolved,
    extractedRegions: question.extractedRegions.map(regionPreviewOf),
    currentQuestion: interviewQuestionOf(question.currentQuestion),
    ruleSaved,
  };
}

/**
 * Respond to a pending AI question during extraction.
 *
 * Interview-based HITL flow:
 * - 'answer': Process the admin's selected option through the interview AI.
 *   The AI determines: (a) generic rule to save, (b) re-extraction guidance.
 *   If a rule is found, it's saved to improve ALL future extractions.
 * - 'accept': Accept current extraction as-is, mark resolved.
 * - 'skip': Skip this question, mark resolved.
 *
 * POST /api/admin/wv-extract/answer
 */
export async function answerExtractionQuestion(
  { body: { questionId, action, answer, ruleId } }: { body: z.output<typeof wvExtractAnswerSchema> },
): Promise<ExtractionAnswer> {
  // Delete a problematic rule (doesn't resolve the question — admin can then
  // re-answer). The schema requires a ruleId with this action.
  if (action === 'delete_rule') return handleDeleteRuleAction(questionId, ruleId!);

  const question = findPendingQuestion(questionId);
  if (!question || question.resolved) throw notFound('Question not found or already resolved');

  if (action === 'answer') return handleAnswerAction(question, answer);

  // 'accept' or 'skip', the schema's two others
  question.resolved = true;
  return { resolved: true, pageTitle: question.pageTitle };
}

function isTerminal(status: string): boolean {
  return status === 'complete' || status === 'failed' || status === 'cancelled';
}
