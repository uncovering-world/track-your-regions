/**
 * AI Settings Controller
 *
 * Endpoints for reading and writing AI settings (model selections,
 * pipeline implementation toggles). Used by the admin CV Settings panel
 * to persist the cv_pipeline_implementation choice.
 */

import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { getAllSettings, updateSetting } from '../../services/ai/aiSettingsService.js';
import { getAllPricing } from '../../services/ai/pricingService.js';

export async function getAISettings(_req: AuthenticatedRequest, res: Response): Promise<void> {
  const settings = await getAllSettings();
  const models = getAllPricing().map(p => ({ id: p.model, inputPer1M: p.inputPer1M, outputPer1M: p.outputPer1M }));
  res.json({ settings, models });
}

export async function updateAISetting(req: AuthenticatedRequest, res: Response): Promise<void> {
  const key = req.params.key as string;
  const { value } = req.body as { value: string };
  await updateSetting(key, value);
  res.json({ ok: true });
}
