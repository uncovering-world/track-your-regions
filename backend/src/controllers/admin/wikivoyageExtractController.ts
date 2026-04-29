/**
 * Admin Wikivoyage Extraction Controller
 *
 * Handles starting, monitoring, and cancelling Wikivoyage extractions.
 */

import type { Response } from 'express';
import { pool } from '../../db/index.js';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import {
  startExtraction,
  getLatestExtractionStatus,
  cancelExtraction,
  findPendingQuestion,
  listCaches,
  deleteCache,
} from '../../services/wikivoyageExtract/index.js';
import { addRule, deleteRule } from '../../services/ai/learnedRulesService.js';

/**
 * Start a Wikivoyage extraction.
 * POST /api/admin/wv-extract/start
 */
export function startWikivoyageExtraction(req: AuthenticatedRequest, res: Response): void {
  const { name, cacheFile } = req.body as { name?: string; cacheFile?: string | null };

  // Check nothing is currently running
  const existing = getLatestExtractionStatus();
  if (existing && !isTerminal(existing.progress.status)) {
    res.status(409).json({
      error: 'An extraction is already running',
      operationId: existing.opId,
    });
    return;
  }

  const opId = startExtraction({
    name: name ?? 'Wikivoyage Regions',
    cacheFile: cacheFile ?? undefined,
  });
  res.json({ started: true, operationId: opId });
}

/**
 * Get extraction status (also returns existing imported world views and cache list).
 * GET /api/admin/wv-extract/status
 */
export async function getWikivoyageExtractionStatus(
  _req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  const latest = getLatestExtractionStatus();

  // Query existing imported world views from DB
  const wvResult = await pool.query(`
    SELECT wv.id, wv.name, wv.source_type
    FROM world_views wv
    WHERE wv.source_type IN ('wikivoyage', 'wikivoyage_done', 'imported', 'imported_done')
    ORDER BY wv.id DESC
  `);

  const importedWorldViews = wvResult.rows.map((row) => ({
    id: row.id as number,
    name: row.name as string,
    sourceType: row.source_type as string,
    reviewComplete: (row.source_type as string).endsWith('_done'),
  }));

  const caches = listCaches();

  if (!latest) {
    res.json({ running: false, importedWorldViews, caches });
    return;
  }

  const { progress } = latest;
  const running = !isTerminal(progress.status);

  // Serialize pending questions (exclude internal callbacks)
  const pendingQuestions = progress.pendingQuestions
    .filter(q => !q.resolved)
    .map(q => ({
      id: q.id,
      pageTitle: q.pageTitle,
      sourceUrl: q.sourceUrl,
      currentQuestion: q.currentQuestion,
      extractedRegions: q.extractedRegions,
    }));

  res.json({
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
  });
}

/**
 * Cancel a running extraction.
 * POST /api/admin/wv-extract/cancel
 */
export function cancelWikivoyageExtraction(_req: AuthenticatedRequest, res: Response): void {
  const cancelled = cancelExtraction();
  res.json({ cancelled });
}

/**
 * Delete a cache file.
 * DELETE /api/admin/wv-extract/caches/:name
 */
export function deleteCacheFile(req: AuthenticatedRequest, res: Response): void {
  const name = req.params.name as string;
  const deleted = deleteCache(name);
  if (deleted) {
    res.json({ deleted: true });
  } else {
    res.status(404).json({ error: 'Cache file not found' });
  }
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
async function handleDeleteRuleAction(
  questionId: number,
  ruleId: number | undefined,
  res: Response,
): Promise<void> {
  if (!ruleId) {
    res.status(400).json({ error: 'ruleId is required for delete_rule action' });
    return;
  }
  const deleted = await deleteRule(ruleId);
  if (!deleted) {
    res.status(404).json({ error: 'Rule not found' });
    return;
  }
  console.log(`[WV Extract] Deleted rule #${ruleId} from question #${questionId}`);

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

  res.json({
    ruleDeleted: true,
    ruleId,
    pageTitle: question?.pageTitle,
    resolved: question?.resolved,
    currentQuestion: question?.currentQuestion,
    extractedRegions: question?.extractedRegions,
  });
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
  res: Response,
): Promise<void> {
  if (!answer?.trim()) {
    res.status(400).json({ error: 'Answer is required' });
    return;
  }
  if (!question.currentQuestion) {
    res.status(400).json({ error: 'No active question to answer' });
    return;
  }

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
      console.log(`[WV Extract] Saved generic rule from interview: "${result.rule}"`);
    } catch (err) {
      console.warn('[WV Extract] Failed to save generic rule from interview', {
        pageTitle: question.pageTitle,
        error: err instanceof Error ? err.message : err,
      });
    }
  }

  await applyAnswerResult(question, result);

  res.json({
    pageTitle: question.pageTitle,
    resolved: question.resolved,
    extractedRegions: question.extractedRegions,
    currentQuestion: question.currentQuestion,
    ruleSaved,
  });
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
export async function answerExtractionQuestion(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { questionId, action, answer, ruleId } = req.body as {
    questionId: number; action: string; answer?: string; ruleId?: number;
  };

  // Delete a problematic rule (doesn't resolve the question — admin can then re-answer)
  if (action === 'delete_rule') {
    await handleDeleteRuleAction(questionId, ruleId, res);
    return;
  }

  const question = findPendingQuestion(questionId);
  if (!question || question.resolved) {
    res.status(404).json({ error: 'Question not found or already resolved' });
    return;
  }

  if (action === 'answer') {
    await handleAnswerAction(question, answer, res);
  } else if (action === 'accept' || action === 'skip') {
    question.resolved = true;
    res.json({ resolved: true, pageTitle: question.pageTitle });
  } else {
    res.status(400).json({ error: 'Invalid action. Use: answer, accept, or skip' });
  }
}

function isTerminal(status: string): boolean {
  return status === 'complete' || status === 'failed' || status === 'cancelled';
}
